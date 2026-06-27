import { _decorator, Component,Node, Graphics, Color, EventTouch, Vec2 } from 'cc';
import { NodeEntity } from '../entity/NodeEntity';
import { EdgeEntity } from '../entity/EdgeEntity';
import { ArmyEntity } from '../entity/ArmyEntity';
import { GameState, MapSize, Difficulty, FogMode, GameSpeed, OwnerType, ArmyState, AIAllianceState } from '../config/EnumDefine';
import { GameConfig } from '../config/GameConfig';
import { MapGenerator, MapGenerateResult } from '../map/MapGenerator';
import { ArmyManager } from '../manager/ArmyManager';
import { PathfindingManager } from '../manager/PathfindingManager';
import { MapViewManager } from '../manager/MapViewManager';
import { GameEventBinder } from '../manager/GameEventBinder';
import { NodeBattleSystem } from '../battle/NodeBattleSystem';
import { ArmyCollisionSystem } from '../battle/ArmyCollisionSystem';
import { EconomySystem } from '../economy/EconomySystem';
import { RecruitSystem } from '../recruit/RecruitSystem';
import { NodeUpgradeSystem } from '../manager/NodeUpgradeSystem';
import { NodeConvertSystem } from '../manager/NodeConvertSystem';
import { AIController } from '../ai/AIController';
import { FogSystem } from '../fog/FogSystem';
import { EventSystem } from '../event/EventSystem';
import { SaveSystem } from '../save/SaveSystem';
import { HUDController } from '../ui/HUDController';
import { SaveSlotsUI } from '../ui/SaveSlotsUI';
import { GameOverUI } from '../ui/GameOverUI';
import { NewGameConfig } from '../ui/LobbyUI';
import { NodePanel } from '../ui/NodePanel';
import { EdgePanel } from '../ui/EdgePanel';
import { ArmyPanel } from '../ui/ArmyPanel';

const { ccclass, property } = _decorator;

// 游戏总控制器，负责初始化所有子系统并按顺序驱动主循环
@ccclass('GameManager')
export class GameManager extends Component {

    // --- UI 组件引用（编辑器拖入） ---
    @property(HUDController)
    hud: HUDController | null = null;

    @property(SaveSlotsUI)
    saveSlotsUI: SaveSlotsUI | null = null;

    @property(GameOverUI)
    gameOverUI: GameOverUI | null = null;

    @property(NodePanel)
    nodePanel: NodePanel | null = null;

    @property(EdgePanel)
    edgePanel: EdgePanel | null = null;

    @property(ArmyPanel)
    armyPanel: ArmyPanel | null = null;

    // --- MapView ---
    private _mapView!: MapViewManager;

    private _pendingSendTroops: { nodeId: number; count: number } | null = null;
    private _pendingArmyRedirect: { armyId: number } | null = null;

    // --- 自动派遣 ---
    /**
     * 自动派遣映射表：源节点ID → 目标节点ID
     * 约束：一个源节点只能有一个目标节点；一个目标节点可以有多个源节点
     */
    private _autoDispatchMap: Map<number, number> = new Map();
    /**
     * 自动派遣可视化线条：源节点ID → Graphics（金色箭头线）
     * 挂载在 _mapLayer 上，取消派遣时 destroy
     */
    private _autoDispatchLines: Map<number, Graphics> = new Map();
    /**
     * 自动派遣冷却计数器：源节点ID → 剩余冷却帧数
     * 每次成功派出军队后设为 10 帧，防止同帧重复派兵
     */
    private _autoDispatchCooldown: Map<number, number> = new Map();

    // --- 滑动追踪（自动派遣手势检测） ---
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

    // --- 游戏状态 ---
    private _gameState: GameState = GameState.PLAYING;
    private _totalTime = 0;
    private _lastSaveTime = 0;

    // --- 配置 ---
    private _mapSize: MapSize = MapSize.SMALL;
    private _aiCount = 1;
    private _difficulty: Difficulty = Difficulty.EASY;
    private _fogMode: FogMode = FogMode.NONE;
    private _gameSpeed: GameSpeed = GameSpeed.X1;

    // --- 地图 ---
    private _mapResult: MapGenerateResult | null = null;

