export class AIConfig {
    static readonly ALLIANCE_THRESHOLD = 0.4;// 联盟阈值，超过这个值就会考虑结盟

    static readonly JOINT_ATTACK_THRESHOLD = 0.5;// 联合攻击阈值，超过这个值就会考虑联合攻击

    static readonly DISBAND_THRESHOLD = 1 / 3;// 解散联盟阈值，超过这个值就会考虑解散联盟
}
