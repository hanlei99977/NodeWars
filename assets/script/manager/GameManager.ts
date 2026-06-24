import { _decorator, Component } from 'cc';
import { NodeEntity } from '../entity/NodeEntity';
import { EdgeEntity } from '../entity/EdgeEntity';
import { ArmyEntity } from '../entity/ArmyEntity';
import { GameState, MapSize, Difficulty, FogMode, GameSpeed, OwnerType } from '../config/EnumDefine';
import { GameConfig } from '../config/GameConfig';
import { MapGenerator, MapGenerateResult } from '../map/MapGenerator';
import { ArmyManager, ArmyEventType } from '../manager/ArmyManager';
import { NodeBattleSystem } from '../battle/NodeBattleSystem';
import { ArmyCollisionSystem } from '../battle/ArmyCollisionSystem';
import { EconomySystem, EconomyEventType } from '../economy/EconomySystem';
import { RecruitSystem } from '../recruit/RecruitSystem';
import { NodeUpgradeSystem } from '../manager/NodeUpgradeSystem';
import { NodeConvertSystem } from '../manager/NodeConvertSystem';
import { AIController, AIAllianceState } from '../ai/AIController';
import { FogSystem } from '../fog/FogSystem';
import { EventSystem } from '../event/EventSystem';
import { SaveSystem } from '../save/SaveSystem';

const { ccclass } = _decorator;

// 游戏总控制器，负责初始化所有子系统并按顺序驱动主循环
@ccclass('GameManager')
export class GameManager extends Component {

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

    // 公开入口：由 LobbyUI 的 onStartGame 调用
    startGame(mapSize: MapSize, aiCount: number, difficulty: Difficulty, fogMode: FogMode, gameSpeed: GameSpeed): void {
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

        // --- 8. 自动保存 ---
        this.autoSave();
    }

    // 军队到达节点：NodeBattleSystem 结算攻占 / 合并
    private handleArmyArrival(army: ArmyEntity, nodeId: number): void {
        const node = this._nodes[nodeId];
        if (!node) return;

        const result = NodeBattleSystem.resolve(army, node);

        if (result.outcome === 'attacker_wins') {
            // 节点易主 → 通知迷雾
            FogSystem.recordAttack(node, army.ownerId);
        } else if (result.outcome === 'defender_wins') {
            // 攻击失败 → 记录攻击情报（不记兵力）
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
        this._gameState = state;
        if (this.onStateChanged) this.onStateChanged(state);
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
}
