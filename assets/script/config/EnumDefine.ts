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
// 征兵事件类型
export enum RecruitEventType {
    STARTED = 'started',
    COMPLETED = 'completed',
    INSUFFICIENT_GOLD = 'insufficient_gold',
    QUEUE_FULL = 'queue_full',
}
// 升级事件类型
export enum UpgradeEventType {
    STARTED = 'started',
    COMPLETED = 'completed',
    INSUFFICIENT_GOLD = 'insufficient_gold',
    MAX_LEVEL = 'max_level',
    BUSY = 'busy',
}
// 转换事件类型
export enum ConvertEventType {
    STARTED = 'started',
    COMPLETED = 'completed',
    INSUFFICIENT_GOLD = 'insufficient_gold',
    SAME_TYPE = 'same_type',
    BUSY = 'busy',
}
// 行军事件类型
export enum ArmyEventType {
    ARRIVED_AT_NODE = 'arrived_at_node',
    EDGE_ENCOUNTER = 'edge_encounter',
}
// 经济事件类型
export enum EconomyEventType {
    GOLD_ZERO_WARNING = 'gold_zero_warning',
    DISBAND_SOLDIERS = 'disband_soldiers',
}
// 线路升级事件类型
export enum EdgeUpgradeEventType {
    STARTED = 'started',
    INSUFFICIENT_GOLD = 'insufficient_gold',
    MAX_LEVEL = 'max_level',
    NOT_OWNED = 'not_owned',
}
// 节点攻占结果
export enum NodeBattleOutcome {
    ATTACKER_WINS = 'attacker_wins',
    DEFENDER_WINS = 'defender_wins',
    SAME_OWNER = 'same_owner',
}
// AI联盟状态
export enum AIAllianceState {
    FREE = 'free',
    ALLIED = 'allied',
    JOINT_ATTACK = 'joint_attack',
}
// 语言选项
export enum Language {
    ZH = 'zh',
    EN = 'en',
}
