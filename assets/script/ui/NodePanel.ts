import { _decorator, Component, Label, Button } from 'cc';
import { NodeEntity } from '../entity/NodeEntity';
import { NodeLevel, NodeType, SpecialNodeType, OwnerType, UpgradeTaskState, ConvertTaskState, RecruitTaskState } from '../config/EnumDefine';
import { NodeConfig } from '../config/NodeConfig';

const { ccclass, property } = _decorator;

// 节点类型中文名映射
const TYPE_NAME_MAP: Record<NodeType, string> = {
    [NodeType.NORMAL]: '普通',
    [NodeType.FORTRESS]: '要塞',
    [NodeType.MARKET]: '市场',
};

// 特殊节点中文名映射
const SPECIAL_TYPE_NAME_MAP: Record<SpecialNodeType, string> = {
    [SpecialNodeType.NONE]: '无',
    [SpecialNodeType.GOLD_MINE]: '金矿（收入+30%）',
    [SpecialNodeType.BARRACKS]: '军营（征兵-30%时间）',
    [SpecialNodeType.HIGHLAND]: '高地（防御+20%）',
};

// 节点详情面板，点击节点后弹出，显示信息并提供升级/转换/征兵/派兵操作
@ccclass('NodePanel')
export class NodePanel extends Component {

    // --- 信息显示 ---
    @property(Label)
    titleLabel: Label | null = null;            // 节点ID标题

    @property(Label)
    infoLabel: Label | null = null;             // 等级/类型/特殊属性

    @property(Label)
    garrisonLabel: Label | null = null;         // 驻军数量

    @property(Label)
    buildStatusLabel: Label | null = null;      // 建筑任务状态

    @property(Label)
    recruitStatusLabel: Label | null = null;    // 征兵队列状态

    // --- 升级 ---
    @property(Button)
    upgradeBtn: Button | null = null;           // 升级按钮（1→2 / 2→3）

    @property(Label)
    upgradeBtnLabel: Label | null = null;       // 升级按钮文字

    // --- 类型转换 ---
    @property(Button)
    convertToFortressBtn: Button | null = null; // 转为要塞

    @property(Button)
    convertToMarketBtn: Button | null = null;   // 转为市场

    // --- 征兵 ---
    @property(Button)
    recruitBtn: Button | null = null;           // 征兵按钮

    @property(Label)
    recruitBtnLabel: Label | null = null;       // 征兵按钮文字

    // --- 派兵 ---
    @property(Button)
    troopPrevBtn: Button | null = null;

    @property(Label)
    troopCountLabel: Label | null = null;

    @property(Button)
    troopNextBtn: Button | null = null;

    @property(Button)
    sendTroopsBtn: Button | null = null;

    // --- 关闭 ---
    @property(Button)
    closeBtn: Button | null = null;             // 关闭面板按钮

    // --- 自动征兵开关 ---
    @property(Button)
    autoRecruitToggleBtn: Button | null = null; // 自动征兵开关

    @property(Label)
    autoRecruitToggleLabel: Label | null = null;// 开关状态文字

    // --- 批量升级 ---
    @property(Button)
    batchUpgradeAllBtn: Button | null = null;   // 批量升级所有节点

    @property(Button)
    batchUpgradeFortressBtn: Button | null = null; // 批量升级所有要塞

    @property(Button)
    batchUpgradeMarketBtn: Button | null = null;   // 批量升级所有市场

    // --- 内部状态 ---
    private _entity: NodeEntity | null = null;
    private _ownerId: string = '';
    private _autoRecruitEnabled: boolean = false;
    private _troopCount: number = 0;
    private _maxTroops: number = 0;

    // 外部回调（由 GameManager 之类的外层绑定，处理实际逻辑）
    onUpgrade: ((nodeId: number) => void) | null = null;
    onConvertToFortress: ((nodeId: number) => void) | null = null;
    onConvertToMarket: ((nodeId: number) => void) | null = null;
    onRecruit: ((nodeId: number) => void) | null = null;
    onSendTroops: ((nodeId: number, count: number) => void) | null = null;
    onClose: (() => void) | null = null;
    onBatchUpgradeAll: (() => void) | null = null;
    onBatchUpgradeFortress: (() => void) | null = null;
    onBatchUpgradeMarket: (() => void) | null = null;

    // 绑定节点数据并刷新面板
    bindToEntity(entity: NodeEntity, ownerId: string): void {
        this._entity = entity;
        this._ownerId = ownerId;
        this.refreshPanel();
    }

