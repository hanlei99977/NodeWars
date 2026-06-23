// 节点类型
export enum NodeType {
    NORMAL = 'normal',
    FORTRESS = 'fortress',
    MARKET = 'market',
}
// 特殊节点类型
export enum SpecialNodeType {
    NONE = 'none',
    GOLD_MINE = 'gold_mine',
    BARRACKS = 'barracks',
    HIGHLAND = 'highland',
}
// 节点等级
export enum NodeLevel {
    LV1 = 1,
    LV2 = 2,
    LV3 = 3,
}
// 边等级
export enum EdgeLevel {
    LV1 = 1,
    LV2 = 2,
    LV3 = 3,
}
// 玩家类型
export enum OwnerType {
    NEUTRAL = 'neutral',// 中立
    PLAYER = 'player',// 人
    AI = 'ai',//AI
}
// 难度等级
export enum Difficulty {
    EASY = 'easy',
    NORMAL = 'normal',
    HARD = 'hard',
}
// 地图大小
export enum MapSize {
    SMALL = 'small',
    MEDIUM = 'medium',
    LARGE = 'large',
}
// 游戏速度
export enum GameSpeed {
    X1 = 1,
    X2 = 2,
    X4 = 4,
    X8 = 8,
}
// 是否有雾
export enum FogMode {
    NONE = 'none',
    FOG = 'fog',
}
// 游戏状态
export enum GameState {
    PLAYING = 'playing',
    PAUSED = 'paused',
    WIN = 'win',
    LOSE = 'lose',
}
// 事件类型
export enum EventType {
    NONE = 'none',
    HARVEST = 'harvest',//丰收
    WAR_MOBILIZATION = 'war_mobilization',//战争动员
}
// 征兵任务状态
export enum RecruitTaskState {
    PENDING = 'pending',
    IN_PROGRESS = 'in_progress',
    COMPLETED = 'completed',
}
// 升级任务状态
export enum UpgradeTaskState {
    PENDING = 'pending',
    IN_PROGRESS = 'in_progress',
    COMPLETED = 'completed',
}
// 转换任务状态
export enum ConvertTaskState {
    PENDING = 'pending',
    IN_PROGRESS = 'in_progress',
    COMPLETED = 'completed',
}
// 军队状态
export enum ArmyState {
    MOVING = 'moving',
    STATIONED = 'stationed',
}
