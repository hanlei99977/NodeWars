import { NodeEntity } from '../entity/NodeEntity';
import { EdgeEntity } from '../entity/EdgeEntity';
import { ArmyEntity } from '../entity/ArmyEntity';
import { GameState, MapSize, Difficulty, FogMode, GameSpeed, OwnerType, AIAllianceState } from '../config/EnumDefine';
import { GameConfig } from '../config/GameConfig';
import { AIController } from '../ai/AIController';
import { SaveSystem, SaveData } from '../save/SaveSystem';
import { GameOverUI } from '../ui/GameOverUI';

/**
 * 游戏状态管理器，负责游戏状态、配置、胜负检测、自动保存
 *
 * 职责：
 *   - 持有游戏状态（PLAYING / PAUSED / WIN / LOSE）
 *   - 持有游戏配置（地图大小、AI数量、难度、迷雾模式、速度）
 *   - 胜败检测
 *   - 自动保存
 *   - 状态切换 + 回调通知
 *   - 暂停 / 调速
 *   - 只读查询接口
 *
 * 注意：这是一个实例类，由 GameManager 在 onLoad 中创建并持有。
 *       游戏状态变更通过 onStateChanged 回调通知外部。
 */
export class GameStateManager {

    /** 当前游戏状态 */
    private _gameState: GameState = GameState.PLAYING;

    /** 游戏逻辑时间（累计 dt * gameSpeed，秒） */
    private _totalTime = 0;

    /** 上次自动保存的游戏时间 */
    private _lastSaveTime = 0;

    /** 地图大小 */
    private _mapSize: MapSize = MapSize.SMALL;

    /** AI 数量 */
    private _aiCount = 1;

    /** 游戏难度 */
    private _difficulty: Difficulty = Difficulty.EASY;

    /** 迷雾模式 */
    private _fogMode: FogMode = FogMode.NONE;

    /** 游戏速度倍率 */
    private _gameSpeed: GameSpeed = GameSpeed.X1;

    /** 地图生成结果（包含 aiNodeIds 等） */
    private _mapResult: { aiNodeIds: number[] } | null = null;

    /** 玩家出生节点ID */
    private _playerNodeId = -1;

    /** 下一个军队ID（自动递增） */
    private _nextArmyId = 1;

    /** 游戏结束 UI */
    gameOverUI: GameOverUI | null = null;

    /** 状态变更回调（GameManager 注入） */
    onStateChanged: ((state: GameState) => void) | null = null;

    // ==================== 只读查询 ====================

    get gameState(): GameState { return this._gameState; }
    get totalTime(): number { return this._totalTime; }
    get gameSpeed(): GameSpeed { return this._gameSpeed; }
    get mapSize(): MapSize { return this._mapSize; }
    get difficulty(): Difficulty { return this._difficulty; }
    get fogMode(): FogMode { return this._fogMode; }
    get playerNodeId(): number { return this._playerNodeId; }
    get nextArmyId(): number { return this._nextArmyId; }
    get mapResult(): { aiNodeIds: number[] } | null { return this._mapResult; }
    get allianceState(): AIAllianceState { return AIController.allianceState; }

    // ==================== 初始化与配置 ====================

    /**
     * 为新游戏设置配置参数（由 GameManager.startGame 调用）
     *
     * @param mapSize   地图大小
     * @param aiCount   AI 数量
     * @param difficulty 游戏难度
     * @param fogMode   迷雾模式
     * @param gameSpeed 游戏速度倍率
     * @returns 无
     */
    initForNewGame(mapSize: MapSize, aiCount: number, difficulty: Difficulty, fogMode: FogMode, gameSpeed: GameSpeed): void {
        this._totalTime = 0;
        this._lastSaveTime = 0;
        this._mapSize = mapSize;
        this._aiCount = aiCount;
        this._difficulty = difficulty;
        this._fogMode = fogMode;
        this._gameSpeed = gameSpeed;
    }

    /**
     * 为读档设置配置参数（由 GameManager.loadGame 调用）
     *
     * @param data  存档反序列化后的数据
     * @returns 无
     */
    initForLoadedGame(data: SaveData): void {
        this._mapSize = data.mapSize as MapSize;
        this._aiCount = data.aiNodeIds.length;
        this._difficulty = data.difficulty as Difficulty;
        this._fogMode = data.fogMode as FogMode;
        this._gameSpeed = data.gameSpeed as GameSpeed;
        this._totalTime = data.totalTime;
        this._playerNodeId = data.playerNodeId;
        this._nextArmyId = data.nextArmyId;
    }

