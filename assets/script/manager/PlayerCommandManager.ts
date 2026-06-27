import { Node, Graphics, Color, EventTouch, Vec2 } from 'cc';
import { NodeEntity } from '../entity/NodeEntity';
import { EdgeEntity } from '../entity/EdgeEntity';
import { ArmyEntity } from '../entity/ArmyEntity';
import { OwnerType, ArmyState } from '../config/EnumDefine';
import { ArmyManager } from './ArmyManager';
import { PathfindingManager } from './PathfindingManager';
import { MapViewManager } from './MapViewManager';
import { EconomySystem } from '../economy/EconomySystem';
import { RecruitSystem } from '../recruit/RecruitSystem';
import { NodePanel } from '../ui/NodePanel';
import { EdgePanel } from '../ui/EdgePanel';
import { ArmyPanel } from '../ui/ArmyPanel';

/**
 * 玩家命令管理器，负责所有玩家交互逻辑
 *
 * 职责：
 *   - 节点/边/军队点击处理
 *   - 派兵（一次性）+ 军队改道
 *   - 面板打开/关闭管理
 *   - 待派兵/待改道模式管理
 *   - 自动征兵 + 自动派遣调度
 *   - 滑动交互（自动派遣手势检测）
 *   - 自动派遣可视化（金色箭头线 + 蓝色预览线）
 *
 * 注意：这是一个实例类，由 GameManager 在 onLoad 中创建并持有。
 *       游戏开始时通过 init() 注入依赖引用。
 */
export class PlayerCommandManager {

    /** 地图节点实体列表引用 */
    private _nodes: NodeEntity[] = [];

    /** 地图边实体列表引用 */
    private _edges: EdgeEntity[] = [];

    /** 军队实体列表引用 */
    private _armies: ArmyEntity[] = [];

    /** 地图视图管理器引用 */
    private _mapView: MapViewManager | null = null;

    /** 节点信息面板 */
    private _nodePanel: NodePanel | null = null;

    /** 边信息面板 */
    private _edgePanel: EdgePanel | null = null;

    /** 军队信息面板 */
    private _armyPanel: ArmyPanel | null = null;

    // ==================== 待派兵 / 待改道 ====================

    /** 待派兵信息：{ nodeId: 源节点ID, count: 出兵数量 }，null 表示无待处理 */
    private _pendingSendTroops: { nodeId: number; count: number } | null = null;

    /** 待改道信息：{ armyId: 军队ID }，null 表示无待处理 */
    private _pendingArmyRedirect: { armyId: number } | null = null;

    // ==================== 自动派遣 ====================

    /**
     * 自动派遣映射表：源节点ID → 目标节点ID
     * 约束：一个源节点只能有一个目标节点；一个目标节点可以有多个源节点
     */
    private _autoDispatchMap: Map<number, number> = new Map();

    /**
     * 自动派遣可视化线条：源节点ID → Graphics（金色箭头线）
     * 挂载在 mapLayer 上，取消派遣时 destroy
     */
    private _autoDispatchLines: Map<number, Graphics> = new Map();

    /**
     * 自动派遣冷却计数器：源节点ID → 剩余冷却帧数
     * 每次成功派出军队后设为 10 帧，防止同帧重复派兵
     */
    private _autoDispatchCooldown: Map<number, number> = new Map();

    // ==================== 滑动追踪（自动派遣手势检测） ====================

    /** 当前滑动操作的起始节点ID，-1 表示无活跃滑动 */
    private _swipeSourceNodeId: number = -1;

    /** 滑动起始时的 UI 坐标位置（屏幕像素） */
    private _swipeStartPos: Vec2 = new Vec2();

    /** 手指在空白区域停留的累计时间（秒），达到 0.5s 时取消自动派遣 */
    private _swipeTimer: number = 0;

    /** 当前是否有活跃的滑动操作 */
    private _swipeActive: boolean = false;

    /** 滑动预览线 Graphics（蓝色半透明），跟随手指实时绘制 */
    private _swipePreviewLine: Graphics | null = null;

    // ==================== 初始化 ====================