    // --- 实体缓存（每帧传给各子系统） ---
    private _nodes: NodeEntity[] = [];
    private _edges: EdgeEntity[] = [];
    private _armies: ArmyEntity[] = [];
    private _aiIds: string[] = [];
    private _playerNodeId = -1;
    private _nextArmyId = 1;

    // --- 外部回调 ---
    onStateChanged: ((state: GameState) => void) | null = null;

    // 场景加载后自动启动或打开存档面板
    onLoad(): void {
        this._mapView = new MapViewManager(this.node);
        if (NewGameConfig.mapSize) {
            this.startGame(
                NewGameConfig.mapSize,
                NewGameConfig.aiCount,
                NewGameConfig.difficulty,
                NewGameConfig.fogMode,
                NewGameConfig.gameSpeed,
            );
        }
        if (!this._nodes.length && this.saveSlotsUI) {
            this.saveSlotsUI.node.active = true;
            this.saveSlotsUI.refresh();
        }
    }

    onDestroy(): void {
        this._mapView.clearMap();
    }

    // 公开入口：由 LobbyUI → NewGameConfig 自动触发，也可外部直接调用
    startGame(mapSize: MapSize, aiCount: number, difficulty: Difficulty, fogMode: FogMode, gameSpeed: GameSpeed): void {
        console.log(`[GameManager] 开始游戏: mapSize=${mapSize}, aiCount=${aiCount}, difficulty=${difficulty}, fog=${fogMode}, speed=${gameSpeed}`);
        this._mapSize = mapSize;
        this._aiCount = aiCount;
        this._difficulty = difficulty;
        this._fogMode = fogMode;
        this._gameSpeed = gameSpeed;

        this.doStart();
    }

    // 公开入口：由 LobbyUI 的 onContinueGame 调用（需配合 SaveSlotsUI 选槽位后调用）
    loadGame(slotId: number): void {
        const data = SaveSystem.load(slotId);
        if (!data) return;

        this._mapSize = data.mapSize as MapSize;
        this._aiCount = data.aiNodeIds.length;
        this._difficulty = data.difficulty as Difficulty;
        this._fogMode = data.fogMode as FogMode;
        this._gameSpeed = data.gameSpeed as GameSpeed;
        this._totalTime = data.totalTime;
        this._playerNodeId = data.playerNodeId;
        this._aiIds = data.aiNodeIds.map((_, i) => `ai_${i}`);
        this._nextArmyId = data.nextArmyId;

        const restored = SaveSystem.restore(data);
        this._nodes = restored.nodes;
        this._edges = restored.edges;
        this._armies = restored.armies;

        // 重初始化各子系统
        this.initSystems(false);
        this._mapView.renderMap(this._nodes, this._edges, this._aiIds);
        this.wireCallbacks();
        this.wireUI();
        this.changeState(GameState.PLAYING);
    }

    private doStart(): void {
        this._totalTime = 0;
        this._lastSaveTime = 0;

        // 1. 生成地图
        this._mapResult = MapGenerator.generate(this._mapSize, this._aiCount);
        this._nodes = this._mapResult.nodes;
        this._edges = this._mapResult.edges;
        this._playerNodeId = this._mapResult.playerNodeId;
        this._nextArmyId = 1;

        // 2. 为 AI 分配唯一 ID，并更新其出生节点的 ownerId
        this._aiIds = [];
        for (let i = 0; i < this._aiCount; i++) {
            const aiId = `ai_${i}`;
            this._aiIds.push(aiId);
            const birthNodeId = this._mapResult.aiNodeIds[i];
            const node = this._nodes[birthNodeId];
            if (node) {
                (node.ownerId as string) = aiId;
            }
        }

        // 3. 初始化各子系统（全新开局）
        this.initSystems(true);
        this._mapView.renderMap(this._nodes, this._edges, this._aiIds);
        this.wireCallbacks();
        this.wireUI();
        this.changeState(GameState.PLAYING);
    }

