import {
    _decorator, Component, Node, Canvas, UITransform, Label, Button,
    EventHandler, Enum,
} from 'cc';
import { LobbyUI } from '../ui/LobbyUI';
import { HUDController } from '../ui/HUDController';
import { NodePanel } from '../ui/NodePanel';
import { EdgePanel } from '../ui/EdgePanel';
import { ArmyPanel } from '../ui/ArmyPanel';
import { SaveSlotsUI } from '../ui/SaveSlotsUI';
import { GameOverUI } from '../ui/GameOverUI';
import { GameManager } from '../manager/GameManager';

const { ccclass, executeInEditMode, property } = _decorator;

const SceneType = Enum({
    LOBBY: 0,
    GAME: 1,
    NONE: 2,
});

// —— 构建工具函数 ——
// 新建一个 UI 节点，挂载 UITransform，设置位置和大小，并添加到父节点
function make(parent: Node, name: string, x = 0, y = 0, w = 100, h = 40): Node {
    const node = new Node(name);
    const ui = node.addComponent(UITransform);
    ui.setContentSize(w, h);
    node.setPosition(x, y, 0);
    parent.addChild(node);
    return node;
}
// 新建一个 Label 节点，挂载 Label 组件，设置文本和字体大小，并添加到父节点
// 入参：parent - 父节点，name - 节点名，text - 显示文本，x/y - 位置，w/h - 大小，fontSize - 字体大小
function makeLabel(parent: Node, name: string, text: string, x = 0, y = 0, w = 200, h = 40, fontSize = 20): Label {
    const node = make(parent, name, x, y, w, h);
    const l = node.addComponent(Label);
    l.string = text;
    l.fontSize = fontSize;
    return l;
}
// 新建一个 Button 节点，挂载 Button 组件，并在其下新建一个 Label 节点作为按钮文本
function makeBtn(parent: Node, name: string, text: string, x = 0, y = 0, w = 160, h = 46, fontSize = 20): { btn: Button; label: Label; node: Node } {
    const node = make(parent, name, x, y, w, h);
    const btn = node.addComponent(Button);
    const child = make(node, name + '_Lbl', 0, 0, w, h);
    const lbl = child.addComponent(Label);
    lbl.string = text;
    lbl.fontSize = fontSize;
    return { btn, label: lbl, node };
}
// 将按钮点击事件绑定到指定组件的指定方法上
// 入参：btn - 按钮组件，target - 目标节点，comp - 组件名，handler - 方法名
function bindClick(btn: Button, target: Node, comp: string, handler: string): void {
    const eh = new EventHandler();// EventHandler 对象用于绑定按钮点击事件
    eh.target = target;
    eh.component = comp;
    eh.handler = handler;
    btn.clickEvents.push(eh);// 将事件处理器添加到按钮的点击事件列表中
}

@ccclass('SceneBuilder')// SceneBuilder 组件用于在场景加载时动态构建 UI 元素
@executeInEditMode // 允许在编辑模式下执行 onLoad 方法
export class SceneBuilder extends Component {

    @property({ type: SceneType })
    sceneType: number = SceneType.NONE;

    onLoad(): void {
        const canvas = this.ensureCanvas();
        if (!canvas) return;

        // 检查是否已构建过（通过标志子节点存在性判断）
        if (this.sceneType === SceneType.LOBBY) {
            if (canvas.getChildByName('Title')) return;
            this.buildLobby(canvas);
        } else if (this.sceneType === SceneType.GAME) {
            if (canvas.getChildByName('GameOverUI')) return;
            this.buildGame(canvas);
        }
    }

    // 确保有 Canvas 根节点（不再创建，只查找）
    private ensureCanvas(): Node | null {
        let c = this.node.getComponent(Canvas);
        if (c) return this.node;
        const p = this.node.parent;
        if (p && p.getComponent(Canvas)) return p;
        // 场景模板创建时应该已有 Canvas，找不到则直接以 this.node 为根构建
        return this.node;
    }

    // ======================== LOBBY ========================