    /**
     * 初始化（或重新绑定）所有外部引用
     *
     * 每次新游戏/读档后调用，传入最新的实体引用和 UI 面板引用。
     * 同时重置所有自动派遣和滑动相关状态。
     *
     * @param nodes     地图节点实体列表
     * @param edges     地图边实体列表
     * @param armies    军队实体列表
     * @param mapView   地图视图管理器
     * @param nodePanel 节点信息面板
     * @param edgePanel 边信息面板
     * @param armyPanel 军队信息面板
     * @returns 无
     */
    init(
        nodes: NodeEntity[],
        edges: EdgeEntity[],
        armies: ArmyEntity[],
        mapView: MapViewManager,
        nodePanel: NodePanel | null,
        edgePanel: EdgePanel | null,
        armyPanel: ArmyPanel | null,
    ): void {
        this._nodes = nodes;
        this._edges = edges;
        this._armies = armies;
        this._mapView = mapView;
        this._nodePanel = nodePanel;
        this._edgePanel = edgePanel;
        this._armyPanel = armyPanel;

        // 重置待派兵/改道模式
        this._pendingSendTroops = null;
        this._pendingArmyRedirect = null;

        // 重置自动派遣
        this._autoDispatchMap.clear();
        this._autoDispatchCooldown.clear();
        for (const g of this._autoDispatchLines.values()) {
            g.node.destroy();
        }
        this._autoDispatchLines.clear();
        this.endSwipe();
    }

    /** 更新军队引用（GameManager.update 中每帧同步） */
    set armies(v: ArmyEntity[]) {
        this._armies = v;
    }

    /** 是否有待派兵/待改道模式激活中 */
    get hasPendingMode(): boolean {
        return this._pendingSendTroops !== null || this._pendingArmyRedirect !== null;
    }

    /**
     * 设置待派兵信息（由 EventBus NODE_SEND_TROOPS 回调调用）
     *
     * @param v  待派兵信息或 null 取消
     * @returns 无
     */
    setPendingSendTroops(v: { nodeId: number; count: number } | null): void {
        this._pendingSendTroops = v;
    }

    // ==================== 点击处理 ====================

    /**
     * 点击某个节点 → 弹出 NodePanel 或处理待派兵/改道
     *
     * 逻辑：
     *   1. 如果有待派兵 → 以点击节点为目标出兵
     *   2. 如果有待改道 → 以点击节点为目标改道
     *   3. 否则 → 关闭所有面板，打开 NodePanel
     *
     * @param nodeId  被点击的节点ID
     * @returns 无
     */
    onNodeClicked(nodeId: number): void {
        if (this._pendingSendTroops) {
            const p = this._pendingSendTroops;
            this._cancelPendingModes();
            if (p.nodeId === nodeId) return;
            this._dispatchTroops(p.nodeId, p.count, nodeId);
            return;
        }

        if (this._pendingArmyRedirect) {
            const p = this._pendingArmyRedirect;
            this._cancelPendingModes();
            this._redirectArmy(p.armyId, nodeId);
            return;
        }

        if (!this._nodePanel) return;
        const node = this._nodes[nodeId];
        if (!node) return;

        this._closeAllPanels();
        this._nodePanel.bindToEntity(node, OwnerType.PLAYER);
        this._nodePanel.node.active = true;

        if (this._mapView) this._mapView.refreshNodeViews(this._nodes);
    }

    /**
     * 点击线路 → 弹出 EdgePanel
     *
     * @param edgeId  被点击的边ID
     * @returns 无
     */
    onEdgeClicked(edgeId: number): void {
        if (!this._edgePanel) return;
        const edge = this._edges.find(e => e.id === edgeId);
        if (!edge) return;

        this._closeAllPanels();
        this._edgePanel.bindToEntity(edge);
        this._edgePanel.node.active = true;
    }

    /**
     * 点击军队 → 弹出 ArmyPanel 或进入改道模式
     *
     * 逻辑：
     *   - 非玩家军队 → 忽略
     *   - 行军中的军队 → 进入改道模式（等待点击目标节点）
     *   - 其他 → 打开 ArmyPanel
     *
     * @param armyId  被点击的军队ID
     * @returns 无
     */
    onArmyClicked(armyId: number): void {
        if (!this._armyPanel) return;
        const army = this._armies.find(a => a.id === armyId);
        if (!army) return;

        if (army.ownerId !== OwnerType.PLAYER) return;

        if (army.state === ArmyState.MOVING) {
            console.log(`[PlayerCommand] 待改道: 军队#${armyId} — 点击目标节点`);
            this._pendingArmyRedirect = { armyId };
            return;
        }

        this._closeAllPanels();
        this._armyPanel.bindToEntity(army);
        this._armyPanel.node.active = true;
    }