    // 统一初始化/重初始化所有子系统
    private initSystems(isNewGame: boolean): void {
        // 经济：玩家初始金币，AI 各初始金币
        if (isNewGame) {
            const aiGold: Record<string, number> = {};
            for (const aiId of this._aiIds) {
                aiGold[aiId] = GameConfig.INITIAL_GOLD;
            }
            EconomySystem.init(GameConfig.INITIAL_GOLD, aiGold);
        }

        // 行军管理器
        ArmyManager.init(this._edges, this._nodes);

        // 迷雾
        FogSystem.init(this._fogMode, this._nodes, this._edges);

        // AI
        if (this._aiIds.length > 0) {
            AIController.init(this._aiIds, this._difficulty, this._nodes, this._edges);
        }

        // 随机事件
        EventSystem.init();
        EventSystem.updateNodes(this._nodes);

        // 自动派遣重置
        this._autoDispatchMap.clear();
        this._autoDispatchCooldown.clear();
        for (const g of this._autoDispatchLines.values()) {
            g.node.destroy();
        }
        this._autoDispatchLines.clear();
        this.endSwipe();
    }

    update(dt: number): void {
        if (this._gameState !== GameState.PLAYING) return;

        // 游戏速度倍率
        const logicDt = dt * this._gameSpeed;
        this._totalTime += logicDt;

        // --- 1. 行军推进（事件通过 EventBus 发送） ---
        ArmyManager.update(logicDt);
        this._armies = ArmyManager.armies;

        // --- 2. 经济更新（事件通过 EventBus 发送） ---
        EconomySystem.update(logicDt, this._nodes, this._armies);

        // --- 3. 任务推进（征兵 / 节点升级 / 节点转换） ---
        RecruitSystem.update(logicDt, this._nodes);
        NodeUpgradeSystem.update(logicDt, this._nodes);
        NodeConvertSystem.update(logicDt, this._nodes);

        // --- 4. 迷雾更新 ---
        FogSystem.update(logicDt, this._nodes);

        // --- 5. 随机事件（事件通过 EventBus 发送） ---
        EventSystem.updateNodes(this._nodes);
        EventSystem.update(logicDt, EconomySystem.allOwnerIds);

        // --- 6. AI 决策（internally calls ArmyManager.createArmy / RecruitSystem / NodeUpgradeSystem 等） ---
        void AIController.update(logicDt, this._nodes, this._edges, this._armies);
        this._armies = ArmyManager.armies; // AI 可能派兵，刷新

        // --- 6.5 玩家自动征兵 ---
        this.processAutoRecruit();

        // --- 6.6 玩家自动派遣 ---
        this.processAutoDispatch();

        // --- 7. 胜败判定 ---
        this.checkWinLose();

        // --- 8. 驱动 HUD ---
        if (this.hud) {
            this.hud.bindSpeed(this._gameSpeed);
            this.hud.refresh(this._totalTime, this._gameState, AIController.allianceState);
        }

        // --- 9. 刷新地图视图 ---
        this._mapView.refreshNodeViews(this._nodes);

        // --- 10. 刷新军队视图 ---
        this._mapView.refreshArmyViews(this._armies);

        // --- 11. 自动保存 ---
        this.autoSave();

        // --- 12. 实时刷新活跃面板 ---
        this.refreshActivePanels();
    }

    // 军队到达节点：NodeBattleSystem 结算攻占 / 合并
    private handleArmyArrival(army: ArmyEntity, nodeId: number): void {
        const node = this._nodes[nodeId];
        if (!node) return;

        const isFinalDest = nodeId === army.destinationNodeId;

        if (isFinalDest) {
            NodeBattleSystem.resolve(army, node);
            return;
        }

        // 中间节点：己方越过，敌方攻占
        if (army.ownerId === node.ownerId) {
            console.log(`[GameManager] 军队#${army.id} 越过己方中间节点#${nodeId}`);
            ArmyManager.advanceArmy(army.id);
            return;
        }

        NodeBattleSystem.resolve(army, node);
    }

    // 军队线路上遭遇：ArmyCollisionSystem 结算
    private handleEdgeEncounter(armyA: ArmyEntity, armyB: ArmyEntity): void {
        const result = ArmyCollisionSystem.resolve(armyA, armyB);
        if (result) {
            ArmyManager.removeArmy(result.loser.id);
            this._armies = ArmyManager.armies;
        }
    }

