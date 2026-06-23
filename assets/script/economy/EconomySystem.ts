import { NodeEntity } from '../entity/NodeEntity';
import { ArmyEntity } from '../entity/ArmyEntity';
import { OwnerType, SpecialNodeType } from '../config/EnumDefine';
import { NodeConfig } from '../config/NodeConfig';
import { RecruitConfig } from '../config/RecruitConfig';

// 经济事件类型
export enum EconomyEventType {
    GOLD_ZERO_WARNING = 'gold_zero_warning',   // 金币降为0，弹窗提醒
    DISBAND_SOLDIERS = 'disband_soldiers',     // 金币不足，即时解散士兵
}

// 经济事件数据
export class EconomyEvent {
    type: EconomyEventType;
    ownerId: OwnerType;                         // 触发事件的所有方
    disbandCount?: number;                      // 本次解散的士兵人数

    constructor(type: EconomyEventType, ownerId: OwnerType, disbandCount?: number) {
        this.type = type;
        this.ownerId = ownerId;
        this.disbandCount = disbandCount;
    }
}

// 经济系统，负责金币增长、军费消耗、破产警告与即时裁军，纯逻辑层
export class EconomySystem {

    private static _goldMap: Map<string, number> = new Map();           // ownerId → 金币余额
    private static _warnedOwners: Set<string> = new Set();              // 当前处于破产警告的owner

    // 初始化：设置各方的初始金币
    static init(playerGold: number, aiGold: Record<string, number>): void {
        EconomySystem._goldMap.clear();
        EconomySystem._warnedOwners.clear();
        EconomySystem._goldMap.set(OwnerType.PLAYER, playerGold);
        const aiIds = Object.keys(aiGold);
        for (const aiId of aiIds) {
            EconomySystem._goldMap.set(aiId, aiGold[aiId]);
        }
    }

    // 获取某方当前金币余额
    static getGold(ownerId: string): number {
        return EconomySystem._goldMap.get(ownerId) ?? 0;
    }

    // 扣减金币，返回值表示是否扣减成功（余额不足返回false）
    static spend(ownerId: string, amount: number): boolean {
        const current = EconomySystem.getGold(ownerId);
        if (current < amount) return false;
        EconomySystem._goldMap.set(ownerId, current - amount);
        return true;
    }

    // 增加金币
    static addGold(ownerId: string, amount: number): void {
        const current = EconomySystem.getGold(ownerId);
        EconomySystem._goldMap.set(ownerId, current + amount);
    }

    // 判断某方是否可支付指定金额
    static canAfford(ownerId: string, amount: number): boolean {
        return EconomySystem.getGold(ownerId) >= amount;
    }

    // 计算单个节点的每秒金币产出
    // 产出 = 等级基础值 × 建筑类型倍率 × (1 + 金矿加成)
    static getNodeIncome(node: NodeEntity): number {
        const base = NodeConfig.GOLD_PER_SECOND[node.level] || 0;
        const typeMultiplier = NodeConfig.TYPE_INCOME_MULTIPLIER[node.type] || 1.0;
        const goldMineBonus = node.specialType === SpecialNodeType.GOLD_MINE
            ? (NodeConfig.SPECIAL_INCOME_BONUS[SpecialNodeType.GOLD_MINE] || 0)
            : 0;
        return base * typeMultiplier * (1 + goldMineBonus);
    }

    // 计算某方所有节点的总金币产出（每秒）
    static getTotalIncome(ownerId: string, nodes: NodeEntity[]): number {
        let total = 0;
        for (const node of nodes) {
            if (node.ownerId === ownerId) {
                total += EconomySystem.getNodeIncome(node);
            }
        }
        return total;
    }

