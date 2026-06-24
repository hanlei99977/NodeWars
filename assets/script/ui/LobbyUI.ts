import { _decorator, Component, Label, Button } from 'cc';
import { MapSize, Difficulty, FogMode, GameSpeed } from '../config/EnumDefine';
import { GameConfig } from '../config/GameConfig';
import { SaveSystem } from '../save/SaveSystem';

const { ccclass, property } = _decorator;

// 地图大小显示名
const MAP_SIZE_NAMES: Record<MapSize, string> = {
    [MapSize.SMALL]: '小 (15节点)',
    [MapSize.MEDIUM]: '中 (30节点)',
    [MapSize.LARGE]: '大 (50节点)',
};

// 难度显示名
const DIFFICULTY_NAMES: Record<Difficulty, string> = {
    [Difficulty.EASY]: '简单',
    [Difficulty.NORMAL]: '普通',
    [Difficulty.HARD]: '困难',
};

// 难度描述
const DIFFICULTY_DESC: Record<Difficulty, string> = {
    [Difficulty.EASY]: 'AI随机扩张，不会计算攻击力',
    [Difficulty.NORMAL]: 'AI计算攻占所需兵力',
    [Difficulty.HARD]: 'AI综合评判收益与防御',
};

// 迷雾显示名
const FOG_NAMES: Record<FogMode, string> = {
    [FogMode.NONE]: '关闭',
    [FogMode.FOG]: '开启',
};

// 大厅 UI 组件，负责地图/难度/迷雾/速度等参数选择和开始游戏
@ccclass('LobbyUI')
export class LobbyUI extends Component {

    // --- 地图大小 ---
    @property(Label)
    mapSizeLabel: Label | null = null;

    @property(Button)
    mapSizePrevBtn: Button | null = null;

    @property(Button)
    mapSizeNextBtn: Button | null = null;

    // --- AI 数量 ---
    @property(Label)
    aiCountLabel: Label | null = null;

    @property(Button)
    aiCountPrevBtn: Button | null = null;

    @property(Button)
    aiCountNextBtn: Button | null = null;

    // --- 难度 ---
    @property(Label)
    difficultyLabel: Label | null = null;

    @property(Label)
    difficultyDescLabel: Label | null = null;

    @property(Button)
    difficultyPrevBtn: Button | null = null;

    @property(Button)
    difficultyNextBtn: Button | null = null;

    // --- 迷雾 ---
    @property(Label)
    fogLabel: Label | null = null;

    @property(Button)
    fogToggleBtn: Button | null = null;

    // --- 游戏速度 ---
    @property(Label)
    gameSpeedLabel: Label | null = null;

    @property(Button)
    gameSpeedPrevBtn: Button | null = null;

    @property(Button)
    gameSpeedNextBtn: Button | null = null;

    // --- 开始/继续 ---
    @property(Button)
    startBtn: Button | null = null;

    @property(Button)
    continueBtn: Button | null = null; // 读档继续

    // --- 内部状态 ---
    private _mapSizeIndex = 0;
    private _mapSizeValues: MapSize[] = [MapSize.SMALL, MapSize.MEDIUM, MapSize.LARGE];
    private _aiCount = 1;
    private _difficultyIndex = 0;
    private _difficultyValues: Difficulty[] = [Difficulty.EASY, Difficulty.NORMAL, Difficulty.HARD];
    private _fogOn = false;
    private _gameSpeedIndex = 0;
    private _gameSpeedValues: number[] = GameConfig.GAME_SPEEDS;

    // 外部回调
    // 只是回调占位变量，无内部实现
    onStartGame: ((mapSize: MapSize, aiCount: number, difficulty: Difficulty, fogMode: FogMode, gameSpeed: GameSpeed) => void) | null = null;
    onContinueGame: (() => void) | null = null;

    onLoad(): void {
        this.refreshAll();
    }

    // --- 地图大小切换 ---
    onMapSizePrev(): void {
        this._mapSizeIndex = (this._mapSizeIndex - 1 + this._mapSizeValues.length) % this._mapSizeValues.length;
        const newSize = this._mapSizeValues[this._mapSizeIndex];
        const range = GameConfig.MAP_AI_RANGE[newSize];
        if (this._aiCount > range.max) this._aiCount = range.max;
        if (this._aiCount < range.min) this._aiCount = range.min;
        this.refreshAll();
    }

