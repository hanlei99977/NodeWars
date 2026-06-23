import { NodeType } from './EnumDefine';

export class BattleConfig {
    // 攻击力和防御力的基础值
    static readonly DEFENSE_MULTIPLIER: Record<NodeType, number> = {
        [NodeType.NORMAL]: 1.0,
        [NodeType.FORTRESS]: 1.5,// 要塞防御加成
        [NodeType.MARKET]: 1.0,
    };
}
