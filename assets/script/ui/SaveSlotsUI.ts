import { _decorator, Component, Label, Button } from 'cc';
import { SaveSystem, SaveSlotMeta } from '../save/SaveSystem';

const { ccclass, property } = _decorator;

// 存档槽位选择面板，显示 3 个槽位，点击读取或删除
@ccclass('SaveSlotsUI')
export class SaveSlotsUI extends Component {

    @property(Label)
    slotLabels: Label[] = [];

    @property(Button)
    slotButtons: Button[] = [];

    @property(Button)
    deleteButtons: Button[] = [];

    @property(Button)
    closeBtn: Button | null = null;

    // 外部回调
    onLoadSlot: ((slotId: number) => void) | null = null;
    onClose: (() => void) | null = null;

    onEnable(): void {
        this.refresh();
    }

    refresh(): void {
        const slots = SaveSystem.getSlotList();
        // 更新每个槽位的显示
        for (let i = 0; i < SaveSystem.MAX_SLOTS; i++) {
            const slot = slots[i];
            const label = this.slotLabels[i];
            const btn = this.slotButtons[i];
            const delBtn = this.deleteButtons[i];
            
            if (!label || !btn) continue;

            if (slot.isEmpty) {
                label.string = `槽位 ${i + 1} — 空`;
                btn.interactable = false;
                if (delBtn) delBtn.node.active = false;
            } else {
                const date = new Date(slot.timestamp);
                const pad = (n: number): string => (n < 10 ? '0' : '') + n;
                const timeStr = `${date.getMonth() + 1}/${date.getDate()} ${date.getHours()}:${pad(date.getMinutes())}`;
                const mapName = slot.mapSize === 'small' ? '小' : slot.mapSize === 'medium' ? '中' : '大';
                const min = Math.floor(slot.totalTime / 60);
                const sec = Math.floor(slot.totalTime % 60);
                label.string = `槽位 ${i + 1}: ${mapName}图 ${slot.playerNodeCount}节点 ${min}分${sec}秒 [${timeStr}]`;
                btn.interactable = true;
                if (delBtn) delBtn.node.active = true;
            }
        }
    }

    onSlotClicked(_event: Event, slotId: string): void {
        const id = parseInt(slotId, 10);
        if (this.onLoadSlot) this.onLoadSlot(id);
    }

    onDeleteClicked(_event: Event, slotId: string): void {
        const id = parseInt(slotId, 10);
        SaveSystem.deleteSlot(id);
        this.refresh();
    }

    onCloseClicked(): void {
        if (this.onClose) this.onClose();
    }
}
