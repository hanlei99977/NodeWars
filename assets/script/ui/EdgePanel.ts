import { _decorator, Component, Label, Button, Graphics, Color, UITransform } from 'cc';
import { EdgeEntity } from '../entity/EdgeEntity';
import { EdgeLevel } from '../config/EnumDefine';
import { EdgeConfig } from '../config/EdgeConfig';
import { EventBus } from '../common/EventBus';
import { GameEvents } from '../common/GameEvents';

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
    batchUpgradeBtn: Button | null = null;

    @property(Button)
    closeBtn: Button | null = null;

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
        if (this._edge) {
            console.log(`[EdgePanel] 升级: 线路#${this._edge.id}`);
            EventBus.emit(GameEvents.EDGE_UPGRADE, this._edge.id);
        }
    }

    onBatchUpgradeClicked(): void {
        if (this._edge) {
            console.log(`[EdgePanel] 批量升级线路`);
            EventBus.emit(GameEvents.EDGE_BATCH_UPGRADE);
        }
    }

    onCloseClicked(): void {
        console.log(`[EdgePanel] 关闭`);
        EventBus.emit(GameEvents.PANEL_CLOSE_EDGE);
    }
}
