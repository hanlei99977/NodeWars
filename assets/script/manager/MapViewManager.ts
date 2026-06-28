import { Node, Graphics, Color, Label, UITransform, EventTouch, Vec2, Vec3 } from 'cc';
import { NodeEntity } from '../entity/NodeEntity';
import { EdgeEntity } from '../entity/EdgeEntity';
import { ArmyEntity } from '../entity/ArmyEntity';
import { OwnerType } from '../config/EnumDefine';
import { FogSystem } from '../fog/FogSystem';

/**
 * 地图视图管理器，负责地图的全部视觉呈现与触摸事件分发
 *
 * 职责：
 *   - 渲染节点圆形、线段、军队图标
 *   - 每帧刷新节点颜色/标签、军队视图
 *   - 地图拖拽（DragSurface 捕获空白区域触摸）
 *   - 节点/边/军队的点击与滑动手势检测，通过回调接口分发
 *   - UI 坐标 → 地图坐标转换
 *   - 势力颜色映射
 *
 * 注意：这是一个纯 JS 类，不继承 Cocos Component。
 *       构造函数接收父节点（GameManager 的 this.node），
 *       mapLayer 和 dragSurface 均挂载到父节点下。
 */
export class MapViewManager {

    // ==================== 视图静态常量 ====================

    /** 节点圆形半径（像素） */
    static readonly NODE_RADIUS = 18;

    /** 势力基础颜色映射（玩家/中立） */
    static readonly OWNER_COLORS: Record<string, Color> = {
        [OwnerType.NEUTRAL]:  new Color(160, 160, 160),
        [OwnerType.PLAYER]:   new Color(64, 140, 255),
    };

    /** 边等级颜色映射 */
    static readonly EDGE_COLORS: Record<number, Color> = {
        1: new Color(120, 120, 120),
        2: new Color(80, 180, 80),
        3: new Color(255, 180, 40),
    };

    /** 边等级线宽映射 */
    static readonly EDGE_WIDTHS: Record<number, number> = { 1: 2, 2: 4, 3: 6 };

    /** AI 势力颜色库（按索引分配） */
    static readonly AI_COLORS: Color[] = [
        new Color(220, 60, 60),   // 红
        new Color(220, 180, 20),  // 黄
        new Color(160, 40, 200),  // 紫
        new Color(40, 160, 160),  // 青
        new Color(220, 120, 60),  // 橙
        new Color(60, 160, 60),   // 绿
        new Color(200, 60, 140),  // 粉
        new Color(80, 80, 180),   // 靛
        new Color(180, 140, 40),  // 棕
        new Color(120, 180, 60),  // 黄绿
    ];

    // ==================== 内部节点与状态 ====================

    /** 父节点（GameManager 的 this.node），mapLayer 和 dragSurface 挂载于此 */
    private _parentNode: Node;

    /** 地图内容层（节点圆形、线段、军队），受拖拽/缩放影响 */
    private _mapLayer: Node | null = null;

    /** 拖拽感知层（最下层，只捕获地图空白区触摸） */
    private _dragSurface: Node | null = null;

    /** 节点圆形 Graphics 数组，按 nodeId 索引 */
    private _nodeGraphics: (Graphics | null)[] = [];

    /** 节点驻军/所有者标签 Label 数组，按 nodeId 索引 */
    private _nodeInfoLabels: (Label | null)[] = [];

    /** 节点等级/所有者标签 Label 数组，按 nodeId 索引 */
    private _nodeLevelLabels: (Label | null)[] = [];

    /** 节点包装节点数组，按 nodeId 索引（承载圆形、标签、触摸事件） */
    private _nodeWrapperNodes: (Node | null)[] = [];

    /** 边包装节点 Map，按 edgeId 索引 */
    private _edgeNodes: Map<number, Node> = new Map();

    /** 军队视图节点 Map，按 armyId 索引 */
    private _armyViewNodes: Map<number, Node> = new Map();

    /** 上一次拖拽的 UI 坐标 */
    private _dragLastPos: Vec2 | null = null;

    /** 是否正在拖拽地图 */
    private _isDragging = false;

    /** 地图包围盒（用于拖拽边界限制） */
    private _mapBounds = { minX: 0, maxX: 0, minY: 0, maxY: 0 };