    // 获取当前绑定的实体
    get entity(): NodeEntity | null {
        return this._entity;
    }

    // 根据实体最新数据刷新面板全部内容
    refreshPanel(): void {
        if (!this._entity) return;

        // 标题
        if (this.titleLabel) {
            this.titleLabel.string = `节点 #${this._entity.id}`;
        }

        // 信息行
        if (this.infoLabel) {
            const typeName = TYPE_NAME_MAP[this._entity.type] || '未知';
            const specialName = SPECIAL_TYPE_NAME_MAP[this._entity.specialType] || '';
            this.infoLabel.string = `Lv${this._entity.level} ${typeName} ${specialName}`;
        }

        // 驻军
        if (this.garrisonLabel) {
            this.garrisonLabel.string = `驻军：${this._entity.garrisonCount}`;
        }

        // 建筑任务状态
        if (this.buildStatusLabel) {
            this.buildStatusLabel.string = this.getBuildStatusText();
        }

        // 征兵队列状态
        if (this.recruitStatusLabel) {
            this.recruitStatusLabel.string = this.getRecruitStatusText();
        }

        // 升级按钮
        this.refreshUpgradeButton();

        // 类型转换按钮：仅空闲时可操作
        const canConvert = this._entity.isIdle;
        if (this.convertToFortressBtn) this.convertToFortressBtn.interactable = canConvert;
        if (this.convertToMarketBtn) this.convertToMarketBtn.interactable = canConvert;

        // 征兵按钮
        this.refreshRecruitButton();

        // 派兵
        this._troopCount = 0;
        this._maxTroops = this._entity.garrisonCount;
        this.updateTroopLabel();

        // 面板显示/隐藏（玩家节点才显示操作，非玩家节点仅查看）
        const isOwnNode = this._entity.ownerId === OwnerType.PLAYER;
        this.setButtonsVisible(isOwnNode);
    }

    // 派兵数量 -1
    onTroopPrevClicked(): void {
        console.log(`[NodePanel] 派兵减: 当前=${this._troopCount}`);
        if (this._troopCount <= 0) return;
        this._troopCount-=10;
        this.updateTroopLabel();
    }

    // 派兵数量 +1
    onTroopNextClicked(): void {
        console.log(`[NodePanel] 派兵加: 当前=${this._troopCount}`);
        if (this._troopCount >= this._maxTroops) return;
        this._troopCount+=10;
        this.updateTroopLabel();
    }

    // 派兵按钮点击回调
    onSendTroopsClicked(): void {
        console.log(`[NodePanel] 派兵: 节点#${this._entity?.id} 数量=${this._troopCount}`);
        if (!this._entity) return;
        if (this._troopCount > 0 && this.onSendTroops) {
            this.onSendTroops(this._entity.id, this._troopCount);
        }
    }

    // 更新派兵数量标签
    private updateTroopLabel(): void {
        if (this.troopCountLabel) {
            this.troopCountLabel.string = `${this._troopCount} 兵`;
        }
    }

    // 升级按钮点击
    onUpgradeClicked(): void {
        console.log(`[NodePanel] 升级: 节点#${this._entity?.id}`);
        if (this._entity && this.onUpgrade) {
            this.onUpgrade(this._entity.id);
        }
    }

    // 转为要塞
    onConvertToFortressClicked(): void {
        console.log(`[NodePanel] 转要塞: 节点#${this._entity?.id}`);
        if (this._entity && this.onConvertToFortress) {
            this.onConvertToFortress(this._entity.id);
        }
    }

    // 转为市场
    onConvertToMarketClicked(): void {
        console.log(`[NodePanel] 转市场: 节点#${this._entity?.id}`);
        if (this._entity && this.onConvertToMarket) {
            this.onConvertToMarket(this._entity.id);
        }
    }

    // 征兵
    onRecruitClicked(): void {
        console.log(`[NodePanel] 征兵: 节点#${this._entity?.id}`);
        if (this._entity && this.onRecruit) {
            this.onRecruit(this._entity.id);
        }
    }

    // 关闭面板
    onCloseClicked(): void {
        console.log(`[NodePanel] 关闭`);
        if (this.onClose) this.onClose();
    }

    // 批量升级所有
    onBatchUpgradeAllClicked(): void {
        console.log(`[NodePanel] 批量升级全部`);
        if (this.onBatchUpgradeAll) this.onBatchUpgradeAll();
    }

    // 批量升级所有要塞
    onBatchUpgradeFortressClicked(): void {
        console.log(`[NodePanel] 批量升级要塞`);
        if (this.onBatchUpgradeFortress) this.onBatchUpgradeFortress();
    }