    /**
     * 取消待派兵/待改道模式
     *
     * 调用时机：玩家点击空白区域取消操作
     *
     * @returns 无
     */
    cancelPendingModes(): void {
        this._cancelPendingModes();
    }

    // ==================== 内部点击辅助 ====================

    /** 取消待派兵和待改道的等待状态 */
    private _cancelPendingModes(): void {
        if (this._pendingSendTroops) {
            console.log(`[PlayerCommand] 取消派兵`);
            this._pendingSendTroops = null;
        }
        if (this._pendingArmyRedirect) {
            console.log(`[PlayerCommand] 取消改道`);
            this._pendingArmyRedirect = null;
        }
    }

    /** 关闭全部面板（NodePanel + EdgePanel + ArmyPanel） */
    private _closeAllPanels(): void {
        if (this._nodePanel) this._nodePanel.node.active = false;
        if (this._edgePanel) this._edgePanel.node.active = false;
        if (this._armyPanel) this._armyPanel.node.active = false;
    }

    // ==================== 自动征兵 ====================

    /**
     * 自动征兵调度（每帧由 update 调用）
     *
     * 遍历所有玩家节点，满足条件时自动发起征兵：
     *   1. 节点设置了 autoRecruitThreshold > 0
     *   2. 征兵队列未满
     *   3. 当前部队（驻军 + 征兵中）总和 < 阈值
     *   4. 玩家有足够金币（100）
     *
     * @returns 无
     */
    processAutoRecruit(): void {
        for (const node of this._nodes) {
            if (node.ownerId !== OwnerType.PLAYER) continue;
            if (node.autoRecruitThreshold <= 0) continue;
            if (node.isRecruitQueueFull) continue;
            let all = node.recruitQueue.reduce((total, cur) => total + cur.soldierCount, 0);
            all += node.garrisonCount;
            if (all >= node.autoRecruitThreshold) continue;

            const cost = 100;
            if (!EconomySystem.canAfford(OwnerType.PLAYER, cost)) continue;
            RecruitSystem.startRecruit(node, OwnerType.PLAYER, cost);
            console.log(`自动征兵 ${cost} 人`);
        }
    }

    /** 实时刷新已打开的面板数据 */
    refreshActivePanels(): void {
        if (this._nodePanel && this._nodePanel.node.active) this._nodePanel.refreshLight();
        if (this._edgePanel && this._edgePanel.node.active) this._edgePanel.refresh();
        if (this._armyPanel && this._armyPanel.node.active) this._armyPanel.refresh();
    }

    // ==================== 滑动交互（自动派遣） ====================

    /**
     * 滑动开始回调（手指从己方节点移出超过阈值时触发）
     *
     * 作用：记录滑动起点状态，激活滑动追踪
     *
     * @param nodeId   滑动起始节点ID
     * @param startPos 滑动起始 UI 坐标（屏幕像素）
     * @returns 无
     */
    onSwipeStart(nodeId: number, startPos: Vec2): void {
        if (!this._mapView) return;
        const node = this._nodes[nodeId];
        if (!node || node.ownerId !== OwnerType.PLAYER) return;
        console.log(`滑动开始回调`);
        this._swipeSourceNodeId = nodeId;
        this._swipeStartPos.set(startPos);
        this._swipeActive = true;
        this._swipeTimer = 0;
    }

