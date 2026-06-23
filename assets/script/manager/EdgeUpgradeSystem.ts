import { EdgeEntity } from '../entity/EdgeEntity';
import { NodeEntity } from '../entity/NodeEntity';
import { EdgeLevel } from '../config/EnumDefine';
import { EdgeConfig } from '../config/EdgeConfig';
import { EconomySystem } from '../economy/EconomySystem';

// 线路升级事件类型
export enum EdgeUpgradeEventType {
    STARTED = 'started',               // 升级完成（即时生效）
    INSUFFICIENT_GOLD = 'insufficient_gold', // 金币不足
    MAX_LEVEL = 'max_level',           // 已满级
    NOT_OWNED = 'not_owned',           // 两端节点不全为己方所有
}

// 线路升级事件数据
export class EdgeUpgradeEvent {
    type: EdgeUpgradeEventType;
    edgeId: number;                    // 线路ID
    newLevel?: EdgeLevel;              // 完成后的新等级

    constructor(type: EdgeUpgradeEventType, edgeId: number, newLevel?: EdgeLevel) {
        this.type = type;
        this.edgeId = edgeId;
        this.newLevel = newLevel;
    }
}

// 线路升级系统，负责单个/批量线路升级，纯逻辑层
// 线路升级为即时生效（扣金即生效，无建造时间），移速加成立即作用于行军军队
export class EdgeUpgradeSystem {

    // 升级单条线路，扣金币后立即提升等级
    static upgradeEdge(edge: EdgeEntity, nodes: NodeEntity[], ownerId: string): EdgeUpgradeEvent {
        if (edge.level === EdgeLevel.LV3) {
            return new EdgeUpgradeEvent(EdgeUpgradeEventType.MAX_LEVEL, edge.id);
        }

        // 检查两端节点是否都属于该owner
        if (!EdgeUpgradeSystem.isEdgeOwnedBy(edge, nodes, ownerId)) {
            return new EdgeUpgradeEvent(EdgeUpgradeEventType.NOT_OWNED, edge.id);
        }

        const cost = EdgeConfig.UPGRADE_GOLD[edge.level];
        if (!EconomySystem.canAfford(ownerId, cost)) {
            return new EdgeUpgradeEvent(EdgeUpgradeEventType.INSUFFICIENT_GOLD, edge.id);
        }

        // 扣金币并立即升级
        EconomySystem.spend(ownerId, cost);
        const newLevel = edge.level + 1;
        edge.level = newLevel;

        return new EdgeUpgradeEvent(EdgeUpgradeEventType.STARTED, edge.id, newLevel);
    }

    // 批量升级所有符合条件的己方线路，低等级优先 → 同级内短线路优先
    // 逐条升级直到金币耗尽
    static batchUpgrade(edges: EdgeEntity[], nodes: NodeEntity[], ownerId: string): EdgeUpgradeEvent[] {
        const events: EdgeUpgradeEvent[] = [];

        // 筛选可升级线路：己方双端节点、等级≤2
        const candidates = edges.filter(e => {
            if (e.level >= EdgeLevel.LV3) return false;
            return EdgeUpgradeSystem.isEdgeOwnedBy(e, nodes, ownerId);
        });

        if (candidates.length === 0) return events;

        // 排序：低等级优先 → 同等级内短线路优先
        candidates.sort((a, b) => {
            if (a.level !== b.level) return a.level - b.level;
            return a.length - b.length;
        });

        // 逐条升级，金币不够时停止
        for (const edge of candidates) {
            const cost = EdgeConfig.UPGRADE_GOLD[edge.level];
            if (!EconomySystem.canAfford(ownerId, cost)) break;

            const event = EdgeUpgradeSystem.upgradeEdge(edge, nodes, ownerId);
            events.push(event);
        }

        return events;
    }

    // 判断线路两端节点是否都属于指定owner
    private static isEdgeOwnedBy(edge: EdgeEntity, nodes: NodeEntity[], ownerId: string): boolean {
        const nodeA = nodes.find(n => n.id === edge.nodeAId);
        const nodeB = nodes.find(n => n.id === edge.nodeBId);
        if (!nodeA || !nodeB) return false;
        return nodeA.ownerId === ownerId && nodeB.ownerId === ownerId;
    }
}
