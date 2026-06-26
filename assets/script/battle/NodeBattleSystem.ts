import { NodeEntity } from '../entity/NodeEntity';
import { ArmyEntity } from '../entity/ArmyEntity';
import { SpecialNodeType, ArmyState, NodeBattleOutcome } from '../config/EnumDefine';
import { BattleConfig } from '../config/BattleConfig';
import { NodeConfig } from '../config/NodeConfig';
import { EventBus } from '../common/EventBus';
import { GameEvents } from '../common/GameEvents';

// 节点攻占结果数据
export class NodeBattleResult {
    outcome: NodeBattleOutcome;         // 战斗结果
    node: NodeEntity;                   // 目标节点
    attackerArmy: ArmyEntity;            // 攻击方军队
    effectiveDefense: number;           // 防守方等效防御力 = 驻军 × (建筑倍率 + 高地加成)
    remainingGarrison: number;           // 战斗后节点驻军

    constructor(outcome: NodeBattleOutcome, node: NodeEntity, attackerArmy: ArmyEntity, effectiveDefense: number, remainingGarrison: number) {
        this.outcome = outcome;
        this.node = node;
        this.attackerArmy = attackerArmy;
        this.effectiveDefense = effectiveDefense;
        this.remainingGarrison = remainingGarrison;
    }
}

// 节点攻占系统，处理军队到达目标节点后的攻占/防守结算，纯逻辑层
export class NodeBattleSystem {

    // 计算节点的等效防御力 = 驻军 × (节点类型防御倍率 + 高地防御加成)
    static getEffectiveDefense(node: NodeEntity): number {
        let multiplier = BattleConfig.DEFENSE_MULTIPLIER[node.type] || 1.0;

        // 叠加特殊节点高地效果
        if (node.specialType === SpecialNodeType.HIGHLAND) {
            const highlandBonus = NodeConfig.SPECIAL_DEFENSE_BONUS[SpecialNodeType.HIGHLAND] || 0;
            multiplier += highlandBonus;
        }

        return Math.max(0, node.garrisonCount * multiplier);
    }

    // 计算击败防御方所需的最低兵力（整数，向上取整）
    static getRequiredAttackers(node: NodeEntity): number {
        const effectiveDefense = NodeBattleSystem.getEffectiveDefense(node);
        return Math.floor(effectiveDefense) + 1;
    }

    // 处理军队到达节点时的战斗/合并结算
    static resolve(attackerArmy: ArmyEntity, targetNode: NodeEntity): NodeBattleResult {
        // 同方到达，合并驻军
        if (attackerArmy.ownerId === targetNode.ownerId) {
            const prevGarrison = targetNode.garrisonCount;
            targetNode.garrisonCount += attackerArmy.soldierCount;
            console.log(`[NodeBattle] 同方合并: 军队#${attackerArmy.id}(${attackerArmy.ownerId}) ${attackerArmy.soldierCount}人 → 节点#${targetNode.id}(${targetNode.ownerId}) 驻军 ${prevGarrison}→${targetNode.garrisonCount}`);
            attackerArmy.soldierCount = 0;
            attackerArmy.state = ArmyState.STATIONED;
            const result = new NodeBattleResult(
                NodeBattleOutcome.SAME_OWNER,
                targetNode,
                attackerArmy,
                0,
                targetNode.garrisonCount,
            );
            EventBus.emit(GameEvents.BATTLE_NODE_RESULT, result);
            return result;
        }

        const effectiveDefense = NodeBattleSystem.getEffectiveDefense(targetNode);

        // 攻击方兵力 > 等效防御力 时攻占成功
        if (attackerArmy.soldierCount > effectiveDefense) {
            // 攻占成功
            const remaining = attackerArmy.soldierCount - targetNode.garrisonCount;
            targetNode.ownerId = attackerArmy.ownerId;
            targetNode.garrisonCount = remaining;
            // 取消进行中的升级、转换、征兵
            NodeBattleSystem.cancelTasks(targetNode);
            // 标记攻击军队已结算
            attackerArmy.soldierCount = 0;
            attackerArmy.state = ArmyState.STATIONED;
            const result = new NodeBattleResult(
                NodeBattleOutcome.ATTACKER_WINS,
                targetNode,
                attackerArmy,
                effectiveDefense,
                remaining,
            );
            EventBus.emit(GameEvents.BATTLE_NODE_RESULT, result);
            return result;
        } else {
            // 防守成功：攻击方全灭
            const attackerLoss = attackerArmy.soldierCount;
            // 防守方损失 = 攻击方人数 / 防御倍率（至少造成与攻击方同等损失）
            const defenderLoss = Math.ceil(attackerLoss / (BattleConfig.DEFENSE_MULTIPLIER[targetNode.type] || 1.0));
            targetNode.garrisonCount = Math.max(0, targetNode.garrisonCount - defenderLoss);
            attackerArmy.soldierCount = 0;
            attackerArmy.state = ArmyState.STATIONED;
            const result = new NodeBattleResult(
                NodeBattleOutcome.DEFENDER_WINS,
                targetNode,
                attackerArmy,
                effectiveDefense,
                targetNode.garrisonCount,
            );
            EventBus.emit(GameEvents.BATTLE_NODE_RESULT, result);
            return result;
        }
    }

    // 取消节点上所有进行中的任务（升级/转换/征兵），资源不返还
    private static cancelTasks(node: NodeEntity): void {
        node.upgradeTask = null;
        node.convertTask = null;
        node.recruitQueue = [];
    }
}