    // 批量升级所有市场
    onBatchUpgradeMarketClicked(): void {
        console.log(`[NodePanel] 批量升级市场`);
        if (this.onBatchUpgradeMarket) this.onBatchUpgradeMarket();
    }

    // 切换自动征兵
    onAutoRecruitToggleClicked(): void {
        console.log(`[NodePanel] 自动征兵切换: ${this._autoRecruitEnabled ? '开→关' : '关→开'}`);
        this._autoRecruitEnabled = !this._autoRecruitEnabled;
        if (this.autoRecruitToggleLabel) {
            this.autoRecruitToggleLabel.string = this._autoRecruitEnabled ? '自动征兵：开' : '自动征兵：关';
        }
    }

    // 获取当前自动征兵是否开启
    get autoRecruitEnabled(): boolean {
        return this._autoRecruitEnabled;
    }

    // --- 内部辅助 ---

    // 刷新升级按钮文字和可点击状态
    private refreshUpgradeButton(): void {
        if (!this._entity) return;
        if (!this.upgradeBtn || !this.upgradeBtnLabel) return;

        const level = this._entity.level;
        const isBusy = !this._entity.isIdle;

        if (level === NodeLevel.LV3) {
            this.upgradeBtnLabel.string = '已满级';
            this.upgradeBtn.interactable = false;
        } else if (isBusy) {
            this.upgradeBtnLabel.string = `升Lv${level + 1}`;
            this.upgradeBtn.interactable = false;
        } else {
            const cost = NodeConfig.UPGRADE_GOLD[level] || 0;
            const time = NodeConfig.UPGRADE_TIME[level] || 0;
            this.upgradeBtnLabel.string = `升Lv${level + 1} ${cost}金 ${time}s`;
            this.upgradeBtn.interactable = true;
        }
    }

    // 刷新征兵按钮文字和可点击状态
    private refreshRecruitButton(): void {
        if (!this._entity) return;
        if (!this.recruitBtn || !this.recruitBtnLabel) return;

        if (this._entity.isRecruitQueueFull) {
            this.recruitBtnLabel.string = '征兵队列已满';
            this.recruitBtn.interactable = false;
        } else {
            this.recruitBtnLabel.string = '征兵 100金';
            this.recruitBtn.interactable = true;
        }
    }

    // 控制操作按钮组的显隐（非己方节点隐藏操作按钮，仅查看）
    private setButtonsVisible(visible: boolean): void {
        const btns = [
            this.upgradeBtn, this.convertToFortressBtn, this.convertToMarketBtn,
            this.recruitBtn, this.troopPrevBtn, this.troopNextBtn, this.sendTroopsBtn,
            this.autoRecruitToggleBtn,
            this.batchUpgradeAllBtn, this.batchUpgradeFortressBtn, this.batchUpgradeMarketBtn,
        ];
        for (const btn of btns) {
            if (btn && btn.node) btn.node.active = visible;
        }
    }

    // 构造建筑任务状态文本
    private getBuildStatusText(): string {
        if (!this._entity) return '';
        const u = this._entity.upgradeTask;
        const c = this._entity.convertTask;
        if (u && u.state !== UpgradeTaskState.COMPLETED) {
            const pct = Math.floor((u.progress / u.totalTime) * 100);
            const name = u.state === UpgradeTaskState.PENDING ? '排队中' : `升级中 ${pct}%`;
            return `升级→Lv${u.targetLevel}: ${name}`;
        }
        if (c && c.state !== ConvertTaskState.COMPLETED) {
            const pct = Math.floor((c.progress / c.totalTime) * 100);
            const name = c.state === ConvertTaskState.PENDING ? '排队中' : `转换中 ${pct}%`;
            return `转换→${TYPE_NAME_MAP[c.targetType]}: ${name}`;
        }
        return '空闲';
    }

    // 构造征兵队列状态文本
    private getRecruitStatusText(): string {
        if (!this._entity) return '';
        const q = this._entity.recruitQueue;
        if (q.length === 0) return '征兵队列：空';
        let text = '征兵队列：';
        for (let i = 0; i < q.length; i++) {
            const t = q[i];
            if (t.state === RecruitTaskState.COMPLETED) continue;
            const pct = Math.floor((t.progress / t.totalTime) * 100);
            const status = t.state === RecruitTaskState.PENDING ? '等待' : `${pct}%`;
            text += `[${t.soldierCount}兵 ${status}]`;
        }
        return text;
    }
}
