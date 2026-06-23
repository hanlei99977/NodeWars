import { NodeLevel, NodeType, SpecialNodeType } from './EnumDefine';

export class NodeConfig {
    // 节点等级对应的金币产出
    static readonly GOLD_PER_SECOND: Record<NodeLevel, number> = {
        [NodeLevel.LV1]: 1,
        [NodeLevel.LV2]: 3,
        [NodeLevel.LV3]: 5,
    };
    // 节点类型的金币加成
    static readonly TYPE_INCOME_MULTIPLIER: Record<NodeType, number> = {
        [NodeType.NORMAL]: 1.0,
        [NodeType.FORTRESS]: 1.0,
        [NodeType.MARKET]: 1.5,
    };
    // 节点类型的防御加成
    static readonly TYPE_DEFENSE_MULTIPLIER: Record<NodeType, number> = {
        [NodeType.NORMAL]: 1.0,
        [NodeType.FORTRESS]: 1.5,
        [NodeType.MARKET]: 1.0,
    };
    // 特殊节点的收入加成
    static readonly SPECIAL_INCOME_BONUS: Partial<Record<SpecialNodeType, number>> = {
        [SpecialNodeType.GOLD_MINE]: 0.3,
    };
    // 特殊节点征兵时间加成
    static readonly SPECIAL_RECRUIT_TIME_REDUCTION: Partial<Record<SpecialNodeType, number>> = {
        [SpecialNodeType.BARRACKS]: 0.3,
    };
    // 特殊节点的防御加成
    static readonly SPECIAL_DEFENSE_BONUS: Partial<Record<SpecialNodeType, number>> = {
        [SpecialNodeType.HIGHLAND]: 0.2,
    };
    // 节点升级所需资金
    static readonly UPGRADE_GOLD: Record<number, number> = {
        1: 50,
        2: 100,
    };
    // 节点升级所需时间
    static readonly UPGRADE_TIME: Record<number, number> = {
        1: 30,
        2: 60,
    };
    // 节点转换所需的金币和时间
    static readonly CONVERT_GOLD = 100;

    static readonly CONVERT_TIME = 30;
    // 中立节点的初始兵力
    static readonly NEUTRAL_GARRISON: Record<NodeLevel, number> = {
        [NodeLevel.LV1]: 50,
        [NodeLevel.LV2]: 150,
        [NodeLevel.LV3]: 300,
    };
}