    // 胜败检测：统计各势力节点数
    private checkWinLose(): void {
        const ownerCounts = new Map<string, number>();
        for (const node of this._nodes) {
            if (node.ownerId === OwnerType.NEUTRAL) continue;
            ownerCounts.set(node.ownerId, (ownerCounts.get(node.ownerId) || 0) + 1);
        }

        const playerCount = ownerCounts.get(OwnerType.PLAYER) || 0;

        // 玩家节点为0 → 失败
        if (playerCount === 0) {
            this.changeState(GameState.LOSE);
            return;
        }

        // 检查是否有存活 AI
        let aliveAiCount = 0;
        for (const aiId of this._aiIds) {
            if ((ownerCounts.get(aiId) || 0) > 0) {
                aliveAiCount++;
            }
        }

        // 所有 AI 节点为0 → 胜利
        if (aliveAiCount === 0) {
            this.changeState(GameState.WIN);
        }
    }

    // 自动保存
    private autoSave(): void {
        if (this._totalTime - this._lastSaveTime < GameConfig.AUTO_SAVE_INTERVAL) return;
        this._lastSaveTime = this._totalTime;

        // 自动保存到槽位0
        SaveSystem.save(
            0,
            this._nodes,
            this._edges,
            this._armies,
            this._mapSize,
            this._difficulty,
            this._fogMode,
            this._gameSpeed,
            this._totalTime,
            this._playerNodeId,
            this._mapResult ? this._mapResult.aiNodeIds : [],
            this._nextArmyId,
            {},
        );
    }

    // 状态切换 + 回调通知
    private changeState(state: GameState): void {
        console.log(`[GameManager] 状态变更: ${GameState[this._gameState]} → ${GameState[state]}`);
        this._gameState = state;
        if (this.onStateChanged) this.onStateChanged(state);

        // 游戏结束 → 弹出 GameOverUI
        if (state === GameState.WIN || state === GameState.LOSE) {
            if (this.gameOverUI) {
                const nodeCount = this._nodes.filter(n => n.ownerId === OwnerType.PLAYER).length;
                const reward = GameConfig.DIFFICULTY_GOLD_REWARD[this._difficulty];
                this.gameOverUI.show(state, this._totalTime, nodeCount, reward);
            }
        }
    }

    /**
     * 委托 GameEventBinder 绑定所有 EventBus 事件
     *
     * 构造 GameEventContext 上下文对象，传入 GameEventBinder.bindAll()，
     * 由 GameEventBinder 统一管理所有 EventBus 监听的注册。
     *
     * @returns 无
     */
    private wireUI(): void {
        GameEventBinder.bindAll({
            nodes: this._nodes,
            edges: this._edges,
            mapView: this._mapView,
            nodePanel: this.nodePanel,
            edgePanel: this.edgePanel,
            armyPanel: this.armyPanel,
            saveSlotsUI: this.saveSlotsUI,
            hud: this.hud,
            loadGame: (slotId) => this.loadGame(slotId),
            togglePause: () => this.togglePause(),
            setGameSpeed: (s) => this.setGameSpeed(s),
            handleArmyArrival: (army, nodeId) => this.handleArmyArrival(army, nodeId),
            handleEdgeEncounter: (armyA, armyB) => this.handleEdgeEncounter(armyA, armyB),
            syncArmies: () => { this._armies = ArmyManager.armies; },
            setPendingSendTroops: (v) => { this._pendingSendTroops = v; },
        });
    }

    // --- 外部只读查询 ---

    get nodes(): NodeEntity[] { return this._nodes; }
    get edges(): EdgeEntity[] { return this._edges; }
    get armies(): ArmyEntity[] { return this._armies; }
    get aiIds(): string[] { return this._aiIds; }
    get totalTime(): number { return this._totalTime; }
    get gameState(): GameState { return this._gameState; }
    get gameSpeed(): GameSpeed { return this._gameSpeed; }
    get mapSize(): MapSize { return this._mapSize; }
    get difficulty(): Difficulty { return this._difficulty; }
    get fogMode(): FogMode { return this._fogMode; }
    get allianceState(): AIAllianceState { return AIController.allianceState; }