    private buildLobby(canvas: Node): void {
        const lx = -240;
        const bw = 90;
        const bh = 44;
        let y = 260;
        const gap = 56;

        makeLabel(canvas, 'Title', 'Node Wars', 0, y, 400, 60, 48);

        y -= gap + 20;
        makeLabel(canvas, 'MapSizeLabel', '小 (15节点)', lx, y, 280, 32, 22);
        const msP = makeBtn(canvas, 'MsPrev', '←',   lx + 160, y, bw, bh);
        const msN = makeBtn(canvas, 'MsNext', '→',   lx + 260, y, bw, bh);

        y -= gap;
        makeLabel(canvas, 'AiCountLabel', '1 个AI',  lx, y, 200, 32, 22);
        const acP = makeBtn(canvas, 'AcPrev', '←',   lx + 160, y, bw, bh);
        const acN = makeBtn(canvas, 'AcNext', '→',   lx + 260, y, bw, bh);

        y -= gap;
        makeLabel(canvas, 'DiffLabel', '简单',       lx, y, 160, 32, 22);
        makeLabel(canvas, 'DiffDesc', 'AI随机扩张',   lx, y - 28, 360, 22, 16);
        const dP = makeBtn(canvas, 'DPrev', '←',     lx + 160, y, bw, bh);
        const dN = makeBtn(canvas, 'DNext', '→',     lx + 260, y, bw, bh);

        y -= gap;
        makeLabel(canvas, 'FogLabel', '迷雾：关闭',   lx, y, 200, 32, 22);
        const fB = makeBtn(canvas, 'FogToggle', '切换', lx + 160, y, bw, bh);

        y -= gap;
        makeLabel(canvas, 'SpeedLabel', '1x',         lx, y, 140, 32, 22);
        const sP = makeBtn(canvas, 'SPrev', '←',      lx + 160, y, bw, bh);
        const sN = makeBtn(canvas, 'SNext', '→',      lx + 260, y, bw, bh);

        y -= gap + 10;
        const start = makeBtn(canvas, 'StartBtn', '开始游戏', -110, y, 170, 56);
        const cont  = makeBtn(canvas, 'ContinueBtn', '继续游戏', 110, y, 170, 56);

        const self = canvas;
        const ui = canvas.addComponent(LobbyUI);
        const g = (n: string) => canvas.getChildByName(n);

        ui.mapSizeLabel   = g('MapSizeLabel')?.getComponent(Label) ?? null;
        ui.mapSizePrevBtn = g('MsPrev')?.getComponent(Button) ?? null;
        ui.mapSizeNextBtn = g('MsNext')?.getComponent(Button) ?? null;
        ui.aiCountLabel   = g('AiCountLabel')?.getComponent(Label) ?? null;
        ui.aiCountPrevBtn = g('AcPrev')?.getComponent(Button) ?? null;
        ui.aiCountNextBtn = g('AcNext')?.getComponent(Button) ?? null;
        ui.difficultyLabel     = g('DiffLabel')?.getComponent(Label) ?? null;
        ui.difficultyDescLabel = g('DiffDesc')?.getComponent(Label) ?? null;
        ui.difficultyPrevBtn   = g('DPrev')?.getComponent(Button) ?? null;
        ui.difficultyNextBtn   = g('DNext')?.getComponent(Button) ?? null;
        ui.fogLabel      = g('FogLabel')?.getComponent(Label) ?? null;
        ui.fogToggleBtn  = g('FogToggle')?.getComponent(Button) ?? null;
        ui.gameSpeedLabel     = g('SpeedLabel')?.getComponent(Label) ?? null;
        ui.gameSpeedPrevBtn   = g('SPrev')?.getComponent(Button) ?? null;
        ui.gameSpeedNextBtn   = g('SNext')?.getComponent(Button) ?? null;
        ui.startBtn    = g('StartBtn')?.getComponent(Button) ?? null;
        ui.continueBtn = g('ContinueBtn')?.getComponent(Button) ?? null;
        // 绑定按钮点击事件到 LobbyUI 的方法
        bindClick(msP.btn, self, 'LobbyUI', 'onMapSizePrev');
        bindClick(msN.btn, self, 'LobbyUI', 'onMapSizeNext');
        bindClick(acP.btn, self, 'LobbyUI', 'onAiCountPrev');
        bindClick(acN.btn, self, 'LobbyUI', 'onAiCountNext');
        bindClick(dP.btn,  self, 'LobbyUI', 'onDifficultyPrev');
        bindClick(dN.btn,  self, 'LobbyUI', 'onDifficultyNext');
        bindClick(fB.btn,  self, 'LobbyUI', 'onFogToggle');
        bindClick(sP.btn,  self, 'LobbyUI', 'onGameSpeedPrev');
        bindClick(sN.btn,  self, 'LobbyUI', 'onGameSpeedNext');
        bindClick(start.btn, self, 'LobbyUI', 'onStartClicked');
        bindClick(cont.btn,  self, 'LobbyUI', 'onContinueClicked');
    }