    /** 节点实体缓存（渲染时需要读取相邻节点坐标） */
    private _nodes: NodeEntity[] = [];

    /** AI ID 列表缓存（用于 getOwnerColor 映射 AI 颜色） */
    private _aiIds: string[] = [];

    // ==================== 回调接口（由 GameManager 注入） ====================

    /** 节点短按回调，参数：节点ID */
    onNodeClicked: ((nodeId: number) => void) | null = null;

    /** 边点击回调，参数：边ID */
    onEdgeClicked: ((edgeId: number) => void) | null = null;

    /** 军队点击回调，参数：军队ID */
    onArmyClicked: ((armyId: number) => void) | null = null;

    /** 滑动开始回调（手指从节点移出超过阈值），参数：节点ID、起始UI坐标 */
    onSwipeStart: ((nodeId: number, startPos: Vec2) => void) | null = null;

    /** 滑动移动回调（每帧TOUCH_MOVE），参数：触摸事件对象 */
    onSwipeMove: ((e: EventTouch) => void) | null = null;

    /** 滑动结束回调（手指抬起/取消），参数：触摸事件对象 */
    onSwipeEnd: ((e: EventTouch) => void) | null = null;

    /** 空白区域点击回调（DragSurface 捕获到触摸），返回值暂不使用 */
    onBlankAreaTap: (() => void) | null = null;

    // ==================== 初始化 ====================

    /**
     * 构造函数
     *
     * @param parentNode  GameManager 的 this.node，作为 mapLayer / dragSurface 的父节点
     */
    constructor(parentNode: Node) {
        this._parentNode = parentNode;
    }

    /** 获取地图内容层节点（供 GameManager 在自动派遣可视化中 addChild 使用） */
    get mapLayer(): Node | null {
        return this._mapLayer;
    }

    // ==================== 地图渲染 ====================

    /**
     * 生成整张地图的视觉表示
     *
     * 流程：
     *   1. 清除旧地图
     *   2. 计算节点包围盒
     *   3. 创建 DragSurface（拖拽感知层）
     *   4. 创建 MapLayer（地图内容层）
     *   5. 绘制所有边
     *   6. 绘制所有节点
     *
     * @param nodes  地图节点实体列表
     * @param edges  地图边实体列表
     * @param aiIds  AI 势力ID列表（用于颜色映射）
     * @returns 无
     */
    renderMap(nodes: NodeEntity[], edges: EdgeEntity[], aiIds: string[]): void {
        this.clearMap();
        this._nodes = nodes;
        this._aiIds = aiIds;

        // 计算节点包围盒
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (const n of nodes) {
            if (n.position.x < minX) minX = n.position.x;
            if (n.position.x > maxX) maxX = n.position.x;
            if (n.position.y < minY) minY = n.position.y;
            if (n.position.y > maxY) maxY = n.position.y;
        }
        const cx = (minX + maxX) / 2;
        const cy = (minY + maxY) / 2;

        this._mapBounds = {
            minX: minX - cx,
            maxX: maxX - cx,
            minY: minY - cy,
            maxY: maxY - cy,
        };

        // 拖拽感知层（最下层，只捕获地图空白区的触摸）
        this._dragSurface = new Node('DragSurface');
        const dsUi = this._dragSurface.addComponent(UITransform);
        dsUi.setContentSize(2000, 2000);
        this._parentNode.addChild(this._dragSurface);
        this._dragSurface.setSiblingIndex(0);

        this._dragSurface.on(Node.EventType.TOUCH_START, (e: EventTouch) => {
            if (this.onBlankAreaTap) this.onBlankAreaTap();
            this._isDragging = true;
            this._dragLastPos = e.getUILocation();
        });
        this._dragSurface.on(Node.EventType.TOUCH_MOVE, (e: EventTouch) => {
            if (!this._isDragging || !this._dragLastPos || !this._mapLayer) return;
            const cur = e.getUILocation();
            const dx = cur.x - this._dragLastPos.x;
            const dy = cur.y - this._dragLastPos.y;
            this._dragLastPos.set(cur.x, cur.y);
            const s = this._mapLayer.scale.x;
            const p = this._mapLayer.position;
            this._mapLayer.setPosition(p.x + dx / s, p.y + dy / s, p.z);
            this._clampMapLayer();
        });
        this._dragSurface.on(Node.EventType.TOUCH_END, () => {
            this._isDragging = false;
            this._dragLastPos = null;
        });

        // MapLayer（在上层，包含地图节点/边/军队）
        this._mapLayer = new Node('MapLayer');
        this._mapLayer.setPosition(-cx, -cy, 0);
        this._parentNode.addChild(this._mapLayer);

        for (const edge of edges) {
            this.createEdgeGraphic(edge);
        }

        this._nodeGraphics = new Array(nodes.length).fill(null);
        this._nodeInfoLabels = new Array(nodes.length).fill(null);
        this._nodeLevelLabels = new Array(nodes.length).fill(null);
        this._nodeWrapperNodes = new Array(nodes.length).fill(null);

        for (const n of nodes) {
            this.createNodeGraphic(n);
        }
    }

