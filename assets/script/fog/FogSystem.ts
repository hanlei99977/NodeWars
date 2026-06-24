import { NodeEntity } from '../entity/NodeEntity';
import { NodeType, OwnerType, FogMode } from '../config/EnumDefine';
import { GameConfig } from '../config/GameConfig';
import { EconomySystem } from '../economy/EconomySystem';

// 单个节点对某方的迷雾情报记录
export class FogRecord {
    isExplored: boolean;                // 是否被探索过（拥有/相邻/攻击过/侦察过）
    isCurrentlyVisible: boolean;        // 当前是否实时可见（拥有/相邻/侦察有效期内）
    lastKnownType: NodeType;            // 最后已知的类型
    lastKnownSoldierCount: number;      // 最后已知的兵力，-1表示从未获取过兵力情报
    lastSeenTime: number;               // 最后看到实时信息的时间（游戏时间秒）

    constructor() {
        this.isExplored = false;
        this.isCurrentlyVisible = false;
        this.lastKnownType = NodeType.NORMAL;
        this.lastKnownSoldierCount = -1;
        this.lastSeenTime = 0;
    }
}

// 对外暴露的节点可见信息
export class FogVisibleInfo {
    nodeId: number;
    type: NodeType | null;              // null表示未探索
    soldierCount: number | null;        // null表示未探索或无兵力情报
    isLive: boolean;                    // 当前是否实时可见

    constructor(nodeId: number, type: NodeType | null, soldierCount: number | null, isLive: boolean) {
        this.nodeId = nodeId;
        this.type = type;
        this.soldierCount = soldierCount;
        this.isLive = isLive;
    }
}

// 战争迷雾系统，管理每方对每个节点的可见性，纯逻辑层
// 无雾模式：所有节点完全可见
// 有雾模式：节点位置始终可见，但兵力和类型仅在探索后可见，旧情报过期
export class FogSystem {

    // ownerId → (nodeId → FogRecord)
    // 每个玩家都保存一份所有节点的情报信息
    private static _fogData: Map<string, Map<number, FogRecord>> = new Map();// <玩家ID，<节点ID，节点情报记录>>
    private static _fogMode: FogMode = FogMode.NONE;
    private static _adjList: number[][] = [];

    // 情报过期时间（秒），侦察/攻击获取的情报超过此时间后不再视为实时
    private static readonly INTEL_EXPIRY = 40;
    // 侦察持续时间（秒），侦察后此时间内该节点实时可见
    private static readonly SPY_DURATION = 30;

    // 初始化迷雾
    // 无雾模式下不维护fogData，所有节点直接可见
    static init(fogMode: FogMode, nodes: NodeEntity[], edges: { nodeAId: number; nodeBId: number }[]): void {
        FogSystem._fogMode = fogMode;
        FogSystem._fogData.clear();

        // 构建邻接表
        FogSystem._adjList = Array.from({ length: nodes.length }, () => []);
        for (const e of edges) {
            FogSystem._adjList[e.nodeAId].push(e.nodeBId);
            FogSystem._adjList[e.nodeBId].push(e.nodeAId);
        }
        // 无雾模式则返回
        if (fogMode === FogMode.NONE) return;

        // 为每个非中立方初始化迷霧数据
        const ownerSet = new Set<string>();// 储存玩家和AI的ID
        for (const n of nodes) {
            if (n.ownerId !== OwnerType.NEUTRAL) {
                ownerSet.add(n.ownerId);
            }
        }
        // 为每个玩家都保存一份所有节点的情报信息
        for (const ownerId of ownerSet) {
            const nodeMap = new Map<number, FogRecord>();
            for (const n of nodes) {
                nodeMap.set(n.id, new FogRecord());
            }
            // 初始化
            FogSystem._fogData.set(ownerId, nodeMap);
        }

        // 初始状态：己方节点和相邻节点设为可见
        for (const ownerId of ownerSet) {
            FogSystem.refreshVisibility(ownerId, nodes);
        }
    }

    // 无雾模式下始终返回完整可见信息
    // 获取当前玩家对指定节点的可见情况
    static getVisibleInfo(node: NodeEntity, viewerId: string): FogVisibleInfo {
        if (FogSystem._fogMode === FogMode.NONE) {
            return new FogVisibleInfo(node.id, node.type, node.garrisonCount, true);
        }

        const nodeMap = FogSystem._fogData.get(viewerId);
        if (!nodeMap) {
            return new FogVisibleInfo(node.id, null, null, false);
        }

        const record = nodeMap.get(node.id);
        if (!record || !record.isExplored) {
            return new FogVisibleInfo(node.id, null, null, false);
        }

        return new FogVisibleInfo(
            node.id,
            record.lastKnownType,
            record.lastKnownSoldierCount,
            record.isCurrentlyVisible,
        );
    }