    // ======================== GAME ========================

    private buildGame(canvas: Node): void {
        // -- HUD --
        const hud = make(canvas, 'HUD', 0, 280, 900, 56);
        makeLabel(hud, 'H_Gold', '金币: 0', -380, 0, 160, 36, 20);
        makeLabel(hud, 'H_Time', '00:00', -220, 0, 100, 36, 20);
        makeLabel(hud, 'H_Speed', '1x', -120, 0, 70, 36, 20);
        const albl = makeLabel(hud, 'H_Alliance', '', 0, 0, 200, 36, 20);
        albl.node.active = false;
        const pause  = makeBtn(hud, 'H_Pause', '⏸', 0, 0, 70, 44);
        const spPrev = makeBtn(hud, 'H_Sprev', '←', 160, 0, 50, 44);
        const spNext = makeBtn(hud, 'H_Snext', '→', 200, 0, 50, 44);

        const hudC = hud.addComponent(HUDController);
        hudC.goldLabel     = hud.getChildByName('H_Gold')!.getComponent(Label);
        hudC.timeLabel     = hud.getChildByName('H_Time')!.getComponent(Label);
        hudC.speedLabel    = hud.getChildByName('H_Speed')!.getComponent(Label);
        hudC.allianceLabel = albl;
        hudC.pauseBtn      = pause.btn;
        hudC.pauseBtnLabel = pause.label;
        hudC.speedPrevBtn  = spPrev.btn;
        hudC.speedNextBtn  = spNext.btn;
        bindClick(pause.btn,  hud, 'HUDController', 'onPauseClicked');
        bindClick(spPrev.btn, hud, 'HUDController', 'onSpeedPrev');
        bindClick(spNext.btn, hud, 'HUDController', 'onSpeedNext');

        // -- NodePanel --
        const panel = make(canvas, 'NodePanel', 460, 0, 320, 640);
        this.buildNodePanel(panel);
        const np = panel.addComponent(NodePanel);
        this.wireNodePanel(np, panel);
        panel.active = false;

        // -- SaveSlotsUI --
        const svNode = make(canvas, 'SaveSlotsUI', 0, 0, 520, 440);
        this.buildSaveSlots(svNode);
        const sv = svNode.addComponent(SaveSlotsUI);
        this.wireSaveSlots(sv, svNode);
        svNode.active = false;

        // -- GameOverUI --
        const goNode = make(canvas, 'GameOverUI', 0, 0, 440, 300);
        makeLabel(goNode, 'GO_Title', '胜利！', 0, 80, 300, 50, 20);
        makeLabel(goNode, 'GO_Stats', '', 0, 20, 400, 32, 20);
        makeLabel(goNode, 'GO_Reward', '', 0, -20, 400, 32, 20);
        const reBtn = makeBtn(goNode, 'GO_Restart', '重新开始', -110, -80, 160, 50);
        const loBtn = makeBtn(goNode, 'GO_Lobby', '返回大厅', 110, -80, 160, 50);
        const go = goNode.addComponent(GameOverUI);
        go.titleLabel  = goNode.getChildByName('GO_Title')!.getComponent(Label);
        go.statsLabel  = goNode.getChildByName('GO_Stats')!.getComponent(Label);
        go.rewardLabel = goNode.getChildByName('GO_Reward')!.getComponent(Label);
        go.restartBtn  = reBtn.btn;
        go.lobbyBtn    = loBtn.btn;
        bindClick(reBtn.btn, goNode, 'GameOverUI', 'onRestartClicked');
        bindClick(loBtn.btn, goNode, 'GameOverUI', 'onLobbyClicked');
        goNode.active = false;

        // -- EdgePanel --
        const epNode = make(canvas, 'EdgePanel', 460, 0, 300, 280);
        makeLabel(epNode, 'EP_Title', '线路 #', 0, 90, 280, 36, 24);
        makeLabel(epNode, 'EP_Info', '', 0, 30, 280, 36, 24);
        const upgBtn = makeBtn(epNode, 'EP_Upgrade', '升级→2级(50金)', -0, -30, 180, 46);
        const BatchUpgBtn = makeBtn(epNode, 'EP_BatchUpgrade', '批量升级', -0, -90, 180, 46);
        const epClose = makeBtn(epNode, 'EP_Close', '关闭', 0, -130, 100, 44);
        const ep = epNode.addComponent(EdgePanel);
        ep.titleLabel      = epNode.getChildByName('EP_Title')!.getComponent(Label);
        ep.infoLabel       = epNode.getChildByName('EP_Info')!.getComponent(Label);
        ep.upgradeBtn      = upgBtn.btn;
        ep.upgradeBtnLabel = upgBtn.label;
        ep.batchUpgradeBtn = BatchUpgBtn.btn;
        ep.closeBtn        = epClose.btn;
        bindClick(upgBtn.btn, epNode, 'EdgePanel', 'onUpgradeClicked');
        bindClick(BatchUpgBtn.btn, epNode, 'EdgePanel', 'onBatchUpgradeClicked');
        bindClick(epClose.btn, epNode, 'EdgePanel', 'onCloseClicked');
        epNode.active = false;

        // -- ArmyPanel --
        const apNode = make(canvas, 'ArmyPanel', 460, 0, 300, 300);
        makeLabel(apNode, 'AP_Title', '军队 #', 0, 100, 280, 36, 24);
        makeLabel(apNode, 'AP_Info', '', 0, 50, 280, 36, 24);
        makeLabel(apNode, 'AP_Progress', '', 0, 10, 280, 36, 24);
        makeLabel(apNode, 'AP_Path', '', 0, -30, 280, 36, 24);
        const apClose = makeBtn(apNode, 'AP_Close', '关闭', 0, -90, 100, 44);
        const ap = apNode.addComponent(ArmyPanel);
        ap.titleLabel    = apNode.getChildByName('AP_Title')!.getComponent(Label);
        ap.infoLabel     = apNode.getChildByName('AP_Info')!.getComponent(Label);
        ap.progressLabel = apNode.getChildByName('AP_Progress')!.getComponent(Label);
        ap.pathLabel     = apNode.getChildByName('AP_Path')!.getComponent(Label);
        ap.closeBtn      = apClose.btn;
        bindClick(apClose.btn, apNode, 'ArmyPanel', 'onCloseClicked');
        apNode.active = false;

        // -- GameManager --
        const gm = canvas.addComponent(GameManager);
        gm.hud          = hudC;
        gm.saveSlotsUI  = sv;
        gm.gameOverUI   = go;
        gm.nodePanel    = np;
        gm.edgePanel    = ep;
        gm.armyPanel    = ap;
    }

