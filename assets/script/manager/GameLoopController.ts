import { NodeEntity } from '../entity/NodeEntity';
import { EdgeEntity } from '../entity/EdgeEntity';
import { ArmyEntity } from '../entity/ArmyEntity';
import { GameState } from '../config/EnumDefine';
import { ArmyManager } from './ArmyManager';
import { EconomySystem } from '../economy/EconomySystem';
import { RecruitSystem } from '../recruit/RecruitSystem';
import { NodeUpgradeSystem } from './NodeUpgradeSystem';
import { NodeConvertSystem } from './NodeConvertSystem';
import { FogSystem } from '../fog/FogSystem';
import { EventSystem } from '../event/EventSystem';
import { AIController } from '../ai/AIController';
import { GameStateManager } from './GameStateManager';
import { MapViewManager } from './MapViewManager';
import { PlayerCommandManager } from './PlayerCommandManager';
import { HUDController } from '../ui/HUDController';

/**
 * 游戏主循环控制器，负责每帧按序驱动所有子系统
 *
 * 职责：
 *   - 每帧调度所有子系统的 update 调用
 *   - 按固定顺序执行（行军 → 经济 → 任务 → 迷雾 → 事件 → AI → 玩家 → 胜负 → HUD → 视图 → 保存 → 面板）
 *
 * 注意：这是一个纯静态工具类，不持有任何状态。
 *       由 GameManager.update() 在状态为 PLAYING 时调用。
 */
export class GameLoopController {

    /**
     * 每帧主循环调度
     *
     * 按以下顺序驱动所有子系统：
     *   1. 时间推进
     *   2. 行军推进
     *   3. 经济更新
     *   4. 任务推进（征兵 / 节点升级 / 节点转换）
     *   5. 迷雾更新
     *   6. 随机事件
     *   7. AI 决策
     *   8. 玩家自动征兵
     *   9. 玩家自动派遣
     *  10. 胜败判定
     *  11. HUD 刷新
     *  12. 地图视图刷新
     *  13. 军队视图刷新
     *  14. 自动保存
     *  15. 活跃面板刷新
     *
     * @param dt          原始帧时间增量（秒）
     * @param nodes       地图节点实体列表
     * @param edges       地图边实体列表
     * @param armies      军队实体列表（可被内部修改，调用者需同步）
     * @param aiIds       AI 势力ID列表
     * @param stateMgr    游戏状态管理器
     * @param mapView     地图视图管理器
     * @param playerCmd   玩家命令管理器
     * @param hud         HUD 控制器
     * @returns 无
     */
    static update(
        dt: number,
        nodes: NodeEntity[],
        edges: EdgeEntity[],
        armies: ArmyEntity[],
        aiIds: string[],
        stateMgr: GameStateManager,
        mapView: MapViewManager,
        playerCmd: PlayerCommandManager,
        hud: HUDController | null,
    ): void {
        const logicDt = dt * stateMgr.gameSpeed;
        stateMgr.advanceTime(logicDt);

        // --- 1. 行军推进（事件通过 EventBus 发送） ---
        ArmyManager.update(logicDt);
        // 调用者需要同步：armies = ArmyManager.armies（在 GameManager 中做）

        // --- 2. 经济更新（事件通过 EventBus 发送） ---
        EconomySystem.update(logicDt, nodes, ArmyManager.armies);

        // --- 3. 任务推进（征兵 / 节点升级 / 节点转换） ---
        RecruitSystem.update(logicDt, nodes);
        NodeUpgradeSystem.update(logicDt, nodes);
        NodeConvertSystem.update(logicDt, nodes);

        // --- 4. 迷雾更新 ---
        FogSystem.update(logicDt, nodes);

        // --- 5. 随机事件（事件通过 EventBus 发送） ---
        EventSystem.updateNodes(nodes);
        EventSystem.update(logicDt, EconomySystem.allOwnerIds);

        // --- 6. AI 决策 ---
        void AIController.update(logicDt, nodes, edges, ArmyManager.armies);

        // --- 7. 玩家自动征兵 ---
        playerCmd.processAutoRecruit();

        // --- 8. 玩家自动派遣 ---
        playerCmd.processAutoDispatch();

        // --- 9. 胜败判定 ---
        stateMgr.checkWinLose(nodes, aiIds);

        // --- 10. 驱动 HUD ---
        if (hud) {
            hud.bindSpeed(stateMgr.gameSpeed);
            hud.refresh(stateMgr.totalTime, stateMgr.gameState, stateMgr.allianceState);
        }

        // --- 11. 刷新地图视图 ---
        mapView.refreshNodeViews(nodes);

        // --- 12. 刷新军队视图 ---
        mapView.refreshArmyViews(ArmyManager.armies);

        // --- 13. 自动保存 ---
        stateMgr.autoSave(nodes, edges, ArmyManager.armies);

        // --- 14. 实时刷新活跃面板 ---
        playerCmd.refreshActivePanels();
    }
}