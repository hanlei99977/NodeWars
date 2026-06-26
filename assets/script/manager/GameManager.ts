import { _decorator, Component, director, Node, Graphics, Color, Label, UITransform, EventTouch, Vec2 } from 'cc';
import { NodeEntity } from '../entity/NodeEntity';
import { EdgeEntity } from '../entity/EdgeEntity';
import { ArmyEntity } from '../entity/ArmyEntity';
import { GameState, MapSize, Difficulty, FogMode, GameSpeed, OwnerType, ArmyState, ArmyEventType, EconomyEventType, NodeBattleOutcome, AIAllianceState, NodeType } from '../config/EnumDefine';
import { GameConfig } from '../config/GameConfig';
import { MapGenerator, MapGenerateResult } from '../map/MapGenerator';
import { ArmyManager } from '../manager/ArmyManager';
import { NodeBattleSystem } from '../battle/NodeBattleSystem';
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
    private _edgeNodes: Map<number, Node> = new Map();
    private _armyViewNodes: Map<number, Node> = new Map();
    private _dragLastPos: Vec2 | null = null;
    private _isDragging = false;
    private _mapBounds = { minX: 0, maxX: 0, minY: 0, maxY: 0 };
    private _pendingSendTroops: { nodeId: number; count: number } | null = null;
    private _pendingArmyRedirect: { armyId: number } | null = null;

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
    }

    update(dt: number): void {
        if (this._gameState !== GameState.PLAYING) return;

        // 游戏速度倍率
        const logicDt = dt * this._gameSpeed;
        this._totalTime += logicDt;

        // --- 1. 行军推进 ---
        const armyEvents = ArmyManager.update(logicDt);
        this._armies = ArmyManager.armies;

        // 处理行军事件
        for (const event of armyEvents) {
            console.log(`[GameManager] 行军事件: type=${event.type}, armyId=${event.army.id}, nodeId=${event.nodeId}, otherArmyId=${event.otherArmy?.id}`);
            if (event.type === ArmyEventType.ARRIVED_AT_NODE && event.nodeId !== undefined) {
                this.handleArmyArrival(event.army, event.nodeId);
            } else if (event.type === ArmyEventType.EDGE_ENCOUNTER && event.otherArmy) {
                this.handleEdgeEncounter(event.army, event.otherArmy);
            }
        }

        // --- 2. 经济更新 ---
        const econEvents = EconomySystem.update(logicDt, this._nodes, this._armies);
        for (const event of econEvents) {
            if (event.type === EconomyEventType.DISBAND_SOLDIERS) {
                // 裁军已完成（EconomySystem 内直接修改了节点数据）
                // 此处仅需刷新视图
            }
        }

        // --- 3. 任务推进（征兵 / 节点升级 / 节点转换） ---
        const recruitEvents = RecruitSystem.update(logicDt, this._nodes);
        const upgradeEvents = NodeUpgradeSystem.update(logicDt, this._nodes);
        const convertEvents = NodeConvertSystem.update(logicDt, this._nodes);

        // 征兵完成 → 记录迷雾情报（己方节点兵力变化，FogSystem.update 会刷新）
        // 升级/转换完成 → FogSystem.refreshVisibility 会自动拉取最新数据

        // --- 4. 迷雾更新 ---
        FogSystem.update(logicDt, this._nodes);

        // --- 5. 随机事件 ---
        EventSystem.updateNodes(this._nodes);
        EventSystem.update(logicDt, EconomySystem.allOwnerIds);

        // --- 6. AI 决策（internally calls ArmyManager.createArmy / RecruitSystem / NodeUpgradeSystem 等） ---
        void AIController.update(logicDt, this._nodes, this._edges, this._armies);
        this._armies = ArmyManager.armies; // AI 可能派兵，刷新

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
    }

    // 军队到达节点：NodeBattleSystem 结算攻占 / 合并
    private handleArmyArrival(army: ArmyEntity, nodeId: number): void {
        const node = this._nodes[nodeId];
        if (!node) return;

        const isFinalDest = nodeId === army.destinationNodeId;

        if (isFinalDest) {
            // 最终目标节点：无论友方还是敌方都结算
            console.log(`[GameManager] 军队#${army.id} 到达最终目标节点#${nodeId} (owner=${node.ownerId}, garrison=${node.garrisonCount})`);
            const result = NodeBattleSystem.resolve(army, node);
            if (result.outcome === NodeBattleOutcome.ATTACKER_WINS || result.outcome === NodeBattleOutcome.DEFENDER_WINS) {
                FogSystem.recordAttack(node, army.ownerId);
            }
            return;
        }

        // 中间节点：己方越过，敌方攻占
        if (army.ownerId === node.ownerId) {
            console.log(`[GameManager] 军队#${army.id} 越过己方中间节点#${nodeId}`);
            ArmyManager.advanceArmy(army.id);
            return;
        }

        console.log(`[GameManager] 军队#${army.id} 遭遇敌方中间节点#${nodeId} (owner=${node.ownerId}, garrison=${node.garrisonCount})`);
        const result = NodeBattleSystem.resolve(army, node);
        if (result.outcome === NodeBattleOutcome.ATTACKER_WINS || result.outcome === NodeBattleOutcome.DEFENDER_WINS) {
            FogSystem.recordAttack(node, army.ownerId);
        }
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
        if (this.hud) {
            this.hud.onPauseToggle = () => this.togglePause();
            this.hud.onSpeedChange = (s) => {
                this.setGameSpeed(s);
                if (this.hud) this.hud.bindSpeed(s);
            };
        }

        if (this.saveSlotsUI) {
            this.saveSlotsUI.onLoadSlot = (slotId) => this.loadGame(slotId);
            this.saveSlotsUI.onClose = () => {
                if (this.saveSlotsUI) this.saveSlotsUI.node.active = false;
            };
        }

        if (this.gameOverUI) {
            this.gameOverUI.onRestart = () => director.loadScene('LobbyScene');
            this.gameOverUI.onBackToLobby = () => director.loadScene('LobbyScene');
        }
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
        const margin = 100;
        const p = ml.position;
        const nx = Math.max(this._mapBounds.minX - margin, Math.min(this._mapBounds.maxX + margin, p.x));
        const ny = Math.max(this._mapBounds.minY - margin, Math.min(this._mapBounds.maxY + margin, p.y));
        ml.setPosition(nx, ny, p.z);
    }

    // 清除旧地图
    private clearMap(): void {
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
        this._isDragging = false;
        this._dragLastPos = null;
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

        // 点击事件 → 打开 NodePanel
        wrapper.on(Node.EventType.TOUCH_START, (e: EventTouch) => {
            e.propagationStopped = true;
            this.onNodeClicked(n.id, e);
        });

        this._mapLayer!.addChild(wrapper);
    }

    // 点击某个节点 → 弹出 NodePanel 并绑定数据, 或处理待派兵/改道
    private onNodeClicked(nodeId: number, _e: EventTouch): void {
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

        this.nodePanel.bindToEntity(node, OwnerType.PLAYER);
        this.nodePanel.node.active = true;

        const refreshAfter = () => {
            this.refreshMapViews();
            if (this.nodePanel) this.nodePanel.refreshPanel();
        };

        // 绑定回调
        this.nodePanel.onUpgrade = (id) => {
            console.log(`[GameManager] 节点升级: #${id}`);
            NodeUpgradeSystem.startUpgrade(this._nodes[id], OwnerType.PLAYER);
            refreshAfter();
        };
        this.nodePanel.onConvertToFortress = (id) => {
            console.log(`[GameManager] 节点转要塞: #${id}`);
            NodeConvertSystem.startConvert(this._nodes[id], NodeType.FORTRESS, OwnerType.PLAYER);
            refreshAfter();
        };
        this.nodePanel.onConvertToMarket = (id) => {
            console.log(`[GameManager] 节点转市场: #${id}`);
            NodeConvertSystem.startConvert(this._nodes[id], NodeType.MARKET, OwnerType.PLAYER);
            refreshAfter();
        };
        this.nodePanel.onRecruit = (id) => {
            console.log(`[GameManager] 节点征兵: #${id}`);
            RecruitSystem.startRecruit(this._nodes[id], OwnerType.PLAYER);
            refreshAfter();
        };

        this.nodePanel.onSendTroops = (id, count) => {
            const srcNode = this._nodes[id];
            if (count <= 0 || count > srcNode.garrisonCount) return;

            console.log(`[GameManager] 待派兵: 节点#${id}, 数量=${count} — 点击目标节点`);
            this._pendingSendTroops = { nodeId: id, count };
            if (this.nodePanel) this.nodePanel.node.active = false;
        };

        this.nodePanel.onClose = () => { if (this.nodePanel) this.nodePanel.node.active = false; };
        this.nodePanel.onBatchUpgradeAll = () => {
            console.log(`[GameManager] 批量升级全部`);
            NodeUpgradeSystem.batchUpgrade(this._nodes, 'all', OwnerType.PLAYER, ArmyManager.adjList);
            refreshAfter();
        };
        this.nodePanel.onBatchUpgradeFortress = () => {
            console.log(`[GameManager] 批量升级要塞`);
            NodeUpgradeSystem.batchUpgrade(this._nodes, 'fortress', OwnerType.PLAYER, ArmyManager.adjList);
            refreshAfter();
        };
        this.nodePanel.onBatchUpgradeMarket = () => {
            console.log(`[GameManager] 批量升级市场`);
            NodeUpgradeSystem.batchUpgrade(this._nodes, 'market', OwnerType.PLAYER, ArmyManager.adjList);
            refreshAfter();
        };

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

            if (visible) {
                const color = this.getOwnerColor(n.ownerId);
                g.fillColor = color;
                lbl.string = FogSystem.isNodeCurrentlyVisible(n.id, OwnerType.PLAYER)
                    ? `${n.garrisonCount}` : `?`;
            } else {
                g.fillColor = new Color(60, 60, 60);
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

        this.edgePanel.bindToEntity(edge);
        this.edgePanel.node.active = true;

        this.edgePanel.onUpgrade = () => {
            console.log(`[GameManager] 线路升级: #${edge.id}`);
            EdgeUpgradeSystem.upgradeEdge(edge, this._nodes, OwnerType.PLAYER);
            this.edgePanel!.refresh();
            this.refreshMapViews();
        };

        this.edgePanel.onClose = () => {
            if (this.edgePanel) this.edgePanel.node.active = false;
        };
    }

    // 点击军队 → ArmyPanel 或进入改道模式
    private onArmyClicked(armyId: number): void {
        if (!this.armyPanel) return;
        const army = this._armies.find(a => a.id === armyId);
        if (!army) return;

        if (army.ownerId === OwnerType.PLAYER && army.state === ArmyState.MOVING) {
            console.log(`[GameManager] 待改道: 军队#${armyId} — 点击目标节点`);
            this._pendingArmyRedirect = { armyId };
            //return;
        }

        this.armyPanel.bindToEntity(army);
        this.armyPanel.node.active = true;

        this.armyPanel.onClose = () => {
            if (this.armyPanel) this.armyPanel.node.active = false;
        };
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