    /**
     * 清除整张地图的视觉表示
     *
     * 销毁所有军队视图、边视图、mapLayer、dragSurface，
     * 重置所有内部状态数组和 Map
     *
     * @returns 无
     */
    clearMap(): void {
        this._armyViewNodes.forEach(n => n.destroy());
        this._armyViewNodes.clear();
        this._edgeNodes.forEach(n => n.destroy());
        this._edgeNodes.clear();
        if (this._mapLayer) {
            this._mapLayer.destroy();
            this._mapLayer = null;
        }
        if (this._dragSurface) {
            this._dragSurface.destroy();
            this._dragSurface = null;
        }
        this._nodeGraphics = [];
        this._nodeInfoLabels = [];
        this._nodeLevelLabels = [];
        this._nodeWrapperNodes = [];
        this._isDragging = false;
        this._dragLastPos = null;
    }

    /**
     * 每帧刷新节点视图（颜色/标签）
     *
     * 根据迷雾状态更新：
     *   - 已探索：显示势力颜色 + 驻军数
     *   - 当前可见：显示具体驻军数
     *   - 曾探索但当前不可见：显示 "?"
     *   - 未探索：深灰色圆 + 空标签
     *
     * @param nodes  地图节点实体列表（每帧可能已变更属性）
     * @returns 无
     */
    refreshNodeViews(nodes: NodeEntity[]): void {
        for (let i = 0; i < nodes.length; i++) {
            const n = nodes[i];
            const g = this._nodeGraphics[i];
            const lbl = this._nodeInfoLabels[i];
            const lvl = this._nodeLevelLabels[i];
            if (!g || !lbl || !lvl) continue;

            const visible = FogSystem.isNodeExplored(n.id, OwnerType.PLAYER);

            g.clear();

            if (visible) {
                const color = this.getOwnerColor(n.ownerId);
                g.fillColor = color;
                g.strokeColor = new Color(40, 40, 40);
                g.lineWidth = 1.5;
                g.circle(0, 0, MapViewManager.NODE_RADIUS);
                g.fill();
                g.stroke();

                lbl.string = FogSystem.isNodeCurrentlyVisible(n.id, OwnerType.PLAYER)
                    ? `${n.garrisonCount}` : `?`;
                    lvl.string = FogSystem.isNodeCurrentlyVisible(n.id, OwnerType.PLAYER)
                    ? `Lv${n.level}` : `?`;
            } else {
                g.fillColor = new Color(60, 60, 60);
                g.strokeColor = new Color(40, 40, 40);
                g.lineWidth = 1.5;
                g.circle(0, 0, MapViewManager.NODE_RADIUS);
                g.fill();
                g.stroke();

                lbl.string = '';
                lvl.string = '';
            }
        }
    }

    /**
     * 每帧刷新军队视图
     *
     * 逻辑：
     *   1. 收集存活军队ID集合
     *   2. 销毁已消亡军队的视图节点
     *   3. 为新生军队创建视图节点
     *   4. 每帧更新所有军队视图位置
     *
     * @param armies  当前活跃军队实体列表
     * @returns 无
     */
    refreshArmyViews(armies: ArmyEntity[]): void {
        // 移除不存在的军队视图
        const aliveIds = new Set(armies.map(a => a.id));
        for (const [id, vn] of this._armyViewNodes.entries()) {
            if (!aliveIds.has(id)) {
                vn.destroy();
                this._armyViewNodes.delete(id);
            }
        }

        // 为新生军队创建视图并每帧更新位置
        for (const a of armies) {
            let vn = this._armyViewNodes.get(a.id);
            if (!vn) {
                vn = this.createArmyGraphic(a);
                this._armyViewNodes.set(a.id, vn);
            }
            this.updateArmyPosition(vn, a);
        }
    }

