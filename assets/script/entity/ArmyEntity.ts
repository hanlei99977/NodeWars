import { OwnerType, ArmyState } from '../config/EnumDefine';

// 军队实体（纯数据容器，表示在节点之间移动的一支部队，驻军数据在 NodeEntity.garrisonCount 中）
export class ArmyEntity {

    id: number;                     // 军队唯一ID
    ownerId: OwnerType;             // 所属方（玩家/AI）
    soldierCount: number;           // 士兵人数
    pathNodeIds: number[];          // 路径节点ID序列 [起点, 中继点1, 中继点2, ..., 终点]
    currentEdgeIndex: number;       // 当前正在走的边索引（pathNodeIds[i] → pathNodeIds[i+1]）
    progress: number;               // 当前边上的行进进度（0~1，0=刚离开起点，1=到达终点）
    pendingDestinationNodeId: number | null;  // 改道请求中的目标节点ID，到达下一节点后执行改道，null表示无待执行改道
    state: ArmyState;               // 军队状态（移动中/已驻扎，驻扎时转为驻军从ArmyEntity列表移除）
    totalSoldiersLost: number;      // 本次行军累计损失士兵数（用于战后统计）

    constructor(
        id: number,
        ownerId: OwnerType,
        soldierCount: number,
        pathNodeIds: number[],
    ) {
        this.id = id;
        this.ownerId = ownerId;
        this.soldierCount = soldierCount;
        this.pathNodeIds = pathNodeIds;
        this.currentEdgeIndex = 0;
        this.progress = 0;
        this.pendingDestinationNodeId = null;
        this.state = ArmyState.MOVING;
        this.totalSoldiersLost = 0;
    }

    // 当前所在边的起点节点ID
    get currentNodeId(): number {
        return this.pathNodeIds[this.currentEdgeIndex];
    }

    // 当前所在边的终点节点ID（即下一跳节点）
    get nextNodeId(): number {
        return this.pathNodeIds[this.currentEdgeIndex + 1];
    }

    // 路径上是否还有剩余边（即尚未到达最终终点）
    get hasMoreEdges(): boolean {
        return this.currentEdgeIndex < this.pathNodeIds.length - 1;
    }

    // 是否已到达路径最终终点
    get hasArrived(): boolean {
        return this.currentEdgeIndex >= this.pathNodeIds.length - 1 && this.progress >= 1;
    }

    // 路径终点节点ID
    get destinationNodeId(): number {
        return this.pathNodeIds[this.pathNodeIds.length - 1];
    }
}