    /**
     * 滑动移动回调（每帧 TOUCH_MOVE 事件触发）
     *
     * 作用：
     *   1. 将屏幕坐标转为地图坐标
     *   2. 检测手指是否在某个节点附近 → 绘制蓝色预览线到该节点
     *   3. 手指在空白区域时累加计时器，≥0.5s 且该源节点已有派遣时取消
     *
     * @param e  触摸事件对象，用于获取当前 UI 坐标
     * @returns 无
     */
    onSwipeMove(e: EventTouch): void {
        console.log(`滑动移动回调`);
        if (!this._mapView || !this._mapView.mapLayer) return;
        const curPos = e.getUILocation();
        const mapPos = this._mapView.uiToMapPos(curPos.x, curPos.y);
        if (!mapPos) return;
        const mapX = mapPos.x;
        const mapY = mapPos.y;

        const srcNode = this._nodes[this._swipeSourceNodeId];
        if (!srcNode) return;

        const nearNodeId = this._findNodeAtMapPos(mapX, mapY);

        if (nearNodeId >= 0 && nearNodeId !== this._swipeSourceNodeId) {
            this._swipeTimer = 0;
            this._drawSwipePreview(srcNode.position.x, srcNode.position.y,
                this._nodes[nearNodeId].position.x, this._nodes[nearNodeId].position.y);
        } else {
            this._swipeTimer += 1 / 60;
            this._drawSwipePreview(srcNode.position.x, srcNode.position.y, mapX, mapY);
        }
    }

    /**
     * 滑动结束回调（手指抬起时触发）
     *
     * 作用：检测手指最终位置是否在某个节点上，是则建立/替换自动派遣，
     *      不在节点上则查看时间是否大于0.5，若大于则删除之前的自动派遣
     *
     * @param e  触摸事件对象，用于获取最终 UI 坐标
     * @returns 无
     */
    onSwipeEnd(e: EventTouch): void {
        if (!this._mapView || !this._mapView.mapLayer) { this.endSwipe(); return; }
        const curPos = e.getUILocation();
        const mapPos = this._mapView.uiToMapPos(curPos.x, curPos.y);
        if (!mapPos) { this.endSwipe(); return; }
        const mapX = mapPos.x;
        const mapY = mapPos.y;

        const nearNodeId = this._findNodeAtMapPos(mapX, mapY);
        console.log(`滑动操作结束;滑动结束位置为：X: ${mapX} Y:${mapY},附近节点ID：${nearNodeId}`);
        if (nearNodeId >= 0 && nearNodeId !== this._swipeSourceNodeId) {
            this.setAutoDispatch(this._swipeSourceNodeId, nearNodeId);
        } else if (this._autoDispatchMap.has(this._swipeSourceNodeId)) {
            if (this._swipeTimer >= 0.5) {
                this.cancelAutoDispatch(this._swipeSourceNodeId);
                this.endSwipe();
            }
        }

        this.endSwipe();
    }

    /**
     * 结束滑动追踪状态
     *
     * 作用：重置所有滑动状态变量，清除预览线，关闭滑动激活标记
     *
     * @returns 无
     */
    endSwipe(): void {
        console.log(`结束滑动追踪状态`);
        this._swipeActive = false;
        this._swipeSourceNodeId = -1;
        this._swipeTimer = 0;
        this._clearSwipePreview();
    }

    // ==================== 坐标查找 ====================

    /**
     * 在地图坐标 (mapX, mapY) 处查找最近的节点
     *
     * 作用：遍历所有节点，按距离判断手指是否在节点命中范围内
     *
     * @param mapX  地图 X 坐标
     * @param mapY  地图 Y 坐标
     * @returns 命中节点的 id，无命中返回 -1
     */
    private _findNodeAtMapPos(mapX: number, mapY: number): number {
        const HIT_RADIUS = MapViewManager.NODE_RADIUS + 20;
        for (const node of this._nodes) {
            const dx = node.position.x - mapX;
            const dy = node.position.y - mapY;
            if (dx * dx + dy * dy < HIT_RADIUS * HIT_RADIUS) {
                console.log(`附近的节点坐标是：(${node.position.x},${node.position})`);
                return node.id;
            }
        }
        return -1;
    }

    // ==================== 自动派遣管理 ====================

    /**
     * 建立（或替换）自动派遣关系
     *
     * 作用：
     *   1. 若该源节点已有旧派遣 → 先移除旧可视化线
     *   2. 若 src === tgt → 取消派遣（自己到自己是无效的）
     *   3. 否则写入映射表并绘制金色箭头线
     *
     * 约束：一个源节点只能有一个目标节点；目标节点可以有多个源节点
     *
     * @param srcNodeId  源节点ID（玩家控制的出兵节点）
     * @param tgtNodeId  目标节点ID（军队自动派往的节点）
     * @returns 无
     */
    setAutoDispatch(srcNodeId: number, tgtNodeId: number): void {
        const oldTarget = this._autoDispatchMap.get(srcNodeId);
        if (oldTarget !== undefined) {
            this._removeAutoDispatchLine(srcNodeId);
        }
        if (srcNodeId === tgtNodeId) {
            this._autoDispatchMap.delete(srcNodeId);
            return;
        }
        this._autoDispatchMap.set(srcNodeId, tgtNodeId);
        this._drawAutoDispatchLine(srcNodeId, tgtNodeId);
        console.log(`[PlayerCommand] 自动派遣: 节点#${srcNodeId} → #${tgtNodeId}`);
    }