    // ==================== 内部渲染辅助 ====================

    /**
     * 创建一条线段的视觉节点（可点击弹出 EdgePanel）
     *
     * 沿线方向放置一个旋转的包装节点，内含 Graphics 绘制的线段。
     * 包装节点的 UITransform 略宽于线段长度，方便手指点击。
     *
     * @param edge  边实体（包含两端节点ID、等级）
     * @returns 无
     */
    private createEdgeGraphic(edge: EdgeEntity): void {
        const wrapper = new Node(`Edge_${edge.id}`);
        const posA = this._nodes[edge.nodeAId].position;
        const posB = this._nodes[edge.nodeBId].position;
        const midX = (posA.x + posB.x) / 2;
        const midY = (posA.y + posB.y) / 2;
        const dx = posB.x - posA.x;
        const dy = posB.y - posA.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        const angle = Math.atan2(dy, dx) * (180 / Math.PI);
        const ui = wrapper.addComponent(UITransform);
        ui.setContentSize(len + 20, 28);
        wrapper.setPosition(midX, midY, 0);
        wrapper.setRotationFromEuler(0, 0, angle);

        // 绘制线段
        const gNode = new Node('Line');
        const g = gNode.addComponent(Graphics);
        g.strokeColor = MapViewManager.EDGE_COLORS[edge.level] || MapViewManager.EDGE_COLORS[1];
        g.lineWidth = MapViewManager.EDGE_WIDTHS[edge.level] || 2;
        g.moveTo(-len / 2, 0);
        g.lineTo(len / 2, 0);
        g.stroke();
        wrapper.addChild(gNode);

        // 点击 → 分发 onEdgeClicked 回调
        wrapper.on(Node.EventType.TOUCH_START, (e: EventTouch) => {
            e.propagationStopped = true;
            if (this.onEdgeClicked) this.onEdgeClicked(edge.id);
        });

        this._edgeNodes.set(edge.id, wrapper);
        this._mapLayer!.addChild(wrapper);

        gNode.setSiblingIndex(1);
    }

