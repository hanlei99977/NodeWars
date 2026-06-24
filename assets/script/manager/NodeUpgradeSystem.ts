import { NodeEntity, UpgradeTask } from '../entity/NodeEntity';
import { NodeLevel, UpgradeTaskState, OwnerType, NodeType } from '../config/EnumDefine';
import { NodeConfig } from '../config/NodeConfig';
import { EconomySystem } from '../economy/EconomySystem';

// 升级事件类型
export enum UpgradeEventType {
    STARTED = 'started',               // 升级已开始
    COMPLETED = 'completed',           // 升级完成
    INSUFFICIENT_GOLD = 'insufficient_gold', // 金币不足
    MAX_LEVEL = 'max_level',           // 已满级
    BUSY = 'busy',                     // 节点忙碌中（有进行中的升级/转换）
}

// 升级事件数据
export class UpgradeEvent {
    type: UpgradeEventType;
    nodeId: number;                    // 相关节点ID
    newLevel?: NodeLevel;              // 完成后的新等级

    constructor(type: UpgradeEventType, nodeId: number, newLevel?: NodeLevel) {
        this.type = type;
        this.nodeId = nodeId;
        this.newLevel = newLevel;
    }
}

// 节点升级系统，负责单个/批量升级发起与任务进度推进，纯逻辑层
export class NodeUpgradeSystem {

    // 在指定节点上发起升级（1→2 或 2→3），扣金币后创建UpgradeTask
    static startUpgrade(node: NodeEntity, ownerId: string): UpgradeEvent {
        if (node.level === NodeLevel.LV3) {
            return new UpgradeEvent(UpgradeEventType.MAX_LEVEL, node.id);
        }

        if (!node.isIdle) {
            return new UpgradeEvent(UpgradeEventType.BUSY, node.id);
        }

        const cost = NodeConfig.UPGRADE_GOLD[node.level];
        if (!EconomySystem.canAfford(ownerId, cost)) {
            return new UpgradeEvent(UpgradeEventType.INSUFFICIENT_GOLD, node.id);
        }

        // 扣金币
        EconomySystem.spend(ownerId, cost);

        // 创建升级任务
        const targetLevel = node.level + 1;
        const duration = NodeConfig.UPGRADE_TIME[node.level];
        node.upgradeTask = new UpgradeTask(targetLevel, duration);
        node.upgradeTask.state = UpgradeTaskState.IN_PROGRESS;

        return new UpgradeEvent(UpgradeEventType.STARTED, node.id, targetLevel);
    }

    // 批量升级：筛选可升级节点，按距前线距离排序（远离前线的优先）
    // 逐个调用 startUpgrade，直到金币耗尽
    static batchUpgrade(
        nodes: NodeEntity[],
        nodeTypeFilter: 'all' | 'fortress' | 'market',
        ownerId: string,
        adjList: number[][],
    ): UpgradeEvent[] {
        const events: UpgradeEvent[] = [];

        // 筛选可升级节点：属于该owner、等级≤2、空闲、符合类型
        const candidates = nodes.filter(n => {
            if (n.ownerId !== ownerId) return false;
            if (n.level >= NodeLevel.LV3) return false;
            if (!n.isIdle) return false;
            if (nodeTypeFilter === 'fortress' && n.type !== NodeType.FORTRESS) return false;
            if (nodeTypeFilter === 'market' && n.type !== NodeType.MARKET) return false;
            return true;
        });

        if (candidates.length === 0) return events;

        // 计算每个候选节点距前线的距离（BFS到最近敌军的跳数）
        const frontDist = NodeUpgradeSystem.calcFrontDistance(candidates, nodes, adjList, ownerId);
        // 远离前线的优先升级（距离大 → 先升级）
        candidates.sort((a, b) => (frontDist.get(b.id) ?? 0) - (frontDist.get(a.id) ?? 0));

        // 逐个发起升级，金币不够时停止
        for (const node of candidates) {
            const cost = NodeConfig.UPGRADE_GOLD[node.level];
            if (!EconomySystem.canAfford(ownerId, cost)) break;

            const event = NodeUpgradeSystem.startUpgrade(node, ownerId);
            events.push(event);
        }

        return events;
    }

    // 每帧推进所有节点的升级任务，完成时提升节点等级
    // 返回本帧完成的升级事件列表
    static update(dt: number, nodes: NodeEntity[]): UpgradeEvent[] {
        const events: UpgradeEvent[] = [];

        for (const node of nodes) {
            const task = node.upgradeTask;
            if (!task || task.state === UpgradeTaskState.COMPLETED) continue;
            if (task.state === UpgradeTaskState.PENDING) {
                task.state = UpgradeTaskState.IN_PROGRESS;
            }

            task.progress += dt;

            if (task.progress >= task.totalTime) {
                // 升级完成
                node.level = task.targetLevel;
                node.upgradeTask = null;
                events.push(new UpgradeEvent(UpgradeEventType.COMPLETED, node.id, node.level));
            }
        }

        return events;
    }

    // 计算每个候选节点距最近敌军节点的最短跳数（BFS），用于批量升级排序
    // 敌军 = ownerId 为己方以外的非中立节点
    private static calcFrontDistance(
        candidates: NodeEntity[],
        allNodes: NodeEntity[],
        adjList: number[][],
        ownerId: string,
    ): Map<number, number> {
        const distMap = new Map<number, number>();
        // 收集所有敌军节点ID
        const enemyIds = allNodes
            .filter(n => n.ownerId !== ownerId && n.ownerId !== OwnerType.NEUTRAL)
            .map(n => n.id);

        if (enemyIds.length === 0) {
            // 无敌军节点时，都视为同样距离
            for (const c of candidates) {
                distMap.set(c.id, 999);
            }
            return distMap;
        }

        // 从各敌军节点出发做多源BFS，得到每个候选节点的最近距离
        const visited = new Array<boolean>(allNodes.length).fill(false);
        const dist = new Array<number>(allNodes.length).fill(Infinity);
        const queue: number[] = [];

        for (const eid of enemyIds) {
            visited[eid] = true;
            dist[eid] = 0;
            queue.push(eid);
        }

        let head = 0;
        while (head < queue.length) {
            const cur = queue[head++];
            for (const nb of adjList[cur]) {
                if (visited[nb]) continue;
                visited[nb] = true;
                dist[nb] = dist[cur] + 1;
                queue.push(nb);
            }
        }

        for (const c of candidates) {
            distMap.set(c.id, dist[c.id] === Infinity ? 999 : dist[c.id]);
        }

        return distMap;
    }
}