    /** 获取 AI 数量 */
    get aiCount(): number { return this._aiCount; }

    /** 设置地图生成结果 */
    set mapResult(v: { aiNodeIds: number[] } | null) { this._mapResult = v; }

    /** 设置玩家出生节点ID */
    set playerNodeId(v: number) { this._playerNodeId = v; }

    /** 设置下一个军队ID */
    set nextArmyId(v: number) { this._nextArmyId = v; }

    // ==================== 时间推进 ====================

    /**
     * 推进游戏时间（每帧调用）
     *
     * @param logicDt  逻辑帧时间增量（dt * gameSpeed）
     * @returns 无
     */
    advanceTime(logicDt: number): void {
        this._totalTime += logicDt;
    }

    // ==================== 暂停 / 调速 ====================

    /**
     * 暂停 / 继续切换
     *
     * PLAYING → PAUSED，PAUSED → PLAYING
     *
     * @returns 无
     */
    togglePause(): void {
        if (this._gameState === GameState.PLAYING) {
            this.changeState(GameState.PAUSED);
        } else if (this._gameState === GameState.PAUSED) {
            this.changeState(GameState.PLAYING);
        }
    }

    /**
     * 设置游戏速度倍率
     *
     * @param speed  游戏速度
     * @returns 无
     */
    setGameSpeed(speed: GameSpeed): void {
        this._gameSpeed = speed;
    }

    // ==================== 胜败检测 ====================

    /**
     * 胜败检测：统计各势力节点数
     *
     * 规则：
     *   - 玩家节点数为 0 → 失败
     *   - 所有 AI 节点数为 0 → 胜利
     *
     * @param nodes   所有节点实体列表
     * @param aiIds   AI 势力ID列表
     * @returns 无
     */
    checkWinLose(nodes: NodeEntity[], aiIds: string[]): void {
        const ownerCounts = new Map<string, number>();
        for (const node of nodes) {
            if (node.ownerId === OwnerType.NEUTRAL) continue;
            ownerCounts.set(node.ownerId, (ownerCounts.get(node.ownerId) || 0) + 1);
        }

        const playerCount = ownerCounts.get(OwnerType.PLAYER) || 0;

        if (playerCount === 0) {
            this.changeState(GameState.LOSE);
            return;
        }

        let aliveAiCount = 0;
        for (const aiId of aiIds) {
            if ((ownerCounts.get(aiId) || 0) > 0) {
                aliveAiCount++;
            }
        }

        if (aliveAiCount === 0) {
            this.changeState(GameState.WIN);
        }
    }

    // ==================== 自动保存 ====================

    /**
     * 自动保存（每帧检测间隔）
     *
     * 若距上次保存超过 AUTO_SAVE_INTERVAL，保存到槽位 0
     *
     * @param nodes   所有节点实体列表
     * @param edges   所有边实体列表
     * @param armies  所有军队实体列表
     * @returns 无
     */
    autoSave(nodes: NodeEntity[], edges: EdgeEntity[], armies: ArmyEntity[]): void {
        if (this._totalTime - this._lastSaveTime < GameConfig.AUTO_SAVE_INTERVAL) return;
        this._lastSaveTime = this._totalTime;

        SaveSystem.save(
            0,
            nodes,
            edges,
            armies,
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

    // ==================== 状态切换 ====================

    /**
     * 状态切换 + 回调通知
     *
     * 若切换到 WIN 或 LOSE，弹出 GameOverUI
     *
     * @param state  目标状态
     * @returns 无
     */
    changeState(state: GameState): void {
        console.log(`[GameState] 状态变更: ${GameState[this._gameState]} → ${GameState[state]}`);
        this._gameState = state;
        if (this.onStateChanged) this.onStateChanged(state);

        if (state === GameState.WIN || state === GameState.LOSE) {
            if (this.gameOverUI) {
                // 需要 nodes 引用来计算胜方节点数
                // 这里暂不直接访问 nodes，由 GameManager 在必要时间接通知
                if (this.onGameEnd) this.onGameEnd(state);
            }
        }
    }

    /**
     * 游戏结束回调（由 GameManager 注入，用于计算节点数并弹出 GameOverUI）
     *
     * @param state  结束状态（WIN 或 LOSE）
     */
    onGameEnd: ((state: GameState) => void) | null = null;
}