    /**
     * 为一个节点创建圆形图形 + 信息标签 + 触摸事件
     *
     * 内容包括：
     *   - 圆形 Graphics（填充势力颜色，描边）
     *   - 等级标签（正上方 LvN）
     *   - 驻军/所有者标签（正下方）
     *
     * 触摸手势：
     *   - 短按（无滑动）→ 分发 onNodeClicked
     *   - 滑动（移出阈值 15px）→ 分发 onSwipeStart / onSwipeMove / onSwipeEnd
     *
     * 滑动结束通过 TOUCH_CANCEL 检测（手指移出节点范围后系统触发），
     * 短按通过 TOUCH_END 检测（手指未移出节点范围时触发）
     *
     * @param n  节点实体
     * @returns 无
     */
    private createNodeGraphic(n: NodeEntity): void {
        const wrapper = new Node(`Node_${n.id}`);
        wrapper.setPosition(n.position.x, n.position.y, 0);
        const ui = wrapper.addComponent(UITransform);
        ui.setContentSize(MapViewManager.NODE_RADIUS * 2 + 12, MapViewManager.NODE_RADIUS * 2 + 12);

        // 圆形 Graphics
        const circle = new Node('Circle');
        const cg = circle.addComponent(Graphics);
        const color = this.getOwnerColor(n.ownerId);
        cg.fillColor = color;
        cg.strokeColor = new Color(40, 40, 40);
        cg.lineWidth = 1.5;
        cg.circle(0, 0, MapViewManager.NODE_RADIUS);
        cg.fill();
        cg.stroke();
        wrapper.addChild(circle);
        this._nodeGraphics[n.id] = cg;

        // 等级标签（正上方）
        const lvlLabel = new Node('LevelLabel');
        const lvlL = lvlLabel.addComponent(Label);
        lvlL.string = `Lv${n.level}`;
        lvlL.fontSize = 14;
        lvlL.color = Color.WHITE;
        lvlLabel.getComponent(UITransform)!.setContentSize(50, 20);
        lvlLabel.setPosition(0, MapViewManager.NODE_RADIUS + 12, 0);
        wrapper.addChild(lvlLabel);
        this._nodeLevelLabels[n.id] = lvlL;

        // 驻军/所有者标签（正下方）
        const infoLabel = new Node('InfoLabel');
        const infoL = infoLabel.addComponent(Label);
        infoL.string = `${n.garrisonCount}`;
        infoL.fontSize = 13;
        infoL.color = new Color(220, 220, 220);
        infoLabel.getComponent(UITransform)!.setContentSize(80, 22);
        infoLabel.setPosition(0, -MapViewManager.NODE_RADIUS - 14, 0);
        wrapper.addChild(infoLabel);
        this._nodeInfoLabels[n.id] = infoL;

        // ======================== 节点触摸交互 ========================
        let touchStartPos = new Vec2();          // 触摸起始 UI 坐标
        let hasMoved = false;                    // 本次触摸是否已判定为滑动
        const SWIPE_THRESHOLD = 15;              // 滑动触发阈值（像素）

        wrapper.on(Node.EventType.TOUCH_START, (e: EventTouch) => {
            e.propagationStopped = true;
            touchStartPos.set(e.getUILocation());
            hasMoved = false;
        });

        wrapper.on(Node.EventType.TOUCH_MOVE, (e: EventTouch) => {
            const cur = e.getUILocation();
            const dx = cur.x - touchStartPos.x;
            const dy = cur.y - touchStartPos.y;
            if (Math.abs(dx) < SWIPE_THRESHOLD && Math.abs(dy) < SWIPE_THRESHOLD) return;

            if (!hasMoved) {
                hasMoved = true;
                if (this.onSwipeStart) this.onSwipeStart(n.id, touchStartPos);
            }
            if (this.onSwipeMove) this.onSwipeMove(e);
        });

        wrapper.on(Node.EventType.TOUCH_CANCEL, (e: EventTouch) => {
            if (hasMoved && this.onSwipeEnd) {
                this.onSwipeEnd(e);
            }
        });

        wrapper.on(Node.EventType.TOUCH_END, (e: EventTouch) => {
            if (!hasMoved && this.onNodeClicked) {
                this.onNodeClicked(n.id);
            }
        });

        this._mapLayer!.addChild(wrapper);
        this._nodeWrapperNodes[n.id] = wrapper;

        circle.setSiblingIndex(3);
    }

    /**
     * 创建一支军队的视图节点（可点击弹出 ArmyPanel）
     *
     * 内容：
     *   - 小型圆形（势力颜色填充，半径 8px）
     *   - 人数标签（下方显示士兵数）
     *
     * 点击 → 分发 onArmyClicked 回调
     *
     * 渲染顺序：军队 setSiblingIndex(0) 置底，确保节点始终显示在军队上方
     *
     * @param army  军队实体
     * @returns 军队视图节点
     */
    private createArmyGraphic(army: ArmyEntity): Node {
        const vn = new Node(`Army_${army.id}`);
        const vnUi = vn.addComponent(UITransform);
        vnUi.setContentSize(30, 30);

        const g = vn.addComponent(Graphics);
        const color = this.getOwnerColor(army.ownerId);
        g.fillColor = color;
        g.strokeColor = new Color(30, 30, 30);
        g.lineWidth = 1;
        g.circle(0, 0, 8);
        g.fill();
        g.stroke();

        // 人数标签
        const lblNode = new Node('Label');
        lblNode.setPosition(0, -14, 0);
        const lbl = lblNode.addComponent(Label);
        lbl.string = `${army.soldierCount}`;
        lbl.fontSize = 12;
        lbl.color = Color.WHITE;
        lbl.node.getComponent(UITransform)!.setContentSize(50, 18);
        vn.addChild(lblNode);

        // 点击 → ArmyPanel
        vn.on(Node.EventType.TOUCH_START, (e: EventTouch) => {
            e.propagationStopped = true;
            if (this.onArmyClicked) this.onArmyClicked(army.id);
        });

        this._mapLayer!.addChild(vn);
        vn.setSiblingIndex(2);
        return vn;
    }