    // 检查某节点对指定方是否当前实时可见
    static isNodeCurrentlyVisible(nodeId: number, viewerId: string): boolean {
        if (FogSystem._fogMode === FogMode.NONE) return true;
        const nodeMap = FogSystem._fogData.get(viewerId);
        if (!nodeMap) return false;
        const record = nodeMap.get(nodeId);
        return record ? record.isCurrentlyVisible : false;
    }

    // 检查某节点是否被指定方探索过（至少知道类型）
    static isNodeExplored(nodeId: number, viewerId: string): boolean {
        if (FogSystem._fogMode === FogMode.NONE) return true;
        const nodeMap = FogSystem._fogData.get(viewerId);
        if (!nodeMap) return false;
        const record = nodeMap.get(nodeId);
        return record ? record.isExplored : false;
    }

    // 侦察指定节点，消耗FOG_SPY_COST金币，返回是否成功
    static spyOnNode(node: NodeEntity, spyerId: string): boolean {
        if (FogSystem._fogMode === FogMode.NONE) return true;
        if (!EconomySystem.canAfford(spyerId, GameConfig.FOG_SPY_COST)) return false;

        EconomySystem.spend(spyerId, GameConfig.FOG_SPY_COST);

        const nodeMap = FogSystem._fogData.get(spyerId);
        if (!nodeMap) return false;

        let record = nodeMap.get(node.id);
        if (!record) {
            record = new FogRecord();
            nodeMap.set(node.id, record);
        }

        // 侦察：获取当前实时信息，持续SPY_DURATION秒
        record.isExplored = true;
        record.isCurrentlyVisible = true;
        record.lastKnownType = node.type;
        record.lastKnownSoldierCount = node.garrisonCount;
        record.lastSeenTime = FogSystem._totalTime;

        return true;
    }

    // 记录攻击事件：攻击过但未攻占时，记录类型但不记录兵力
    static recordAttack(node: NodeEntity, attackerId: string): void {
        if (FogSystem._fogMode === FogMode.NONE) return;

        const nodeMap = FogSystem._fogData.get(attackerId);
        if (!nodeMap) return;

        let record = nodeMap.get(node.id);
        if (!record) {
            record = new FogRecord();
            nodeMap.set(node.id, record);
        }

        record.isExplored = true;
        record.lastKnownType = node.type;
        // 攻击但未攻占：不记录兵力（lastKnownSoldierCount 保持不变）
        record.lastSeenTime = FogSystem._totalTime;
    }

    // 游戏逻辑时间累计（用于情报过期判定和可见性刷新）
    private static _totalTime = 0;

    // 每帧更新：刷新己方节点及其相邻节点的可见性，检查旧情报过期
    static update(dt: number, nodes: NodeEntity[]): void {
        if (FogSystem._fogMode === FogMode.NONE) return;

        FogSystem._totalTime += dt;

        // 对所有方刷新可见性
        const ownerIds = [...FogSystem._fogData.keys()];
        for (const ownerId of ownerIds) {
            FogSystem.refreshVisibility(ownerId, nodes);
        }
    }

    // 游戏结束后重置
    static reset(): void {
        FogSystem._fogData.clear();
        FogSystem._totalTime = 0;
        FogSystem._adjList = [];
    }

    // 刷新指定方对地图的可见性：
    // 己方节点+相邻1跳节点 → 实时可见
    // 侦察情报 → 过期后降级为非实时
    private static refreshVisibility(ownerId: string, nodes: NodeEntity[]): void {
        // 得到指定玩家的所有节点的情报信息
        const nodeMap = FogSystem._fogData.get(ownerId);
        if (!nodeMap) return;

        const now = FogSystem._totalTime;//当前累计游戏时间

        // 收集当前实时可见的节点：己方节点 + 相邻1跳节点
        const liveVisible = new Set<number>();
        for (const n of nodes) {
            if (n.ownerId === ownerId) {
                liveVisible.add(n.id);
                // 相邻1跳节点也实时可见
                for (const nb of FogSystem._adjList[n.id]) {
                    liveVisible.add(nb);
                }
            }
        }

        // 更新所有fog记录
        for (const [nodeId, record] of nodeMap.entries()) {
            const node = nodes[nodeId];
            if (!node) continue;

            if (liveVisible.has(nodeId)) {
                // 实时可见：更新到最新数据
                record.isExplored = true;
                record.isCurrentlyVisible = true;
                record.lastKnownType = node.type;
                record.lastKnownSoldierCount = node.garrisonCount;
                record.lastSeenTime = now;
            } else if (record.isExplored) {
                // 非实时区域：检查情报是否过期
                if (now - record.lastSeenTime > FogSystem.INTEL_EXPIRY) {
                    record.isCurrentlyVisible = false;
                }
                // 侦察有效期到期
                if (record.isCurrentlyVisible && now - record.lastSeenTime > FogSystem.SPY_DURATION) {
                    record.isCurrentlyVisible = false;
                }
            }
        }
    }
}
