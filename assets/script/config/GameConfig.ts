import { MapSize, Difficulty } from './EnumDefine';

export class GameConfig {
    // 节点个数
    static readonly MAP_NODE_COUNTS: Record<MapSize, number> = {
        [MapSize.SMALL]: 15,
        [MapSize.MEDIUM]: 30,
        [MapSize.LARGE]: 50,
    };
    // AI数量范围
    static readonly MAP_AI_RANGE: Record<MapSize, { min: number; max: number }> = {
        [MapSize.SMALL]: { min: 1, max: 3 },
        [MapSize.MEDIUM]: { min: 1, max: 6 },
        [MapSize.LARGE]: { min: 1, max: 10 },
    };
    // 游戏胜利的奖励
    static readonly DIFFICULTY_GOLD_REWARD: Record<Difficulty, number> = {
        [Difficulty.EASY]: 100,
        [Difficulty.NORMAL]: 150,
        [Difficulty.HARD]: 250,
    };

    static readonly INITIAL_GOLD = 50;// 初始资金

    static readonly INITIAL_SOLDIERS = 10;// 初始士兵

    static readonly FOG_SPY_COST = 50;// 迷雾侦察花费

    static readonly AUTO_SAVE_INTERVAL = 60;// 自动保存间隔

    static readonly MAX_ECONOMY_GROWTH_BONUS = 0.3;// 最大收入加成(局外)

    static readonly GOLD_ZERO_WARNING_DELAY = 30;// 金币为0时的警告延时

    static readonly BIRTH_CHECK_HOPS = 3;// 出生检查跳数

    static readonly BIRTH_MIN_DISTANCE_HOPS = 3;// 出生最小间隔跳数

    static readonly GAME_SPEEDS = [1, 2, 4, 8];// 游戏速度
}
