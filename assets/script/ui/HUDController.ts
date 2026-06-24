import { _decorator, Component, Label, Button } from 'cc';
import { GameState, GameSpeed, OwnerType, AIAllianceState } from '../config/EnumDefine';
import { EconomySystem } from '../economy/EconomySystem';

const { ccclass, property } = _decorator;

// 游戏速度显示名
const SPEED_NAMES: Record<number, string> = { 1: '1x', 2: '2x', 4: '4x', 8: '8x' };

// 联盟状态显示名
const ALLIANCE_STATE_NAMES: Record<AIAllianceState, string> = {
    [AIAllianceState.FREE]: '各自为战',
    [AIAllianceState.ALLIED]: 'AI已联盟',
    [AIAllianceState.JOINT_ATTACK]: 'AI联合进攻',
};

// 顶部 HUD，实时显示金币/收入/速度/联盟/暂停
@ccclass('HUDController')
export class HUDController extends Component {

    @property(Label)
    goldLabel: Label | null = null;

    @property(Label)
    incomeLabel: Label | null = null;

    @property(Label)
    timeLabel: Label | null = null;

    @property(Label)
    speedLabel: Label | null = null;

    @property(Label)
    allianceLabel: Label | null = null;

    @property(Button)
    pauseBtn: Button | null = null;

    @property(Label)
    pauseBtnLabel: Label | null = null;

    @property(Button)
    speedPrevBtn: Button | null = null;

    @property(Button)
    speedNextBtn: Button | null = null;

    // 外部回调
    onPauseToggle: (() => void) | null = null;
    onSpeedChange: ((speed: GameSpeed) => void) | null = null;

    private _currentSpeed = GameSpeed.X1;

    // 绑定外部数据刷新 HUD（由外层每帧调用）
    bindSpeed(speed: GameSpeed): void {
        this._currentSpeed = speed;
    }

    refresh(totalTime: number, gameState: GameState, allianceState: AIAllianceState): void {
        this.refreshGold();
        this.refreshTime(totalTime);
        this.refreshSpeed();
        this.refreshAlliance(allianceState);
        this.refreshPauseBtn(gameState);
    }

    onPauseClicked(): void {
        if (this.onPauseToggle) this.onPauseToggle();
    }

    onSpeedPrev(): void {
        const speeds = [GameSpeed.X1, GameSpeed.X2, GameSpeed.X4, GameSpeed.X8];
        const idx = speeds.indexOf(this._currentSpeed);
        const next = speeds[(idx - 1 + speeds.length) % speeds.length];
        this._currentSpeed = next;
        if (this.onSpeedChange) this.onSpeedChange(next);
        this.refreshSpeed();
    }

    onSpeedNext(): void {
        const speeds = [GameSpeed.X1, GameSpeed.X2, GameSpeed.X4, GameSpeed.X8];
        const idx = speeds.indexOf(this._currentSpeed);
        const next = speeds[(idx + 1) % speeds.length];
        this._currentSpeed = next;
        if (this.onSpeedChange) this.onSpeedChange(next);
        this.refreshSpeed();
    }

    private refreshGold(): void {
        if (!this.goldLabel) return;
        const gold = EconomySystem.getGold(OwnerType.PLAYER);
        this.goldLabel.string = `金币: ${Math.floor(gold)}`;
    }

    private refreshTime(totalTime: number): void {
        if (!this.timeLabel) return;
        const min = Math.floor(totalTime / 60);
        const sec = Math.floor(totalTime % 60);
        this.timeLabel.string = `${HUDController.pad2(min)}:${HUDController.pad2(sec)}`;
    }

    private refreshSpeed(): void {
        if (this.speedLabel) {
            this.speedLabel.string = SPEED_NAMES[this._currentSpeed] || '1x';
        }
    }

    private refreshAlliance(state: AIAllianceState): void {
        if (this.allianceLabel) {
            this.allianceLabel.string = ALLIANCE_STATE_NAMES[state] || '';
            this.allianceLabel.node.active = state !== AIAllianceState.FREE;
        }
    }

    private refreshPauseBtn(gameState: GameState): void {
        if (!this.pauseBtnLabel) return;
        if (gameState === GameState.WIN || gameState === GameState.LOSE) {
            this.pauseBtnLabel.string = '结束';
            if (this.pauseBtn) this.pauseBtn.interactable = false;
        } else {
            this.pauseBtnLabel.string = gameState === GameState.PAUSED ? '▶' : '⏸';
            if (this.pauseBtn) this.pauseBtn.interactable = true;
        }
    }

    private static pad2(n: number): string {
        return (n < 10 ? '0' : '') + n;
    }
}
