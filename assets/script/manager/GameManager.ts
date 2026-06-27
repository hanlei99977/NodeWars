import { _decorator, Component, director, Node, Graphics, Color, Label, UITransform, EventTouch, Vec2, Vec3 } from 'cc';
import { NodeEntity } from '../entity/NodeEntity';
import { EdgeEntity } from '../entity/EdgeEntity';
import { ArmyEntity } from '../entity/ArmyEntity';
import { GameState, MapSize, Difficulty, FogMode, GameSpeed, OwnerType, ArmyState, NodeBattleOutcome, AIAllianceState, NodeType } from '../config/EnumDefine';
import { GameConfig } from '../config/GameConfig';
import { MapGenerator, MapGenerateResult } from '../map/MapGenerator';
import { ArmyManager } from '../manager/ArmyManager';
import { NodeBattleSystem, NodeBattleResult } from '../battle/NodeBattleSystem';
import { ArmyCollisionSystem } from '../battle/ArmyCollisionSystem';
import { EconomySystem } from '../economy/EconomySystem';
import { RecruitSystem } from '../recruit/RecruitSystem';
import { NodeUpgradeSystem } from '../manager/NodeUpgradeSystem';
import { NodeConvertSystem } from '../manager/NodeConvertSystem';
import { EdgeUpgradeSystem } from '../manager/EdgeUpgradeSystem';
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
import { EventBus } from '../common/EventBus';
import { GameEvents } from '../common/GameEvents';

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

    // --- Map Layer ---
    private _mapLayer: Node | null = null;
    private _dragSurface: Node | null = null;
    private _nodeGraphics: (Graphics | null)[] = [];
    private _nodeOwnerLabels: (Label | null)[] = [];
    private _nodeWrapperNodes: (Node | null)[] = [];
    private _edgeNodes: Map<number, Node> = new Map();
    private _armyViewNodes: Map<number, Node> = new Map();
    private _dragLastPos: Vec2 | null = null;
    private _isDragging = false;
    private _mapBounds = { minX: 0, maxX: 0, minY: 0, maxY: 0 };
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

    private static readonly NODE_RADIUS = 18;// 节点半径
    private static readonly OWNER_COLORS: Record<string, Color> = {
        [OwnerType.NEUTRAL]:  new Color(160, 160, 160),
        [OwnerType.PLAYER]:   new Color(64, 140, 255),
    };
    private static readonly EDGE_COLORS: Record<number, Color> = {
        1: new Color(120, 120, 120),
        2: new Color(80, 180, 80),
        3: new Color(255, 180, 40),
    };
    private static readonly EDGE_WIDTHS: Record<number, number> = { 1: 2, 2: 4, 3: 6 };
    private static readonly AI_COLORS: Color[] = [
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
        this.clearMap();
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
        this.renderMap();
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
        this.renderMap();
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
        this.refreshMapViews();

        // --- 10. 刷新军队视图 ---
        this.refreshArmyViews();

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

    // 连接 HUD / SaveSlotsUI / GameOverUI 的回调
    private wireUI(): void {
        EventBus.removeAll();

        EventBus.on(GameEvents.NODE_UPGRADE, (nodeId: number) => {
            NodeUpgradeSystem.startUpgrade(this._nodes[nodeId], OwnerType.PLAYER);
            this.refreshMapViews();
            if (this.nodePanel) this.nodePanel.refreshPanel();
        });
        EventBus.on(GameEvents.NODE_CONVERT_FORTRESS, (nodeId: number) => {
            NodeConvertSystem.startConvert(this._nodes[nodeId], NodeType.FORTRESS, OwnerType.PLAYER);
            this.refreshMapViews();
            if (this.nodePanel) this.nodePanel.refreshPanel();
        });
        EventBus.on(GameEvents.NODE_CONVERT_MARKET, (nodeId: number) => {
            NodeConvertSystem.startConvert(this._nodes[nodeId], NodeType.MARKET, OwnerType.PLAYER);
            this.refreshMapViews();
            if (this.nodePanel) this.nodePanel.refreshPanel();
        });
        EventBus.on(GameEvents.NODE_RECRUIT, (nodeId: number, count: number) => {
            RecruitSystem.startRecruit(this._nodes[nodeId], OwnerType.PLAYER, count);
            this.refreshMapViews();
            if (this.nodePanel) this.nodePanel.refreshPanel();
        });
        EventBus.on(GameEvents.NODE_SEND_TROOPS, (nodeId: number, count: number) => {
            const srcNode = this._nodes[nodeId];
            if (count <= 0 || count > srcNode.garrisonCount) return;
            this._pendingSendTroops = { nodeId, count };
            if (this.nodePanel) this.nodePanel.node.active = false;
        });
        EventBus.on(GameEvents.NODE_BATCH_UPGRADE_ALL, () => {
            NodeUpgradeSystem.batchUpgrade(this._nodes, 'all', OwnerType.PLAYER, ArmyManager.adjList);
            this.refreshMapViews();
            if (this.nodePanel) this.nodePanel.refreshPanel();
        });
        EventBus.on(GameEvents.NODE_BATCH_UPGRADE_FORTRESS, () => {
            NodeUpgradeSystem.batchUpgrade(this._nodes, 'fortress', OwnerType.PLAYER, ArmyManager.adjList);
            this.refreshMapViews();
            if (this.nodePanel) this.nodePanel.refreshPanel();
        });
        EventBus.on(GameEvents.NODE_BATCH_UPGRADE_MARKET, () => {
            NodeUpgradeSystem.batchUpgrade(this._nodes, 'market', OwnerType.PLAYER, ArmyManager.adjList);
            this.refreshMapViews();
            if (this.nodePanel) this.nodePanel.refreshPanel();
        });
        EventBus.on(GameEvents.PANEL_CLOSE_NODE, () => {
            if (this.nodePanel) this.nodePanel.node.active = false;
        });

        EventBus.on(GameEvents.EDGE_UPGRADE, (edgeId: number) => {
            const edge = this._edges.find(e => e.id === edgeId);
            if (!edge) return;
            EdgeUpgradeSystem.upgradeEdge(edge, this._nodes, OwnerType.PLAYER);
            if (this.edgePanel) this.edgePanel.refresh();
            this.refreshMapViews();
        });
        EventBus.on(GameEvents.PANEL_CLOSE_EDGE, () => {
            if (this.edgePanel) this.edgePanel.node.active = false;
        });

        EventBus.on(GameEvents.PANEL_CLOSE_ARMY, () => {
            if (this.armyPanel) this.armyPanel.node.active = false;
        });

        EventBus.on(GameEvents.GAME_RESTART, () => director.loadScene('LobbyScene'));
        EventBus.on(GameEvents.GAME_LOBBY,   () => director.loadScene('LobbyScene'));

        EventBus.on(GameEvents.SAVE_LOAD_SLOT, (slotId: number) => this.loadGame(slotId));
        EventBus.on(GameEvents.SAVE_SLOTS_CLOSE, () => {
            if (this.saveSlotsUI) this.saveSlotsUI.node.active = false;
        });

        EventBus.on(GameEvents.GAME_PAUSE_TOGGLE, () => this.togglePause());
        EventBus.on(GameEvents.GAME_SPEED_CHANGED, (s: GameSpeed) => {
            this.setGameSpeed(s);
            if (this.hud) this.hud.bindSpeed(s);
        });

        EventBus.on(GameEvents.ARMY_ARRIVED_AT_NODE, (army: ArmyEntity, nodeId: number) => {
            this.handleArmyArrival(army, nodeId);
            this._armies = ArmyManager.armies;
        });
        EventBus.on(GameEvents.ARMY_EDGE_ENCOUNTER, (armyA: ArmyEntity, armyB: ArmyEntity) => {
            this.handleEdgeEncounter(armyA, armyB);
            this._armies = ArmyManager.armies;
        });

        EventBus.on(GameEvents.BATTLE_NODE_RESULT, (result: NodeBattleResult) => {
            if (result.outcome === NodeBattleOutcome.ATTACKER_WINS || result.outcome === NodeBattleOutcome.DEFENDER_WINS) {
                FogSystem.recordAttack(result.node, result.attackerArmy.ownerId);
            }
        });

        EventBus.on(GameEvents.RANDOM_HARVEST, (totalGold: number) => {
            console.log(`[GameManager] 丰收! 金币 +${totalGold}`);
        });
        EventBus.on(GameEvents.RANDOM_WAR_MOBILIZATION, (duration: number) => {
            console.log(`[GameManager] 战争动员! 所有方征兵时间减半 ${duration.toFixed(1)}s`);
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

    // ==================== 地图视图 ====================

    // 生成整张地图的视觉表示；MapLayer 负责承载地图内容，拖拽与缩放只影响它
    private renderMap(): void {
        this.clearMap();

        // 计算节点包围盒
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (const n of this._nodes) {
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
        this.node.addChild(this._dragSurface);
        this._dragSurface.setSiblingIndex(0);

        this._dragSurface.on(Node.EventType.TOUCH_START, (e: EventTouch) => {
            if (this._pendingSendTroops || this._pendingArmyRedirect) {
                this._cancelPendingModes();
                return;
            }
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
        this.node.addChild(this._mapLayer);

        for (const edge of this._edges) {
            this.createEdgeGraphic(edge);
        }

        this._nodeGraphics = new Array(this._nodes.length).fill(null);
        this._nodeOwnerLabels = new Array(this._nodes.length).fill(null);
        this._nodeWrapperNodes = new Array(this._nodes.length).fill(null);

        for (const n of this._nodes) {
            this.createNodeGraphic(n);
        }
    }

    // MapLayer 边界限制
    private _clampMapLayer(): void {
        if (!this._mapLayer) return;
        const ml = this._mapLayer;
        const s = ml.scale.x;
        // 留少许 margin 让地图不全贴边
        const margin = 400;
        const p = ml.position;
        const nx = Math.max(this._mapBounds.minX - margin, Math.min(this._mapBounds.maxX + margin, p.x));
        const ny = Math.max(this._mapBounds.minY - margin, Math.min(this._mapBounds.maxY + margin, p.y));
        ml.setPosition(nx, ny, p.z);
    }

    // 清除旧地图
    private clearMap(): void {
        console.log(`开始清除旧地图数据...`);
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
        this._nodeOwnerLabels = [];
        this._nodeWrapperNodes = [];
        this._isDragging = false;
        this._dragLastPos = null;
        this.clearSwipePreview();
        this._autoDispatchMap.clear();
        this._autoDispatchCooldown.clear();
        this._autoDispatchLines.clear();
        console.log(`清除成功`);
    }

    // 创建一条线段的视觉节点（可点击弹出 EdgePanel）
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
        g.strokeColor = GameManager.EDGE_COLORS[edge.level] || GameManager.EDGE_COLORS[1];
        g.lineWidth = GameManager.EDGE_WIDTHS[edge.level] || 2;
        g.moveTo(-len / 2, 0);
        g.lineTo(len / 2, 0);
        g.stroke();
        wrapper.addChild(gNode);

        // 点击 → EdgePanel
        wrapper.on(Node.EventType.TOUCH_START, (e: EventTouch) => {
            e.propagationStopped = true;
            this.onEdgeClicked(edge.id);
        });

        this._edgeNodes.set(edge.id, wrapper);
        this._mapLayer!.addChild(wrapper);
    }

    // 为一个节点创建圆形图形 + 信息标签 + 点击事件
    private createNodeGraphic(n: NodeEntity): void {
        const wrapper = new Node(`Node_${n.id}`);
        wrapper.setPosition(n.position.x, n.position.y, 0);
        const ui = wrapper.addComponent(UITransform);
        ui.setContentSize(GameManager.NODE_RADIUS * 2 + 12, GameManager.NODE_RADIUS * 2 + 12);

        // 圆形 Graphics
        const circle = new Node('Circle');
        const cg = circle.addComponent(Graphics);
        const color = this.getOwnerColor(n.ownerId);
        cg.fillColor = color;
        cg.strokeColor = new Color(40, 40, 40);
        cg.lineWidth = 1.5;
        cg.circle(0, 0, GameManager.NODE_RADIUS);
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
        lvlLabel.setPosition(0, GameManager.NODE_RADIUS + 12, 0);
        wrapper.addChild(lvlLabel);

        // 驻军/所有者标签（正下方）
        const infoLabel = new Node('InfoLabel');
        const infoL = infoLabel.addComponent(Label);
        infoL.string = `${n.garrisonCount}`;
        infoL.fontSize = 13;
        infoL.color = new Color(220, 220, 220);
        infoLabel.getComponent(UITransform)!.setContentSize(80, 22);
        infoLabel.setPosition(0, -GameManager.NODE_RADIUS - 14, 0);
        wrapper.addChild(infoLabel);
        this._nodeOwnerLabels[n.id] = infoL;

        // ======================== 节点触摸交互 ========================
        // 短按（无滑动）→ 打开 NodePanel / 处理待派兵改道
        // 滑动（从己方节点拖出）→ 建立/取消/替换自动派遣
        // 滑动回到自身 → 无操作
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
            // 如果移动距离过小，则不触发滑动
            if (Math.abs(dx) < SWIPE_THRESHOLD && Math.abs(dy) < SWIPE_THRESHOLD) return;

            if (!hasMoved) {
                hasMoved = true;
                console.log(`检测到滑动操作`);
                console.log(`(${cur.x},${cur.y})`)
                if (n.ownerId === OwnerType.PLAYER) {
                    this.onSwipeStart(n.id, touchStartPos);
                }
            }
            if (this._swipeActive) {
                this.onSwipeMove(e);
            }
        });

        wrapper.on(Node.EventType.TOUCH_CANCEL, (e: EventTouch) => {
            console.log(`滑动操作结束`)
            if (hasMoved && this._swipeActive) {
                    this.onSwipeEnd(e);
            } 
        });

        wrapper.on(Node.EventType.TOUCH_END, (e: EventTouch) => {
            if (!hasMoved) {
                this.onNodeClicked(n.id);
            }
        });


        this._mapLayer!.addChild(wrapper);
        this._nodeWrapperNodes[n.id] = wrapper;
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

        this.refreshMapViews();
    }

    // 每帧刷新节点颜色 / 标签 (针对迷雾 & 状态变更)
    private refreshMapViews(): void {
        for (let i = 0; i < this._nodes.length; i++) {
            const n = this._nodes[i];
            const g = this._nodeGraphics[i];
            const lbl = this._nodeOwnerLabels[i];
            if (!g || !lbl) continue;

            const visible = FogSystem.isNodeExplored(n.id, OwnerType.PLAYER);

            g.clear();

            if (visible) {
                const color = this.getOwnerColor(n.ownerId);
                g.fillColor = color;
                g.strokeColor = new Color(40, 40, 40);
                g.lineWidth = 1.5;
                g.circle(0, 0, GameManager.NODE_RADIUS);
                g.fill();
                g.stroke();

                lbl.string = FogSystem.isNodeCurrentlyVisible(n.id, OwnerType.PLAYER)
                    ? `${n.garrisonCount}` : `?`;
            } else {
                g.fillColor = new Color(60, 60, 60);
                g.strokeColor = new Color(40, 40, 40);
                g.lineWidth = 1.5;
                g.circle(0, 0, GameManager.NODE_RADIUS);
                g.fill();
                g.stroke();

                lbl.string = '';
            }
        }
    }

    // 每帧刷新军队视图：新生军队创建视图，消亡军队销毁视图
    private refreshArmyViews(): void {
        // 移除不存在的军队视图
        const aliveIds = new Set(this._armies.map(a => a.id));
        for (const [id, vn] of this._armyViewNodes.entries()) {
            if (!aliveIds.has(id)) {
                vn.destroy();
                this._armyViewNodes.delete(id);
            }
        }

        // 为新生军队创建视图并每帧更新位置
        for (const a of this._armies) {
            let vn = this._armyViewNodes.get(a.id);
            if (!vn) {
                vn = this.createArmyGraphic(a);
                this._armyViewNodes.set(a.id, vn);
            }
            this.updateArmyPosition(vn, a);
        }
    }

    // 创建一支军队视图节点（可点击弹出 ArmyPanel）
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
            this.onArmyClicked(army.id);
        });

        this._mapLayer!.addChild(vn);
        return vn;
    }

    // 计算军队在边上的位置
    private updateArmyPosition(vn: Node, army: ArmyEntity): void {
        if (army.currentEdgeIndex >= army.pathNodeIds.length - 1) return;
        const nodeA = this._nodes[army.pathNodeIds[army.currentEdgeIndex]];
        const nodeB = this._nodes[army.pathNodeIds[army.currentEdgeIndex + 1]];
        if (!nodeA || !nodeB) return;
        const t = army.progress;
        vn.setPosition(
            nodeA.position.x + (nodeB.position.x - nodeA.position.x) * t,
            nodeA.position.y + (nodeB.position.y - nodeA.position.y) * t,
            0,
        );
    }

    // 获取 ownerId 对应的显示颜色
    private getOwnerColor(ownerId: string): Color {
        if (ownerId === OwnerType.NEUTRAL)  return GameManager.OWNER_COLORS[OwnerType.NEUTRAL];
        if (ownerId === OwnerType.PLAYER)   return GameManager.OWNER_COLORS[OwnerType.PLAYER];
        if (GameManager.OWNER_COLORS[ownerId]) return GameManager.OWNER_COLORS[ownerId];
        // AI: 用 aiId 对应的索引取颜色
        const aiIdx = this._aiIds.indexOf(ownerId);
        if (aiIdx >= 0 && aiIdx < GameManager.AI_COLORS.length) {
            return GameManager.AI_COLORS[aiIdx];
        }
        return new Color(200, 60, 60);
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
        if (!this._mapLayer) return;
        const curPos = e.getUILocation();
        // UI坐标本质就是世界坐标，转Vec3后反向变换得到本地坐标
        const localPos = new Vec3();
        this._mapLayer.inverseTransformPoint(localPos,new Vec3(curPos.x, curPos.y, 0));
        const mapX = localPos.x;
        const mapY = localPos.y;

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
        if (!this._mapLayer) { this.endSwipe(); return; }
        const curPos = e.getUILocation();
        // UI坐标本质就是世界坐标，转Vec3后反向变换得到本地坐标
        const localPos = new Vec3();
        this._mapLayer.inverseTransformPoint(localPos,new Vec3(curPos.x, curPos.y, 0));
        const mapX = localPos.x;
        const mapY = localPos.y;

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
        const HIT_RADIUS = GameManager.NODE_RADIUS + 20;
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

            const path = ArmyManager.findPath(srcNodeId, tgtNodeId);
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
        if (!this._mapLayer) return;
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

        this._mapLayer.addChild(lineNode);
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
        if (!this._mapLayer) return;
        const lineNode = new Node('SwipePreview');
        const g = lineNode.addComponent(Graphics);
        g.strokeColor = new Color(100, 200, 255, 180);
        g.lineWidth = 2;
        g.moveTo(x1, y1);
        g.lineTo(x2, y2);
        g.stroke();
        this._mapLayer.addChild(lineNode);
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

        const path = ArmyManager.findPath(srcNodeId, targetNodeId);
        if (!path || path.length < 2) {
            console.log(`[GameManager] 派兵失败: 节点#${srcNodeId} → #${targetNodeId} 无路径`);
            return;
        }

        console.log(`[GameManager] 派兵: 节点#${srcNodeId} → #${targetNodeId}, 数量=${count}, 路径=${path.join('→')}`);
        srcNode.garrisonCount -= count;
        ArmyManager.createArmy(OwnerType.PLAYER, count, path);
        this.refreshMapViews();
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
