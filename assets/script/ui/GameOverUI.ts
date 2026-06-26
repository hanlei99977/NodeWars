import { _decorator, Component, Label, Button, Graphics, Color, UITransform } from 'cc';
import { GameState } from '../config/EnumDefine';
import { EventBus } from '../common/EventBus';
import { GameEvents } from '../common/GameEvents';

const { ccclass, property } = _decorator;

// 游戏结束面板，显示胜败及统计信息
@ccclass('GameOverUI')
export class GameOverUI extends Component {

    @property(Label)
    titleLabel: Label | null = null;

    @property(Label)
    statsLabel: Label | null = null;

    @property(Label)
    rewardLabel: Label | null = null;

    @property(Button)
    restartBtn: Button | null = null;

    @property(Button)
    lobbyBtn: Button | null = null;

    show(state: GameState, totalTime: number, nodeCount: number, reward: number): void {
        this.node.active = true;

        const isWin = state === GameState.WIN;
        const min = Math.floor(totalTime / 60);
        const sec = Math.floor(totalTime % 60);

        if (this.titleLabel) {
            this.titleLabel.string = isWin ? '胜利！' : '失败';
        }

        if (this.statsLabel) {
            this.statsLabel.string = `用时 ${min}分${sec}秒 | 占据 ${nodeCount} 个节点`;
        }

        if (this.rewardLabel) {
            this.rewardLabel.string = isWin ? `获得奖励: ${reward} 金币` : '';
        }
    }

    onRestartClicked(): void {
        console.log(`[GameOverUI] 重新开始`);
        EventBus.emit(GameEvents.GAME_RESTART);
    }

    onLobbyClicked(): void {
        console.log(`[GameOverUI] 返回大厅`);
        EventBus.emit(GameEvents.GAME_LOBBY);
    }
}
