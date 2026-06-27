import { director } from 'cc';
import { NodeEntity } from '../entity/NodeEntity';
import { EdgeEntity } from '../entity/EdgeEntity';
import { ArmyEntity } from '../entity/ArmyEntity';
import { GameSpeed, OwnerType, NodeBattleOutcome, NodeType } from '../config/EnumDefine';
import { ArmyManager } from './ArmyManager';
import { PathfindingManager } from './PathfindingManager';
import { MapViewManager } from './MapViewManager';
import { NodeUpgradeSystem } from './NodeUpgradeSystem';
import { NodeConvertSystem } from './NodeConvertSystem';
import { EdgeUpgradeSystem } from './EdgeUpgradeSystem';
import { RecruitSystem } from '../recruit/RecruitSystem';
import { NodeBattleResult } from '../battle/NodeBattleSystem';
import { FogSystem } from '../fog/FogSystem';
import { EventBus } from '../common/EventBus';
import { GameEvents } from '../common/GameEvents';
import { HUDController } from '../ui/HUDController';
import { SaveSlotsUI } from '../ui/SaveSlotsUI';
import { NodePanel } from '../ui/NodePanel';
import { EdgePanel } from '../ui/EdgePanel';
import { ArmyPanel } from '../ui/ArmyPanel';

/**
 * GameEventBinder 传入的上下文接口
 *
 * 包含所有 EventBus 处理器需要访问的游戏状态、UI 引用和回调方法。
 * 由 GameManager.wireUI() 在调用 bindAll() 时构造。
 */
export interface GameEventContext {
    /** 地图节点实体列表 */
    nodes: NodeEntity[];

    /** 地图边实体列表 */
    edges: EdgeEntity[];

    /** 地图视图管理器（用于刷新节点视图） */
    mapView: MapViewManager;

    /** 节点信息面板 */
    nodePanel: NodePanel | null;

    /** 边信息面板 */
    edgePanel: EdgePanel | null;

    /** 军队信息面板 */
    armyPanel: ArmyPanel | null;

    /** 存档面板 */
    saveSlotsUI: SaveSlotsUI | null;

    /** HUD 控制器 */
    hud: HUDController | null;

    /** 加载存档回调，参数：槽位ID */
    loadGame: (slotId: number) => void;

    /** 暂停/继续切换回调 */
    togglePause: () => void;

    /** 调速回调，参数：游戏速度 */
    setGameSpeed: (speed: GameSpeed) => void;

    /**
     * 军队到达节点处理回调
     * @param army   到达的军队
     * @param nodeId 到达的节点ID
     */
    handleArmyArrival: (army: ArmyEntity, nodeId: number) => void;

    /**
     * 军队线路上遭遇处理回调
     * @param armyA 遭遇军队A
     * @param armyB 遭遇军队B
     */
    handleEdgeEncounter: (armyA: ArmyEntity, armyB: ArmyEntity) => void;

    /** 从 ArmyManager 同步军队数组到 GameManager 的 _armies */
    syncArmies: () => void;

    /** 设置待派兵的源头信息，参数：{ nodeId, count } 或 null 取消 */
    setPendingSendTroops: (v: { nodeId: number; count: number } | null) => void;
}

/**
 * 游戏事件绑定器，负责统一注册所有 EventBus 监听
 *
 * 职责：
 *   - 在游戏开始时注册所有 UI / 游戏逻辑事件监听
 *   - 通过上下文接口解耦对 GameManager 私有状态的直接访问
 *
 * 注意：这是一个纯静态工具类，不持有任何状态。
 *       每次新游戏/读档时调用 bindAll(ctx) 重新绑定（内部先 removeAll 清除旧监听）。
 */
export class GameEventBinder {