    // --- NodePanel 子节点 ---
    private buildNodePanel(p: Node): void {
        const rowH = 36;
        let y = 330;
        makeLabel(p, 'N_Title', '节点 #', 0, y, 240, rowH, 24);                y -= rowH ;
        makeLabel(p, 'N_Info', '', 0, y, 240, rowH, 24);                       y -= rowH ;
        makeLabel(p, 'N_Garrison', '驻军：0', 0, y, 240, rowH, 24);            y -= rowH ;
        makeLabel(p, 'N_Build', '空闲', 0, y, 240, rowH, 24);                  y -= rowH ;
        makeLabel(p, 'N_Recruit', '征兵队列：空', 0, y, 240, rowH, 24);        y -= rowH + 8;
        makeBtn(p, 'N_Upgrade', '升级', 0, y, 180, rowH, 24);                      y -= rowH + 8;
        makeBtn(p, 'N_CvtFort', '转要塞', -45, y, 90, rowH, 24);                    
        makeBtn(p, 'N_CvtMarket', '转市场', 70, y, 90, rowH, 24);                  y -= rowH + 8;
        makeBtn(p, 'N_RecruitPrev', '-', -100, y, 60, rowH, 24);
        makeLabel(p, 'N_RecruitCnt', '0 兵', -50, y, 80, rowH, 24);
        makeBtn(p, 'N_RecruitNext', '+', 0, y, 60, rowH, 24);                     
        makeBtn(p, 'N_RecruitB', '征兵', 90, y, 100, rowH, 24);                      y -= rowH + 8;
        makeBtn(p, 'N_TroopPrev', '-', -100, y, 60, rowH, 24);
        makeLabel(p, 'N_TroopCnt', '0 兵', -50, y, 80, rowH, 24);
        makeBtn(p, 'N_TroopNext', '+', 0, y, 60, rowH, 24);                     
        makeBtn(p, 'N_Send', '派兵', 80, y, 100, rowH, 24);                         y -= rowH + 8;
        makeBtn(p, 'N_ARctPrev', '-', -100, y, 60, rowH, 24);
        makeLabel(p, 'N_ARctThresh', '0', 0, y, 80, rowH, 24);
        makeBtn(p, 'N_ARctNext', '+', 100, y, 60, rowH, 24);                       y -= rowH + 8;
        makeBtn(p, 'N_AutoRct', '自动征兵：关', 0, y, 180, rowH, 24);              y -= rowH + 8;
        makeBtn(p, 'N_BatchAll', '批量升级全部', 0, y, 180, rowH, 24);             y -= rowH + 8;
        makeBtn(p, 'N_BatchFort', '批量升级要塞', 0, y, 180, rowH, 24);            y -= rowH + 8;
        makeBtn(p, 'N_BatchMarket', '批量升级市场', 0, y, 180, rowH, 24);          y -= rowH + 8;
        makeBtn(p, 'N_BatchConvert', '批量转换节点', 0, y, 180, rowH, 24);          y -= rowH + 8;
        makeBtn(p, 'N_Close', '关闭', 0, y, 180, rowH, 24);
    }
    // ======================== NodePanel 绑定 ========================
    private wireNodePanel(np: NodePanel, p: Node): void {
        const g = (n: string) => p.getChildByName(n);
        np.titleLabel             = g('N_Title')?.getComponent(Label) ?? null;
        np.infoLabel              = g('N_Info')?.getComponent(Label) ?? null;
        np.garrisonLabel          = g('N_Garrison')?.getComponent(Label) ?? null;
        np.buildStatusLabel       = g('N_Build')?.getComponent(Label) ?? null;
        np.recruitStatusLabel     = g('N_Recruit')?.getComponent(Label) ?? null;
        np.upgradeBtn             = g('N_Upgrade')?.getComponent(Button) ?? null;
        np.upgradeBtnLabel        = g('N_Upgrade')?.getChildByName('N_Upgrade_Lbl')?.getComponent(Label) ?? null;
        np.convertToFortressBtn   = g('N_CvtFort')?.getComponent(Button) ?? null;
        np.convertToMarketBtn     = g('N_CvtMarket')?.getComponent(Button) ?? null;
        np.recruitPrevBtn         = g('N_RecruitPrev')?.getComponent(Button) ?? null;
        np.recruitCountLabel      = g('N_RecruitCnt')?.getComponent(Label) ?? null;
        np.recruitNextBtn         = g('N_RecruitNext')?.getComponent(Button) ?? null;
        np.recruitBtn             = g('N_RecruitB')?.getComponent(Button) ?? null;
        np.recruitBtnLabel        = g('N_RecruitB')?.getChildByName('N_RecruitB_Lbl')?.getComponent(Label) ?? null;
        np.troopPrevBtn           = g('N_TroopPrev')?.getComponent(Button) ?? null;
        np.troopCountLabel        = g('N_TroopCnt')?.getComponent(Label) ?? null;
        np.troopNextBtn           = g('N_TroopNext')?.getComponent(Button) ?? null;
        np.sendTroopsBtn          = g('N_Send')?.getComponent(Button) ?? null;
        np.closeBtn               = g('N_Close')?.getComponent(Button) ?? null;
        np.autoRecruitPrevBtn     = g('N_ARctPrev')?.getComponent(Button) ?? null;
        np.autoRecruitThresholdLabel = g('N_ARctThresh')?.getComponent(Label) ?? null;
        np.autoRecruitNextBtn     = g('N_ARctNext')?.getComponent(Button) ?? null;
        np.autoRecruitToggleBtn   = g('N_AutoRct')?.getComponent(Button) ?? null;
        np.autoRecruitToggleLabel = g('N_AutoRct')?.getChildByName('N_AutoRct_Lbl')?.getComponent(Label) ?? null;
        np.batchUpgradeAllBtn     = g('N_BatchAll')?.getComponent(Button) ?? null;
        np.batchUpgradeFortressBtn = g('N_BatchFort')?.getComponent(Button) ?? null;
        np.batchUpgradeMarketBtn  = g('N_BatchMarket')?.getComponent(Button) ?? null;
        np.batchConvertAllBtn  = g('N_BatchConvert')?.getComponent(Button) ?? null;

        bindClick(np.upgradeBtn!, p, 'NodePanel', 'onUpgradeClicked');
        bindClick(np.convertToFortressBtn!, p, 'NodePanel', 'onConvertToFortressClicked');
        bindClick(np.convertToMarketBtn!, p, 'NodePanel', 'onConvertToMarketClicked');
        bindClick(np.recruitPrevBtn!, p, 'NodePanel', 'onRecruitPrevClicked');
        bindClick(np.recruitNextBtn!, p, 'NodePanel', 'onRecruitNextClicked');
        bindClick(np.recruitBtn!, p, 'NodePanel', 'onRecruitBtnClicked');
        bindClick(np.troopPrevBtn!, p, 'NodePanel', 'onTroopPrevClicked');
        bindClick(np.troopNextBtn!, p, 'NodePanel', 'onTroopNextClicked');
        bindClick(np.sendTroopsBtn!, p, 'NodePanel', 'onSendTroopsClicked');
        bindClick(np.closeBtn!, p, 'NodePanel', 'onCloseClicked');
        bindClick(np.autoRecruitPrevBtn!, p, 'NodePanel', 'onAutoRecruitPrevClicked');
        bindClick(np.autoRecruitNextBtn!, p, 'NodePanel', 'onAutoRecruitNextClicked');
        bindClick(np.autoRecruitToggleBtn!, p, 'NodePanel', 'onAutoRecruitToggleClicked');
        bindClick(np.batchUpgradeAllBtn!, p, 'NodePanel', 'onBatchUpgradeAllClicked');
        bindClick(np.batchUpgradeFortressBtn!, p, 'NodePanel', 'onBatchUpgradeFortressClicked');
        bindClick(np.batchUpgradeMarketBtn!, p, 'NodePanel', 'onBatchUpgradeMarketClicked');
        bindClick(np.batchConvertAllBtn!, p, 'NodePanel', 'onBatchConvertAllClicked');
    }

