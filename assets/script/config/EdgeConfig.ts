import { EdgeLevel } from './EnumDefine';

export class EdgeConfig {
    static readonly BASE_SPEED = 5;// 边的基础速度

    static readonly SPEED_BONUS: Record<EdgeLevel, number> = {
        [EdgeLevel.LV1]: 1.0,// LV1速度加成
        [EdgeLevel.LV2]: 1.3,// LV2速度加成
        [EdgeLevel.LV3]: 1.5,// LV3速度加成
    };
    // 边升级消耗金币
    static readonly UPGRADE_GOLD: Record<number, number> = {
        1: 50,
        2: 100,
    };
}