    /**
     * 绑定全部 EventBus 事件到上下文提供的方法
     *
     * 先调用 EventBus.removeAll() 清除旧的监听，再逐一注册新监听。
     *
     * @param ctx  游戏事件上下文，包含所有监听器需要的状态和回调
     * @returns 无
     */
    static bindAll(ctx: GameEventContext): void {
        EventBus.removeAll();

        // ==================== 节点相关事件 ====================

        EventBus.on(GameEvents.NODE_UPGRADE, (nodeId: number) => {
            NodeUpgradeSystem.startUpgrade(ctx.nodes[nodeId], OwnerType.PLAYER);
            ctx.mapView.refreshNodeViews(ctx.nodes);
            if (ctx.nodePanel) ctx.nodePanel.refreshPanel();
        });

        EventBus.on(GameEvents.NODE_CONVERT_FORTRESS, (nodeId: number) => {
            NodeConvertSystem.startConvert(ctx.nodes[nodeId], NodeType.FORTRESS, OwnerType.PLAYER);
            ctx.mapView.refreshNodeViews(ctx.nodes);
            if (ctx.nodePanel) ctx.nodePanel.refreshPanel();
        });

        EventBus.on(GameEvents.NODE_CONVERT_MARKET, (nodeId: number) => {
            NodeConvertSystem.startConvert(ctx.nodes[nodeId], NodeType.MARKET, OwnerType.PLAYER);
            ctx.mapView.refreshNodeViews(ctx.nodes);
            if (ctx.nodePanel) ctx.nodePanel.refreshPanel();
        });

        EventBus.on(GameEvents.NODE_RECRUIT, (nodeId: number, count: number) => {
            RecruitSystem.startRecruit(ctx.nodes[nodeId], OwnerType.PLAYER, count);
            ctx.mapView.refreshNodeViews(ctx.nodes);
            if (ctx.nodePanel) ctx.nodePanel.refreshPanel();
        });

        EventBus.on(GameEvents.NODE_SEND_TROOPS, (nodeId: number, count: number) => {
            const srcNode = ctx.nodes[nodeId];
            if (count <= 0 || count > srcNode.garrisonCount) return;
            ctx.setPendingSendTroops({ nodeId, count });
            if (ctx.nodePanel) ctx.nodePanel.node.active = false;
        });

        EventBus.on(GameEvents.NODE_BATCH_UPGRADE_ALL, () => {
            NodeUpgradeSystem.batchUpgrade(ctx.nodes, 'all', OwnerType.PLAYER, PathfindingManager.adjList);
            ctx.mapView.refreshNodeViews(ctx.nodes);
            if (ctx.nodePanel) ctx.nodePanel.refreshPanel();
        });

        EventBus.on(GameEvents.NODE_BATCH_UPGRADE_FORTRESS, () => {
            NodeUpgradeSystem.batchUpgrade(ctx.nodes, 'fortress', OwnerType.PLAYER, PathfindingManager.adjList);
            ctx.mapView.refreshNodeViews(ctx.nodes);
            if (ctx.nodePanel) ctx.nodePanel.refreshPanel();
        });

        EventBus.on(GameEvents.NODE_BATCH_UPGRADE_MARKET, () => {
            NodeUpgradeSystem.batchUpgrade(ctx.nodes, 'market', OwnerType.PLAYER, PathfindingManager.adjList);
            ctx.mapView.refreshNodeViews(ctx.nodes);
            if (ctx.nodePanel) ctx.nodePanel.refreshPanel();
        });

        EventBus.on(GameEvents.NODE_BATCH_CONVERT_ALL, () => {
            NodeConvertSystem.autoConvertBuildings( OwnerType.PLAYER, ctx.nodes);
            ctx.mapView.refreshNodeViews(ctx.nodes);
            if (ctx.nodePanel) ctx.nodePanel.refreshPanel();
        });

        EventBus.on(GameEvents.PANEL_CLOSE_NODE, () => {
            if (ctx.nodePanel) ctx.nodePanel.node.active = false;
        });

        // ==================== 边相关事件 ====================

        EventBus.on(GameEvents.EDGE_UPGRADE, (edgeId: number) => {
            const edge = ctx.edges.find(e => e.id === edgeId);
            if (!edge) return;
            EdgeUpgradeSystem.upgradeEdge(edge, ctx.nodes, OwnerType.PLAYER);
            if (ctx.edgePanel) ctx.edgePanel.refresh();
            ctx.mapView.refreshNodeViews(ctx.nodes);
        });

        EventBus.on(GameEvents.PANEL_CLOSE_EDGE, () => {
            if (ctx.edgePanel) ctx.edgePanel.node.active = false;
        });

        // ==================== 军队相关事件 ====================

        EventBus.on(GameEvents.PANEL_CLOSE_ARMY, () => {
            if (ctx.armyPanel) ctx.armyPanel.node.active = false;
        });

        EventBus.on(GameEvents.ARMY_ARRIVED_AT_NODE, (army: ArmyEntity, nodeId: number) => {
            ctx.handleArmyArrival(army, nodeId);
            ctx.syncArmies();
        });

        EventBus.on(GameEvents.ARMY_EDGE_ENCOUNTER, (armyA: ArmyEntity, armyB: ArmyEntity) => {
            ctx.handleEdgeEncounter(armyA, armyB);
            ctx.syncArmies();
        });

        // ==================== 战斗结果事件 ====================

        EventBus.on(GameEvents.BATTLE_NODE_RESULT, (result: NodeBattleResult) => {
            if (result.outcome === NodeBattleOutcome.ATTACKER_WINS || result.outcome === NodeBattleOutcome.DEFENDER_WINS) {
                FogSystem.recordAttack(result.node, result.attackerArmy.ownerId);
            }
        });

        // ==================== 随机事件 ====================

        EventBus.on(GameEvents.RANDOM_HARVEST, (totalGold: number) => {
            console.log(`[GameManager] 丰收! 金币 +${totalGold}`);
        });

        EventBus.on(GameEvents.RANDOM_WAR_MOBILIZATION, (duration: number) => {
            console.log(`[GameManager] 战争动员! 所有方征兵时间减半 ${duration.toFixed(1)}s`);
        });

        // ==================== 游戏控制事件 ====================

        EventBus.on(GameEvents.GAME_RESTART, () => director.loadScene('LobbyScene'));
        EventBus.on(GameEvents.GAME_LOBBY,   () => director.loadScene('LobbyScene'));

        EventBus.on(GameEvents.SAVE_LOAD_SLOT, (slotId: number) => ctx.loadGame(slotId));
        EventBus.on(GameEvents.SAVE_SLOTS_CLOSE, () => {
            if (ctx.saveSlotsUI) ctx.saveSlotsUI.node.active = false;
        });

        EventBus.on(GameEvents.GAME_PAUSE_TOGGLE, () => ctx.togglePause());
        EventBus.on(GameEvents.GAME_SPEED_CHANGED, (s: GameSpeed) => {
            ctx.setGameSpeed(s);
            if (ctx.hud) ctx.hud.bindSpeed(s);
        });
    }
}