    onMapSizeNext(): void {
        this._mapSizeIndex = (this._mapSizeIndex + 1) % this._mapSizeValues.length;
        const newSize = this._mapSizeValues[this._mapSizeIndex];
        const range = GameConfig.MAP_AI_RANGE[newSize];
        if (this._aiCount > range.max) this._aiCount = range.max;
        if (this._aiCount < range.min) this._aiCount = range.min;
        this.refreshAll();
    }

    // --- AI 数量切换 ---
    onAiCountPrev(): void {
        const range = GameConfig.MAP_AI_RANGE[this._mapSizeValues[this._mapSizeIndex]];
        this._aiCount = this._aiCount <= range.min ? range.max : this._aiCount - 1;
        this.refreshAiLabel();
    }

    onAiCountNext(): void {
        const range = GameConfig.MAP_AI_RANGE[this._mapSizeValues[this._mapSizeIndex]];
        this._aiCount = this._aiCount >= range.max ? range.min : this._aiCount + 1;
        this.refreshAiLabel();
    }

    // --- 难度切换 ---
    onDifficultyPrev(): void {
        this._difficultyIndex = (this._difficultyIndex - 1 + this._difficultyValues.length) % this._difficultyValues.length;
        this.refreshDifficultyLabel();
    }

    onDifficultyNext(): void {
        this._difficultyIndex = (this._difficultyIndex + 1) % this._difficultyValues.length;
        this.refreshDifficultyLabel();
    }

    // --- 迷雾切换 ---
    onFogToggle(): void {
        this._fogOn = !this._fogOn;
        this.refreshFogLabel();
    }

    // --- 游戏速度切换 ---
    onGameSpeedPrev(): void {
        this._gameSpeedIndex = (this._gameSpeedIndex - 1 + this._gameSpeedValues.length) % this._gameSpeedValues.length;
        this.refreshGameSpeedLabel();
    }

    onGameSpeedNext(): void {
        this._gameSpeedIndex = (this._gameSpeedIndex + 1) % this._gameSpeedValues.length;
        this.refreshGameSpeedLabel();
    }

    // --- 开始/继续 ---
    onStartClicked(): void {
        if (this.onStartGame) {
            const mapSize = this._mapSizeValues[this._mapSizeIndex];
            const difficulty = this._difficultyValues[this._difficultyIndex];
            const fogMode = this._fogOn ? FogMode.FOG : FogMode.NONE;
            const speed = this._gameSpeedValues[this._gameSpeedIndex] as GameSpeed;
            this.onStartGame(mapSize, this._aiCount, difficulty, fogMode, speed);
        }
    }

    onContinueClicked(): void {
        // 检查是否有存档
        const hasSaves = SaveSystem.getSlotList().some(s => !s.isEmpty);
        if (hasSaves && this.onContinueGame) {
            this.onContinueGame();
        }
    }

    // --- 批量刷新 ---
    private refreshAll(): void {
        this.refreshMapSizeLabel();
        this.refreshAiLabel();
        this.refreshDifficultyLabel();
        this.refreshFogLabel();
        this.refreshGameSpeedLabel();
        this.refreshContinueButton();
    }

    private refreshMapSizeLabel(): void {
        if (this.mapSizeLabel) {
            const mapSize = this._mapSizeValues[this._mapSizeIndex];
            this.mapSizeLabel.string = MAP_SIZE_NAMES[mapSize];
        }
    }

    private refreshAiLabel(): void {
        if (this.aiCountLabel) {
            this.aiCountLabel.string = `${this._aiCount} 个AI`;
        }
    }

    private refreshDifficultyLabel(): void {
        const diff = this._difficultyValues[this._difficultyIndex];
        if (this.difficultyLabel) {
            this.difficultyLabel.string = DIFFICULTY_NAMES[diff];
        }
        if (this.difficultyDescLabel) {
            this.difficultyDescLabel.string = DIFFICULTY_DESC[diff];
        }
    }

    private refreshFogLabel(): void {
        if (this.fogLabel) {
            this.fogLabel.string = this._fogOn ? FOG_NAMES[FogMode.FOG] : FOG_NAMES[FogMode.NONE];
        }
    }

    private refreshGameSpeedLabel(): void {
        if (this.gameSpeedLabel) {
            const speed = this._gameSpeedValues[this._gameSpeedIndex];
            this.gameSpeedLabel.string = `${speed}x`;
        }
    }

    private refreshContinueButton(): void {
        if (this.continueBtn) {
            const hasSaves = SaveSystem.getSlotList().some(s => !s.isEmpty);
            this.continueBtn.node.active = hasSaves;
        }
    }
}