    /**
     * 根据军队当前路径进度更新视图节点位置
     *
     * 在边的两端节点之间做线性插值：pos = posA + (posB - posA) * progress
     *
     * @param vn    军队视图节点
     * @param army  军队实体（含 pathNodeIds、currentEdgeIndex、progress）
     * @returns 无
     */
    private updateArmyPosition(vn: Node, army: ArmyEntity): void {
        if (army.currentEdgeIndex >= army.pathNodeIds.length - 1) return;
        const nodeA = this._nodes[army.pathNodeIds[army.currentEdgeIndex]];
        const nodeB = this._nodes[army.pathNodeIds[army.currentEdgeIndex + 1]];
        if (!nodeA || !nodeB) return;
        const t = army.progress;
        if (FogSystem.isNodeCurrentlyVisible(nodeA.id,OwnerType.PLAYER) && 
            FogSystem.isNodeCurrentlyVisible(nodeB.id,OwnerType.PLAYER))
        {
            vn.active = true;
        }
        else 
        {
            vn.active = false;
            // console.log(`军队 不可见`)
        }
        vn.setPosition(
            nodeA.position.x + (nodeB.position.x - nodeA.position.x) * t,
            nodeA.position.y + (nodeB.position.y - nodeA.position.y) * t,
            0,
        );
    }

    // ==================== 坐标转换 ====================

    /**
     * 将 UI 坐标（屏幕像素）转换为地图本地坐标
     *
     * 通过 mapLayer 的 inverseTransformPoint 进行反向变换，
     * 自动处理 mapLayer 的位置偏移和缩放。
     *
     * @param x  UI 坐标 X（屏幕像素）
     * @param y  UI 坐标 Y（屏幕像素）
     * @returns 地图本地坐标 Vec2，若 mapLayer 为空返回 null
     */
    uiToMapPos(x: number, y: number): Vec2 | null {
        if (!this._mapLayer) return null;
        const localPos = new Vec3();
        this._mapLayer.inverseTransformPoint(localPos, new Vec3(x, y, 0));
        return new Vec2(localPos.x, localPos.y);
    }

    // ==================== 颜色映射 ====================

    /**
     * 获取 ownerId 对应的显示颜色
     *
     * 映射规则：
     *   - NEUTRAL → 灰色
     *   - PLAYER → 蓝色
     *   - OWNER_COLORS 中已缓存 → 直接取
     *   - AI → 按 aiId 在 _aiIds 中的索引从 AI_COLORS 取色
     *
     * @param ownerId  势力标识
     * @returns 对应的 Color
     */
    getOwnerColor(ownerId: string): Color {
        if (ownerId === OwnerType.NEUTRAL)  return MapViewManager.OWNER_COLORS[OwnerType.NEUTRAL];
        if (ownerId === OwnerType.PLAYER)   return MapViewManager.OWNER_COLORS[OwnerType.PLAYER];
        if (MapViewManager.OWNER_COLORS[ownerId]) return MapViewManager.OWNER_COLORS[ownerId];
        const aiIdx = this._aiIds.indexOf(ownerId);
        if (aiIdx >= 0 && aiIdx < MapViewManager.AI_COLORS.length) {
            return MapViewManager.AI_COLORS[aiIdx];
        }
        return new Color(200, 60, 60);
    }

    // ==================== 内部工具 ====================

    /**
     * 限制 mapLayer 的位置在地图包围盒内，且留 400px 边距
     *
     * @returns 无
     */
    private _clampMapLayer(): void {
        if (!this._mapLayer) return;
        const ml = this._mapLayer;
        const s = ml.scale.x;
        const margin = 400;
        const p = ml.position;
        const nx = Math.max(this._mapBounds.minX - margin, Math.min(this._mapBounds.maxX + margin, p.x));
        const ny = Math.max(this._mapBounds.minY - margin, Math.min(this._mapBounds.maxY + margin, p.y));
        ml.setPosition(nx, ny, p.z);
    }
}