    /**
     * 取消指定源节点的自动派遣
     *
     * 作用：从映射表删除记录，销毁可视化箭头线
     *
     * @param srcNodeId  要取消派遣的源节点ID
     * @returns 无
     */
    cancelAutoDispatch(srcNodeId: number): void {
        if (!this._autoDispatchMap.has(srcNodeId)) return;
        this._autoDispatchMap.delete(srcNodeId);
        this._removeAutoDispatchLine(srcNodeId);
        console.log(`[PlayerCommand] 取消自动派遣: 节点#${srcNodeId}`);
    }

    /**
     * 自动派遣调度循环（每帧由 GameManager.update 调用）
     *
     * 作用：遍历所有派遣对，满足条件时将源节点全部驻军派向目标节点
     *
     * 执行逻辑：
     *   1. 检查源节点是否仍属玩家 → 否则取消该派遣
     *   2. 检查驻军数 > 0
     *   3. 检查冷却计数器 → 冷却中跳过（每次派兵后设 10 帧冷却）
     *   4. 寻路 → 不可达跳过
     *   5. 清空源节点驻军，创建军队沿路径出发
     *
     * @returns 无
     */
    processAutoDispatch(): void {
        for (const [srcNodeId, tgtNodeId] of this._autoDispatchMap) {
            const srcNode = this._nodes[srcNodeId];
            if (!srcNode || srcNode.ownerId !== OwnerType.PLAYER) {
                this.cancelAutoDispatch(srcNodeId);
                continue;
            }
            if (srcNode.garrisonCount <= 0) continue;

            const cooldown = this._autoDispatchCooldown.get(srcNodeId) || 0;
            if (cooldown > 0) {
                this._autoDispatchCooldown.set(srcNodeId, cooldown - 1);
                continue;
            }

            const path = PathfindingManager.findPath(srcNodeId, tgtNodeId);
            if (!path || path.length < 2) continue;

            const count = srcNode.garrisonCount;
            srcNode.garrisonCount = 0;
            ArmyManager.createArmy(OwnerType.PLAYER, count, path);
            this._autoDispatchCooldown.set(srcNodeId, 10);
        }
    }

    // ==================== 自动派遣可视化 ====================

    /**
     * 绘制自动派遣箭头线（金色半透明 + 中段箭头）
     *
     * 作用：在 mapLayer 上创建 Graphics 节点，画出从源到目标的连线
     *       并在中点处绘制 V 形箭头指示方向
     *
     * @param srcNodeId  源节点ID
     * @param tgtNodeId  目标节点ID
     * @returns 无
     */
    private _drawAutoDispatchLine(srcNodeId: number, tgtNodeId: number): void {
        if (!this._mapView || !this._mapView.mapLayer) return;
        this._removeAutoDispatchLine(srcNodeId);

        const src = this._nodes[srcNodeId];
        const tgt = this._nodes[tgtNodeId];
        if (!src || !tgt) return;

        const lineNode = new Node(`AD_Line_${srcNodeId}`);
        const g = lineNode.addComponent(Graphics);
        g.strokeColor = new Color(255, 200, 50, 200);
        g.lineWidth = 2;
        g.moveTo(src.position.x, src.position.y);
        g.lineTo(tgt.position.x, tgt.position.y);
        g.stroke();

        const midX = (src.position.x + tgt.position.x) / 2;
        const midY = (src.position.y + tgt.position.y) / 2;
        const angle = Math.atan2(tgt.position.y - src.position.y, tgt.position.x - src.position.x);
        const arrowLen = 10;
        g.strokeColor = new Color(255, 200, 50, 200);
        g.moveTo(midX, midY);
        g.lineTo(
            midX - arrowLen * Math.cos(angle - 0.5),
            midY - arrowLen * Math.sin(angle - 0.5)
        );
        g.stroke();
        g.moveTo(midX, midY);
        g.lineTo(
            midX - arrowLen * Math.cos(angle + 0.5),
            midY - arrowLen * Math.sin(angle + 0.5)
        );
        g.stroke();

        this._mapView.mapLayer.addChild(lineNode);
        this._autoDispatchLines.set(srcNodeId, g);
    }