    // --- SaveSlotsUI 子节点 ---
    private buildSaveSlots(p: Node): void {
        let y = 140;
        for (let i = 0; i < 3; i++) {
            makeLabel(p, `SV_S${i}`, `槽位 ${i + 1} — 空`, -200, y, 300, 30, 18);
            makeBtn(p, `SV_B${i}`, '读取', 120, y, 90, 38);
            makeBtn(p, `SV_D${i}`, '删除', 215, y, 90, 38);
            y -= 65;
        }
        makeBtn(p, 'SV_Close', '关闭', 0, y - 10, 110, 46);
    }

    private wireSaveSlots(sv: SaveSlotsUI, p: Node): void {
        sv.slotLabels = [];
        sv.slotButtons = [];
        sv.deleteButtons = [];
        for (let i = 0; i < 3; i++) {
            sv.slotLabels[i]   = p.getChildByName(`SV_S${i}`)?.getComponent(Label) ?? null;
            sv.slotButtons[i]  = p.getChildByName(`SV_B${i}`)?.getComponent(Button) ?? null;
            sv.deleteButtons[i] = p.getChildByName(`SV_D${i}`)?.getComponent(Button) ?? null;
            if (sv.slotButtons[i])  bindClick(sv.slotButtons[i]!,  p, 'SaveSlotsUI', 'onSlotClicked');
            if (sv.deleteButtons[i]) bindClick(sv.deleteButtons[i]!, p, 'SaveSlotsUI', 'onDeleteClicked');
        }
        sv.closeBtn = p.getChildByName('SV_Close')?.getComponent(Button) ?? null;
        if (sv.closeBtn) bindClick(sv.closeBtn, p, 'SaveSlotsUI', 'onCloseClicked');
    }
}
