import { _decorator, Component, Label, Button } from 'cc';
import { EdgeEntity } from '../entity/EdgeEntity';
import { EdgeLevel } from '../config/EnumDefine';
import { EdgeConfig } from '../config/EdgeConfig';

const { ccclass, property } = _decorator;

const LEVEL_NAMES: Record<EdgeLevel, string> = {
    [EdgeLevel.LV1]: '1级',
    [EdgeLevel.LV2]: '2级',
    [EdgeLevel.LV3]: '3级',
};

@ccclass('EdgePanel')
export class EdgePanel extends Component {

    @property(Label)
    titleLabel: Label | null = null;

    @property(Label)
    infoLabel: Label | null = null;

    @property(Button)
    upgradeBtn: Button | null = null;

    @property(Label)
    upgradeBtnLabel: Label | null = null;

    @property(Button)
    closeBtn: Button | null = null;

    onUpgrade: ((edgeId: number) => void) | null = null;
    onClose: (() => void) | null = null;

    private _edge: EdgeEntity | null = null;

    bindToEntity(edge: EdgeEntity): void {
        this._edge = edge;
        this.refresh();
    }

    refresh(): void {
        if (!this._edge) return;

        const e = this._edge;

        if (this.titleLabel) {
            this.titleLabel.string = `线路 #${e.id}`;
        }

        if (this.infoLabel) {
            const speedBonus = EdgeConfig.SPEED_BONUS[e.level];
            this.infoLabel.string = `${LEVEL_NAMES[e.level]} | 长度: ${e.length} | 移速: ${speedBonus}x`;
        }

        if (this.upgradeBtn && this.upgradeBtnLabel) {
            if (e.level === EdgeLevel.LV3) {
                this.upgradeBtnLabel.string = '已满级';
                this.upgradeBtn.interactable = false;
            } else {
                const cost = EdgeConfig.UPGRADE_GOLD[e.level] || 0;
                this.upgradeBtnLabel.string = `升级→${LEVEL_NAMES[e.level + 1]} (${cost}金)`;
                this.upgradeBtn.interactable = true;
            }
        }
    }

    onUpgradeClicked(): void {
        if (this._edge && this.onUpgrade) {
            this.onUpgrade(this._edge.id);
        }
    }

    onCloseClicked(): void {
        if (this.onClose) this.onClose();
    }
}