    // 暂停 / 继续
    togglePause(): void {
        if (this._gameState === GameState.PLAYING) {
            this.changeState(GameState.PAUSED);
        } else if (this._gameState === GameState.PAUSED) {
            this.changeState(GameState.PLAYING);
        }
    }

    // 调速
    setGameSpeed(speed: GameSpeed): void {
        this._gameSpeed = speed;
    }

    /**
     * 绑定 MapViewManager 的所有回调接口
     *
     * 作用：将 MapViewManager 的触摸/点击事件桥接到 GameManager 的处理方法
     *
     * @returns 无
     */
    private wireCallbacks(): void {
        this._mapView.onNodeClicked = (nodeId) => this.onNodeClicked(nodeId);
        this._mapView.onEdgeClicked = (edgeId) => this.onEdgeClicked(edgeId);
        this._mapView.onArmyClicked = (armyId) => this.onArmyClicked(armyId);
        this._mapView.onSwipeStart = (nodeId, pos) => this.onSwipeStart(nodeId, pos);
        this._mapView.onSwipeMove = (e) => this.onSwipeMove(e);
        this._mapView.onSwipeEnd = (e) => this.onSwipeEnd(e);
        this._mapView.onBlankAreaTap = () => this._cancelPendingModes();
    }

    // 点击某个节点 → 弹出 NodePanel 并绑定数据, 或处理待派兵/改道
    private onNodeClicked(nodeId: number): void {
        // 处理待派兵：以点击节点为目标出兵
        if (this._pendingSendTroops) {
            const p = this._pendingSendTroops;
            this._cancelPendingModes();
            if (p.nodeId === nodeId) return;
            this._dispatchTroops(p.nodeId, p.count, nodeId);
            return;
        }

        // 处理待改道：以点击节点为目标改道
        if (this._pendingArmyRedirect) {
            const p = this._pendingArmyRedirect;
            this._cancelPendingModes();
            this._redirectArmy(p.armyId, nodeId);
            return;
        }

        if (!this.nodePanel) return;
        const node = this._nodes[nodeId];
        if (!node) return;

        this._closeAllPanels();
        this.nodePanel.bindToEntity(node, OwnerType.PLAYER);
        this.nodePanel.node.active = true;

        this._mapView.refreshNodeViews(this._nodes);
    }

    // 点击线路 → EdgePanel
    private onEdgeClicked(edgeId: number): void {
        if (!this.edgePanel) return;
        const edge = this._edges.find(e => e.id === edgeId);
        if (!edge) return;

        this._closeAllPanels();
        this.edgePanel.bindToEntity(edge);
        this.edgePanel.node.active = true;
    }

    // 点击军队 → ArmyPanel 或进入改道模式
    private onArmyClicked(armyId: number): void {
        if (!this.armyPanel) return;
        const army = this._armies.find(a => a.id === armyId);
        if (!army) return;

        if (army.ownerId !== OwnerType.PLAYER) return;

        if (army.state === ArmyState.MOVING) {
            console.log(`[GameManager] 待改道: 军队#${armyId} — 点击目标节点`);
            this._pendingArmyRedirect = { armyId };
            return;
        }

        this._closeAllPanels();
        this.armyPanel.bindToEntity(army);
        this.armyPanel.node.active = true;
    }

    private _cancelPendingModes(): void {
        if (this._pendingSendTroops) {
            console.log(`[GameManager] 取消派兵`);
            this._pendingSendTroops = null;
        }
        if (this._pendingArmyRedirect) {
            console.log(`[GameManager] 取消改道`);
            this._pendingArmyRedirect = null;
        }
    }

    private _closeAllPanels(): void {
        if (this.nodePanel) this.nodePanel.node.active = false;
        if (this.edgePanel) this.edgePanel.node.active = false;
        if (this.armyPanel) this.armyPanel.node.active = false;
    }