    // 计算某方的总军费消耗（每秒）= (所有驻军 + 所有行军中的部队人数) × 军费率
    static getTotalMilitaryCost(ownerId: string, nodes: NodeEntity[], armies: ArmyEntity[]): number {
        let totalSoldiers = 0;
        // 节点驻军
        for (const node of nodes) {
            if (node.ownerId === ownerId) {
                totalSoldiers += node.garrisonCount;
            }
        }
        // 行军中的部队
        for (const army of armies) {
            if (army.ownerId === ownerId) {
                totalSoldiers += army.soldierCount;
            }
        }
        return totalSoldiers * RecruitConfig.MILITARY_GOLD_COST_RATE;
    }

    // 计算某方每秒净金币变化（收入 - 军费）
    static getNetGoldPerSecond(ownerId: string, nodes: NodeEntity[], armies: ArmyEntity[]): number {
        const income = EconomySystem.getTotalIncome(ownerId, nodes);
        const cost = EconomySystem.getTotalMilitaryCost(ownerId, nodes, armies);
        return income - cost;
    }

    // 每帧经济更新，传入逻辑时间增量 dt 秒
    // 金币不允许为负：当净支出超过现有金币时，差额部分即时解散等量士兵（1士兵=1金币）
    static update(dt: number, nodes: NodeEntity[], armies: ArmyEntity[]): EconomyEvent[] {
        const events: EconomyEvent[] = [];

        for (const [ownerId, gold] of EconomySystem._goldMap.entries()) {
            if (ownerId === OwnerType.NEUTRAL) continue;

            const income = EconomySystem.getTotalIncome(ownerId, nodes);
            const cost = EconomySystem.getTotalMilitaryCost(ownerId, nodes, armies);
            const netGold = income - cost;
            const newGold = gold + netGold * dt;

            if (newGold >= 0) {
                EconomySystem._goldMap.set(ownerId, Math.max(0, newGold));
                // 经济恢复正常，清除破产警告标记
                if (EconomySystem._warnedOwners.has(ownerId)) {
                    EconomySystem._warnedOwners.delete(ownerId);
                }
            } else {
                // 金币不足以支付军费：差额部分即时解散等量士兵
                EconomySystem._goldMap.set(ownerId, 0);
                const deficit = Math.ceil(-newGold); // 差额金币
                const disbanded = EconomySystem.disbandSoldiers(ownerId, nodes, deficit);

                // 仅玩家触发警告
                if (!EconomySystem._warnedOwners.has(ownerId)) {
                    EconomySystem._warnedOwners.add(ownerId);
                    events.push(new EconomyEvent(EconomyEventType.GOLD_ZERO_WARNING, ownerId as OwnerType));
                }
                events.push(new EconomyEvent(EconomyEventType.DISBAND_SOLDIERS, ownerId as OwnerType, disbanded));
            }
        }

        return events;
    }

    // 获取所有参与经济的owner列表
    static get allOwnerIds(): string[] {
        return [...EconomySystem._goldMap.keys()];
    }

    // 即时解散指定数量的士兵，按各节点驻军占比分摊裁员
    // 返回实际解散的士兵人数（可能少于requestCount，因为兵力不足）
    private static disbandSoldiers(ownerId: string, nodes: NodeEntity[], requestCount: number): number {
        const ownNodes = nodes.filter(n => n.ownerId === ownerId);
        if (ownNodes.length === 0) return 0;

        const currentTotal = ownNodes.reduce((sum, n) => sum + n.garrisonCount, 0);
        if (currentTotal <= 0) return 0;

        const cutTotal = Math.min(requestCount, currentTotal);

        // 第一轮：按比例 floor 分配裁减量
        let allocated = 0;
        for (const node of ownNodes) {
            const cut = Math.floor(cutTotal * node.garrisonCount / currentTotal);
            node.garrisonCount -= cut;
            allocated += cut;
        }

        // 第二轮：尾数缺口逐节点补裁1
        let remainder = cutTotal - allocated;
        const sortedByGarrison = [...ownNodes].sort((a, b) => b.garrisonCount - a.garrisonCount);
        for (const node of sortedByGarrison) {
            if (remainder <= 0) break;
            if (node.garrisonCount > 0) {
                node.garrisonCount -= 1;
                remainder -= 1;
            }
        }
        return cutTotal;
    }
}