    /**
     * 移除指定源节点的自动派遣可视化线
     *
     * 作用：销毁 Graphics 节点并从映射表中删除
     *
     * @param srcNodeId  源节点ID
     * @returns 无
     */
    private _removeAutoDispatchLine(srcNodeId: number): void {
        const g = this._autoDispatchLines.get(srcNodeId);
        if (g) {
            g.node.destroy();
            this._autoDispatchLines.delete(srcNodeId);
        }
    }

    /**
     * 绘制滑动预览线（蓝色半透明）
     *
     * 作用：实时绘制从源节点到手指当前位置的预览线
     *       每次调用先清除旧线再画新线，避免残留
     *
     * @param x1  源节点地图 X 坐标
     * @param y1  源节点地图 Y 坐标
     * @param x2  手指当前位置地图 X 坐标（或目标节点 X）
     * @param y2  手指当前位置地图 Y 坐标（或目标节点 Y）
     * @returns 无
     */
    private _drawSwipePreview(x1: number, y1: number, x2: number, y2: number): void {
        this._clearSwipePreview();
        if (!this._mapView || !this._mapView.mapLayer) return;
        const lineNode = new Node('SwipePreview');
        const g = lineNode.addComponent(Graphics);
        g.strokeColor = new Color(100, 200, 255, 180);
        g.lineWidth = 2;
        g.moveTo(x1, y1);
        g.lineTo(x2, y2);
        g.stroke();
        this._mapView.mapLayer.addChild(lineNode);
        lineNode.setSiblingIndex(9999);
        this._swipePreviewLine = g;
    }

    /**
     * 清除滑动预览线
     *
     * 作用：销毁滑动预览线 Graphics 节点
     *
     * @returns 无
     */
    private _clearSwipePreview(): void {
        if (this._swipePreviewLine) {
            this._swipePreviewLine.node.destroy();
            this._swipePreviewLine = null;
        }
    }

    // ==================== 派兵 / 改道 ====================

    /**
     * 从源节点向目标节点派兵（一次性，非自动派遣）
     *
     * 作用：BFS 寻路 → 扣除源节点驻军 → 创建军队沿路径行军
     *
     * @param srcNodeId     源节点ID（出兵节点）
     * @param count         派出士兵数量
     * @param targetNodeId  目标节点ID（目的地）
     * @returns 无
     */
    private _dispatchTroops(srcNodeId: number, count: number, targetNodeId: number): void {
        const srcNode = this._nodes[srcNodeId];
        if (!srcNode || count <= 0 || count > srcNode.garrisonCount) return;

        const path = PathfindingManager.findPath(srcNodeId, targetNodeId);
        if (!path || path.length < 2) {
            console.log(`[PlayerCommand] 派兵失败: 节点#${srcNodeId} → #${targetNodeId} 无路径`);
            return;
        }

        console.log(`[PlayerCommand] 派兵: 节点#${srcNodeId} → #${targetNodeId}, 数量=${count}, 路径=${path.join('→')}`);
        srcNode.garrisonCount -= count;
        ArmyManager.createArmy(OwnerType.PLAYER, count, path);
        if (this._mapView) this._mapView.refreshNodeViews(this._nodes);
    }

    /**
     * 改道：将军队目标改为新节点
     *
     * 作用：调用 ArmyManager.setReroute 弹出改道路径
     *
     * @param armyId        军队ID
     * @param targetNodeId  新目标节点ID
     * @returns 无
     */
    private _redirectArmy(armyId: number, targetNodeId: number): void {
        const army = this._armies.find(a => a.id === armyId);
        if (!army) return;

        const success = ArmyManager.setReroute(armyId, targetNodeId);
        if (success) {
            console.log(`[PlayerCommand] 改道: 军队#${armyId}, 新目标#${targetNodeId}`);
        } else {
            console.log(`[PlayerCommand] 改道失败: 军队#${armyId} → #${targetNodeId}`);
        }
    }
}