    private processAutoRecruit(): void {
        for (const node of this._nodes) {
            if (node.ownerId !== OwnerType.PLAYER) continue;
            if (node.autoRecruitThreshold <= 0) continue;
            if (node.isRecruitQueueFull) continue;
            // 计算正在征兵中的军队与驻扎军队的总数
            let all = node.recruitQueue.reduce((total,cur) => total + cur.soldierCount, 0);
            // console.log(`正在征兵中的人数为： ${all}`);
            all += node.garrisonCount;
            if (all >= node.autoRecruitThreshold) continue;
            
            const cost = 100;
            if (!EconomySystem.canAfford(OwnerType.PLAYER, cost)) continue;
            RecruitSystem.startRecruit(node, OwnerType.PLAYER, cost);
            console.log(`自动征兵 ${cost} 人`);
        }
    }

    private refreshActivePanels(): void {
        if (this.nodePanel && this.nodePanel.node.active) this.nodePanel.refreshLight();
        if (this.edgePanel && this.edgePanel.node.active) this.edgePanel.refresh();
        if (this.armyPanel && this.armyPanel.node.active) this.armyPanel.refresh();
    }

    // ======================== 自动派遣 ========================

    /**
     * 滑动开始回调（手指从己方节点移出超过阈值时触发）
     * 
     * 作用：记录滑动起点状态，激活滑动追踪
     * 
     * @param nodeId  滑动起始节点ID（必须是玩家拥有的节点）
     * @param startPos 滑动起始 UI 坐标（屏幕像素）
     * @returns 无
     */
    private onSwipeStart(nodeId: number, startPos: Vec2): void {
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
     * @param e 触摸事件对象，用于获取当前 UI 坐标
     * @returns 无
     */
    private onSwipeMove(e: EventTouch): void {
         console.log(`滑动移动回调`);
        if (!this._mapView.mapLayer) return;
        const curPos = e.getUILocation();
        const mapPos = this._mapView.uiToMapPos(curPos.x, curPos.y);
        if (!mapPos) return;
        const mapX = mapPos.x;
        const mapY = mapPos.y;

        const srcNode = this._nodes[this._swipeSourceNodeId];
        if (!srcNode) return;

        const nearNodeId = this.findNodeAtMapPos(mapX, mapY);

        if (nearNodeId >= 0 && nearNodeId !== this._swipeSourceNodeId) {
            // 手指在另一个节点上 → 重置计时器，预览线连接到该节点
            this._swipeTimer = 0;
            this.drawSwipePreview(srcNode.position.x, srcNode.position.y,
                this._nodes[nearNodeId].position.x, this._nodes[nearNodeId].position.y);
        } else {
            // 手指在空白区域 → 预览线跟随手指
            this._swipeTimer += 1 / 60;
            this.drawSwipePreview(srcNode.position.x, srcNode.position.y, mapX, mapY);
        }
    }

    /**
     * 滑动结束回调（手指抬起时触发）
     * 
     * 作用：检测手指最终位置是否在某个节点上，是则建立/替换自动派遣，
     *      不在节点上则查看时间是否大于0.5，若大于则删除之前的自动派遣
     * 
     * @param e 触摸事件对象，用于获取最终 UI 坐标
     * @returns 无
     */
    private onSwipeEnd(e: EventTouch): void {
        if (!this._mapView.mapLayer) { this.endSwipe(); return; }
        const curPos = e.getUILocation();
        const mapPos = this._mapView.uiToMapPos(curPos.x, curPos.y);
        if (!mapPos) { this.endSwipe(); return; }
        const mapX = mapPos.x;
        const mapY = mapPos.y;

        const nearNodeId = this.findNodeAtMapPos(mapX, mapY);
        console.log(`滑动操作结束;滑动结束位置为：X: ${mapX} Y:${mapY},附近节点ID：${nearNodeId}`);
        // 手指最终落在有效节点上 → 建立/替换派遣
        if (nearNodeId >= 0 && nearNodeId !== this._swipeSourceNodeId) {
            this.setAutoDispatch(this._swipeSourceNodeId, nearNodeId);
        }
        // 如果当前源节点已有派遣，且空白停留 ≥ 0.5s 则取消已有的自动派遣
        else if (this._autoDispatchMap.has(this._swipeSourceNodeId)) {
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
    private endSwipe(): void {
        console.log(`结束滑动追踪状态`);
        this._swipeActive = false;
        this._swipeSourceNodeId = -1;
        this._swipeTimer = 0;
        this.clearSwipePreview();
    }

    /**
     * 在地图坐标 (mapX, mapY) 处查找最近的节点
     * 
     * 作用：遍历所有节点，按距离判断手指是否在节点命中范围内
     * 
     * @param mapX 地图 X 坐标
     * @param mapY 地图 Y 坐标
     * @returns 命中节点的 id，无命中返回 -1
     */
    private findNodeAtMapPos(mapX: number, mapY: number): number {
        // 命中半径 = 节点半径 + 20px 容差
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
     * @param srcNodeId 源节点ID（玩家控制的出兵节点）
     * @param tgtNodeId 目标节点ID（军队自动派往的节点）
     * @returns 无
     */
    setAutoDispatch(srcNodeId: number, tgtNodeId: number): void {
        const oldTarget = this._autoDispatchMap.get(srcNodeId);
        if (oldTarget !== undefined) {
            this.removeAutoDispatchLine(srcNodeId);
        }
        if (srcNodeId === tgtNodeId) {
            this._autoDispatchMap.delete(srcNodeId);
            return;
        }
        this._autoDispatchMap.set(srcNodeId, tgtNodeId);
        this.drawAutoDispatchLine(srcNodeId, tgtNodeId);
        console.log(`[GameManager] 自动派遣: 节点#${srcNodeId} → #${tgtNodeId}`);
    }

    /**
     * 取消指定源节点的自动派遣
     * 
     * 作用：从映射表删除记录，销毁可视化箭头线
     * 
     * @param srcNodeId 要取消派遣的源节点ID
     * @returns 无
     */
    cancelAutoDispatch(srcNodeId: number): void {
        if (!this._autoDispatchMap.has(srcNodeId)) return;
        this._autoDispatchMap.delete(srcNodeId);
        this.removeAutoDispatchLine(srcNodeId);
        console.log(`[GameManager] 取消自动派遣: 节点#${srcNodeId}`);
    }

    /**
     * 自动派遣调度循环（每帧由 update() 第 6.6 步调用）
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
    private processAutoDispatch(): void {
        for (const [srcNodeId, tgtNodeId] of this._autoDispatchMap) {
            const srcNode = this._nodes[srcNodeId];
            if (!srcNode || srcNode.ownerId !== OwnerType.PLAYER) {
                this.cancelAutoDispatch(srcNodeId);
                continue;
            }
            if (srcNode.garrisonCount <= 0) continue;

            // 冷却机制：每帧 -1，非零时跳过
            const cooldown = this._autoDispatchCooldown.get(srcNodeId) || 0;
            if (cooldown > 0) {
                this._autoDispatchCooldown.set(srcNodeId, cooldown - 1);
                continue;
            }

            const path = PathfindingManager.findPath(srcNodeId, tgtNodeId);
            if (!path || path.length < 2) continue;

            // 派出全部驻军
            const count = srcNode.garrisonCount;
            srcNode.garrisonCount = 0;
            ArmyManager.createArmy(OwnerType.PLAYER, count, path);
            // 设 10 帧冷却，防止同帧内重复派兵（等军队离开始发节点）
            this._autoDispatchCooldown.set(srcNodeId, 10);
        }
    }

    // ======================== 自动派遣可视化 ========================

    /**
     * 绘制自动派遣箭头线（金色半透明 + 中段箭头）
     * 
     * 作用：在 _mapLayer 上创建 Graphics 节点，画出从源到目标的连线
     *       并在中点处绘制 V 形箭头指示方向
     * 
     * @param srcNodeId 源节点ID
     * @param tgtNodeId 目标节点ID
     * @returns 无
     */
    private drawAutoDispatchLine(srcNodeId: number, tgtNodeId: number): void {
        if (!this._mapView.mapLayer) return;
        this.removeAutoDispatchLine(srcNodeId);

        const src = this._nodes[srcNodeId];
        const tgt = this._nodes[tgtNodeId];
        if (!src || !tgt) return;

        const lineNode = new Node(`AD_Line_${srcNodeId}`);
        const g = lineNode.addComponent(Graphics);
        // 绘制主线：金色半透明
        g.strokeColor = new Color(255, 200, 50, 200);
        g.lineWidth = 2;
        g.moveTo(src.position.x, src.position.y);
        g.lineTo(tgt.position.x, tgt.position.y);
        g.stroke();

        // 在中点绘制方向箭头（V 形）
        const midX = (src.position.x + tgt.position.x) / 2;
        const midY = (src.position.y + tgt.position.y) / 2;
        const angle = Math.atan2(tgt.position.y - src.position.y, tgt.position.x - src.position.x);
        const arrowLen = 10;
        g.strokeColor = new Color(255, 200, 50, 200);
        // 左侧箭头羽
        g.moveTo(midX, midY);
        g.lineTo(
            midX - arrowLen * Math.cos(angle - 0.5),
            midY - arrowLen * Math.sin(angle - 0.5)
        );
        g.stroke();
        // 右侧箭头羽
        g.moveTo(midX, midY);
        g.lineTo(
            midX - arrowLen * Math.cos(angle + 0.5),
            midY - arrowLen * Math.sin(angle + 0.5)
        );
        g.stroke();

        this._mapView.mapLayer!.addChild(lineNode);
        this._autoDispatchLines.set(srcNodeId, g);
    }

    /**
     * 移除指定源节点的自动派遣可视化线
     * 
     * 作用：销毁 Graphics 节点并从映射表中删除
     * 
     * @param srcNodeId 源节点ID
     * @returns 无
     */
    private removeAutoDispatchLine(srcNodeId: number): void {
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
     * @param x1 源节点地图 X 坐标
     * @param y1 源节点地图 Y 坐标
     * @param x2 手指当前位置地图 X 坐标（或目标节点 X）
     * @param y2 手指当前位置地图 Y 坐标（或目标节点 Y）
     * @returns 无
     */
    private drawSwipePreview(x1: number, y1: number, x2: number, y2: number): void {
        this.clearSwipePreview();
        if (!this._mapView.mapLayer) return;
        const lineNode = new Node('SwipePreview');
        const g = lineNode.addComponent(Graphics);
        g.strokeColor = new Color(100, 200, 255, 180);
        g.lineWidth = 2;
        g.moveTo(x1, y1);
        g.lineTo(x2, y2);
        g.stroke();
        this._mapView.mapLayer!.addChild(lineNode);
        // 确保预览线渲染在所有地图元素最上层
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
    private clearSwipePreview(): void {
        if (this._swipePreviewLine) {
            this._swipePreviewLine.node.destroy();
            this._swipePreviewLine = null;
        }
    }

    /**
     * 从源节点向目标节点派兵（一次性，非自动派遣）
     * 
     * 作用：BFS 寻路 → 扣除源节点驻军 → 创建军队沿路径行军
     * 
     * @param srcNodeId    源节点ID（出兵节点）
     * @param count        派出士兵数量
     * @param targetNodeId 目标节点ID（目的地）
     * @returns 无
     */
    private _dispatchTroops(srcNodeId: number, count: number, targetNodeId: number): void {
        const srcNode = this._nodes[srcNodeId];
        if (!srcNode || count <= 0 || count > srcNode.garrisonCount) return;

        const path = PathfindingManager.findPath(srcNodeId, targetNodeId);
        if (!path || path.length < 2) {
            console.log(`[GameManager] 派兵失败: 节点#${srcNodeId} → #${targetNodeId} 无路径`);
            return;
        }

        console.log(`[GameManager] 派兵: 节点#${srcNodeId} → #${targetNodeId}, 数量=${count}, 路径=${path.join('→')}`);
        srcNode.garrisonCount -= count;
        ArmyManager.createArmy(OwnerType.PLAYER, count, path);
        this._mapView.refreshNodeViews(this._nodes);
    }

    private _redirectArmy(armyId: number, targetNodeId: number): void {
        const army = this._armies.find(a => a.id === armyId);
        if (!army) return;

        const success = ArmyManager.setReroute(armyId, targetNodeId);
        if (success) {
            console.log(`[GameManager] 改道: 军队#${armyId}, 新目标#${targetNodeId}`);
        } else {
            console.log(`[GameManager] 改道失败: 军队#${armyId} → #${targetNodeId}`);
        }
    }
}
