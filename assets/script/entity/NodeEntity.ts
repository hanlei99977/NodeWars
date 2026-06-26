import { NodeLevel, NodeType, SpecialNodeType, OwnerType, UpgradeTaskState, ConvertTaskState, RecruitTaskState } from '../config/EnumDefine';

// 2D坐标位置（纯数据，不依赖cc引擎）
export class Vec2Data {
    x: number;
    y: number;

    constructor(x: number = 0, y: number = 0) {
        this.x = x;
        this.y = y;
    }
}

// 节点升级任务（仅数据，不含回调/逻辑）
export class UpgradeTask {
    targetLevel: NodeLevel;     // 目标等级
    state: UpgradeTaskState;    // 任务状态
    progress: number;           // 已进行时间(秒)
    totalTime: number;          // 总需时间(秒)

    constructor(targetLevel: NodeLevel, totalTime: number) {
        this.targetLevel = targetLevel;
        this.state = UpgradeTaskState.PENDING;
        this.progress = 0;
        this.totalTime = totalTime;
    }
}

// 节点类型转换任务（仅数据）
export class ConvertTask {
    targetType: NodeType;       // 目标类型（要塞/市场）
    state: ConvertTaskState;    // 任务状态
    progress: number;           // 已进行时间(秒)
    totalTime: number;          // 总需时间(秒)

    constructor(targetType: NodeType, totalTime: number) {
        this.targetType = targetType;
        this.state = ConvertTaskState.PENDING;
        this.progress = 0;
        this.totalTime = totalTime;
    }
}

// 征兵任务（仅数据，每节点队列中可存放多个）
export class RecruitTask {
    soldierCount: number;       // 本次征募士兵数
    state: RecruitTaskState;    // 任务状态
    progress: number;           // 已进行时间(秒)
    totalTime: number;          // 总需时间(秒)

    constructor(soldierCount: number, totalTime: number) {
        this.soldierCount = soldierCount;
        this.state = RecruitTaskState.PENDING;
        this.progress = 0;
        this.totalTime = totalTime;
    }
}

// 节点实体（纯数据容器，不包含任何引擎组件和UI逻辑）
export class NodeEntity {
    id: number;                             // 节点唯一ID
    ownerId: OwnerType;                     // 所属方（中立/玩家/AI）
    level: NodeLevel;                       // 节点等级 1/2/3
    type: NodeType;                         // 节点建筑类型（普通/要塞/市场）
    specialType: SpecialNodeType;           // 特殊属性（无/金矿/军营/高地）
    garrisonCount: number;                  // 驻军人数
    autoRecruitThreshold: number;            // 自动征兵阈值（0=关闭，>0=当驻军低于此数自动征兵100人）
    position: Vec2Data;                     // 地图坐标
    upgradeTask: UpgradeTask | null;        // 当前升级任务（最多一个）
    convertTask: ConvertTask | null;        // 当前转换任务（最多一个）
    recruitQueue: RecruitTask[];            // 征兵队列（最多5组）

    constructor(
        id: number,
        ownerId: OwnerType,
        level: NodeLevel,
        type: NodeType,
        specialType: SpecialNodeType,
        garrisonCount: number,
        position: Vec2Data,
    ) {
        this.id = id;
        this.ownerId = ownerId;
        this.level = level;
        this.type = type;
        this.specialType = specialType;
        this.garrisonCount = garrisonCount;
        this.autoRecruitThreshold = 0;
        this.position = position;
        this.upgradeTask = null;
        this.convertTask = null;
        this.recruitQueue = [];
    }

    // 当前节点是否处于空闲状态（无升级/转换任务）
    get isIdle(): boolean {
        return this.upgradeTask === null && this.convertTask === null;
    }

    // 征兵队列是否已满
    get isRecruitQueueFull(): boolean {
        return this.recruitQueue.length >= 5;
    }

    // 当前生效的征兵时间缩减系数（含特殊节点军营效果）
    getRecruitTimeReduction(hasBarracksBonus: boolean): number {
        return hasBarracksBonus ? 0.7 : 1.0;
    }
}
