import { _decorator, Component } from 'cc';
import { NodeEntity } from '../entity/NodeEntity';
import { EdgeEntity } from '../entity/EdgeEntity';
import { ArmyEntity } from '../entity/ArmyEntity';
import { GameState, MapSize, Difficulty, FogMode, GameSpeed, OwnerType, AIAllianceState } from '../config/EnumDefine';
import { GameConfig } from '../config/GameConfig';
import { MapGenerator } from '../map/MapGenerator';
import { ArmyManager } from '../manager/ArmyManager';
import { MapViewManager } from '../manager/MapViewManager';
import { GameEventBinder } from '../manager/GameEventBinder';
import { PlayerCommandManager } from '../manager/PlayerCommandManager';
import { GameStateManager } from '../manager/GameStateManager';
import { GameLoopController } from '../manager/GameLoopController';
import { NodeBattleSystem } from '../battle/NodeBattleSystem';
import { ArmyCollisionSystem } from '../battle/ArmyCollisionSystem';
import { EconomySystem } from '../economy/EconomySystem';
import { FogSystem } from '../fog/FogSystem';
import { EventSystem } from '../event/EventSystem';
import { SaveSystem } from '../save/SaveSystem';
import { AIController } from '../ai/AIController';
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

    // --- 子管理器 ---
    private _stateMgr = new GameStateManager();
    private _mapView!: MapViewManager;
    private _playerCmd = new PlayerCommandManager();

    // --- 实体缓存 ---
    private _nodes: NodeEntity[] = [];
    private _edges: EdgeEntity[] = [];
    private _armies: ArmyEntity[] = [];
    private _aiIds: string[] = [];

    // --- 外部回调 ---
    onStateChanged: ((state: GameState) => void) | null = null;

    // 场景加载后自动启动或打开存档面板
    onLoad(): void {
        this._mapView = new MapViewManager(this.node);

        // 绑定 GameStateManager 回调
        this._stateMgr.gameOverUI = this.gameOverUI;
        this._stateMgr.onStateChanged = (s) => { if (this.onStateChanged) this.onStateChanged(s); };
        this._stateMgr.onGameEnd = (state) => this._showGameOver(state);

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

    startGame(mapSize: MapSize, aiCount: number, difficulty: Difficulty, fogMode: FogMode, gameSpeed: GameSpeed): void {
        this._stateMgr.initForNewGame(mapSize, aiCount, difficulty, fogMode, gameSpeed);
        this.doStart();
    }

    loadGame(slotId: number): void {
        const data = SaveSystem.load(slotId);
        if (!data) return;

        this._stateMgr.initForLoadedGame(data);
        this._aiIds = data.aiNodeIds.map((_, i) => `ai_${i}`);

        const restored = SaveSystem.restore(data);
        this._nodes = restored.nodes;
        this._edges = restored.edges;
        this._armies = restored.armies;

        this.initSystems(false);
        this._mapView.renderMap(this._nodes, this._edges, this._aiIds);
        this.wireCallbacks();
        this.wireUI();
        this._stateMgr.changeState(GameState.PLAYING);
    }

    private doStart(): void {
        // 1. 生成地图
        const mapResult = MapGenerator.generate(this._stateMgr.mapSize, this._stateMgr.aiCount);
        this._nodes = mapResult.nodes;
        this._edges = mapResult.edges;
        this._stateMgr.playerNodeId = mapResult.playerNodeId;
        this._stateMgr.nextArmyId = 1;
        this._stateMgr.mapResult = { aiNodeIds: mapResult.aiNodeIds };

        // 2. 为 AI 分配唯一 ID
        this._aiIds = [];
        for (let i = 0; i < this._stateMgr.aiCount; i++) {
            const aiId = `ai_${i}`;
            this._aiIds.push(aiId);
            const birthNodeId = mapResult.aiNodeIds[i];
            const node = this._nodes[birthNodeId];
            if (node) {
                (node.ownerId as string) = aiId;
            }
        }

        // 3. 初始化各子系统
        this.initSystems(true);
        this._mapView.renderMap(this._nodes, this._edges, this._aiIds);
        this.wireCallbacks();
        this.wireUI();
        this._stateMgr.changeState(GameState.PLAYING);
    }

    private initSystems(isNewGame: boolean): void {
        if (isNewGame) {
            const aiGold: Record<string, number> = {};
            for (const aiId of this._aiIds) {
                aiGold[aiId] = GameConfig.INITIAL_GOLD;
            }
            EconomySystem.init(GameConfig.INITIAL_GOLD, aiGold);
        }

        ArmyManager.init(this._edges, this._nodes);
        FogSystem.init(this._stateMgr.fogMode, this._nodes, this._edges);

        if (this._aiIds.length > 0) {
            AIController.init(this._aiIds, this._stateMgr.difficulty, this._nodes, this._edges);
        }

        EventSystem.init();
        EventSystem.updateNodes(this._nodes);

        this._playerCmd.init(this._nodes, this._edges, this._armies,
            this._mapView, this.nodePanel, this.edgePanel, this.armyPanel);
    }

    update(dt: number): void {
        if (this._stateMgr.gameState !== GameState.PLAYING) return;

        GameLoopController.update(
            dt,
            this._nodes,
            this._edges,
            this._armies,
            this._aiIds,
            this._stateMgr,
            this._mapView,
            this._playerCmd,
            this.hud,
        );

        // 军队可能被行军 / AI / 遭遇战修改 -> 同步
        this._armies = ArmyManager.armies;
        this._playerCmd.armies = this._armies;
    }

    private _showGameOver(state: GameState): void {
        if (!this.gameOverUI) return;
        const nodeCount = this._nodes.filter(n => n.ownerId === OwnerType.PLAYER).length;
        const reward = GameConfig.DIFFICULTY_GOLD_REWARD[this._stateMgr.difficulty];
        this.gameOverUI.show(state, this._stateMgr.totalTime, nodeCount, reward);
    }

    private handleArmyArrival(army: ArmyEntity, nodeId: number): void {
        const node = this._nodes[nodeId];
        if (!node) return;

        const isFinalDest = nodeId === army.destinationNodeId;

        if (isFinalDest) {
            NodeBattleSystem.resolve(army, node);
            return;
        }

        if (army.ownerId === node.ownerId) {
            console.log(`[GameManager] 军队#${army.id} 越过己方中间节点#${nodeId}`);
            ArmyManager.advanceArmy(army.id);
            return;
        }

        NodeBattleSystem.resolve(army, node);
    }

    private handleEdgeEncounter(armyA: ArmyEntity, armyB: ArmyEntity): void {
        const result = ArmyCollisionSystem.resolve(armyA, armyB);
        if (result) {
            ArmyManager.removeArmy(result.loser.id);
            this._armies = ArmyManager.armies;
        }
    }

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
            togglePause: () => this._stateMgr.togglePause(),
            setGameSpeed: (s) => this._stateMgr.setGameSpeed(s),
            handleArmyArrival: (army, nodeId) => this.handleArmyArrival(army, nodeId),
            handleEdgeEncounter: (armyA, armyB) => this.handleEdgeEncounter(armyA, armyB),
            syncArmies: () => { this._armies = ArmyManager.armies; this._playerCmd.armies = this._armies; },
            setPendingSendTroops: (v) => { this._playerCmd.setPendingSendTroops(v); },
        });
    }

    // --- 外部只读查询 ---

    get nodes(): NodeEntity[] { return this._nodes; }
    get edges(): EdgeEntity[] { return this._edges; }
    get armies(): ArmyEntity[] { return this._armies; }
    get aiIds(): string[] { return this._aiIds; }
    get totalTime(): number { return this._stateMgr.totalTime; }
    get gameState(): GameState { return this._stateMgr.gameState; }
    get gameSpeed(): GameSpeed { return this._stateMgr.gameSpeed; }
    get mapSize(): MapSize { return this._stateMgr.mapSize; }
    get difficulty(): Difficulty { return this._stateMgr.difficulty; }
    get fogMode(): FogMode { return this._stateMgr.fogMode; }
    get allianceState(): AIAllianceState { return this._stateMgr.allianceState; }

    togglePause(): void { this._stateMgr.togglePause(); }
    setGameSpeed(speed: GameSpeed): void { this._stateMgr.setGameSpeed(speed); }

    private wireCallbacks(): void {
        this._mapView.onNodeClicked = (nodeId) => this._playerCmd.onNodeClicked(nodeId);
        this._mapView.onEdgeClicked = (edgeId) => this._playerCmd.onEdgeClicked(edgeId);
        this._mapView.onArmyClicked = (armyId) => this._playerCmd.onArmyClicked(armyId);
        this._mapView.onSwipeStart = (nodeId, pos) => this._playerCmd.onSwipeStart(nodeId, pos);
        this._mapView.onSwipeMove = (e) => this._playerCmd.onSwipeMove(e);
        this._mapView.onSwipeEnd = (e) => this._playerCmd.onSwipeEnd(e);
        this._mapView.onBlankAreaTap = () => this._playerCmd.cancelPendingModes();
    }
}