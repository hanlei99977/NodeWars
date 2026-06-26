import { _decorator, Component, Label, Button, Graphics, Color, UITransform } from 'cc';
import { ArmyEntity } from '../entity/ArmyEntity';
import { OwnerType } from '../config/EnumDefine';
import { EventBus } from '../common/EventBus';
import { GameEvents } from '../common/GameEvents';

const { ccclass, property } = _decorator;

const OWNER_NAMES: Record<string, string> = {
    [OwnerType.PLAYER]: '玩家',
};

@ccclass('ArmyPanel')
export class ArmyPanel extends Component {

    @property(Label)
    titleLabel: Label | null = null;

    @property(Label)
    infoLabel: Label | null = null;

    @property(Label)
    progressLabel: Label | null = null;

    @property(Label)
    pathLabel: Label | null = null;

    @property(Button)
    closeBtn: Button | null = null;

    private _army: ArmyEntity | null = null;

    bindToEntity(army: ArmyEntity): void {
        this._army = army;
        this.refresh();
    }

    refresh(): void {
        if (!this._army) return;

        const a = this._army;

        if (this.titleLabel) {
            const ownerName = OWNER_NAMES[a.ownerId] || a.ownerId;
            this.titleLabel.string = `军队 #${a.id} (${ownerName})`;
        }

        if (this.infoLabel) {
            this.infoLabel.string = `兵力: ${a.soldierCount} | 累计战损: ${a.totalSoldiersLost}`;
        }

        if (this.progressLabel) {
            if (a.pathNodeIds.length >= 2) {
                const ei = a.currentEdgeIndex;
                const from = a.pathNodeIds[ei];
                const to = a.pathNodeIds[ei + 1];
                const pct = Math.floor(a.progress * 100);
                this.progressLabel.string = `#${from} → #${to} (${pct}%)`;
            } else {
                this.progressLabel.string = '已到达';
            }
        }

        if (this.pathLabel) {
            this.pathLabel.string = `路径: [${a.pathNodeIds.join(' → ')}]`;
        }
    }

    onCloseClicked(): void {
        console.log(`[ArmyPanel] 关闭`);
        EventBus.emit(GameEvents.PANEL_CLOSE_ARMY);
    }
}
