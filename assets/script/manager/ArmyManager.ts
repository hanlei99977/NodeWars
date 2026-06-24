import { ArmyEntity } from '../entity/ArmyEntity';
import { EdgeEntity } from '../entity/EdgeEntity';
import { NodeEntity } from '../entity/NodeEntity';
import { OwnerType, ArmyState } from '../config/EnumDefine';
import { ArmyConfig } from '../config/ArmyConfig';
import { EdgeConfig } from '../config/EdgeConfig';

// 行军事件类型（update 的返回值，供外层处理节点到达/边遭遇等逻辑）
export enum ArmyEventType {
    ARRIVED_AT_NODE = 'arrived_at_node',   // 军队到达节点
    EDGE_ENCOUNTER = 'edge_encounter',     // 两军在边上相遇
}

// 行军事件数据
export class ArmyEvent {
    type: ArmyEventType;
    army: ArmyEntity;                       // 相关军队
    nodeId?: number;                        // 到达事件的目标节点ID
    otherArmy?: ArmyEntity;                 // 遭遇事件中的另一方

    constructor(type: ArmyEventType, army: ArmyEntity) {
        this.type = type;
        this.army = army;
    }
}

// 行军管理器，负责军队创建、每帧行军推进、路径查找、改道、分兵，纯逻辑层
export class ArmyManager {

    private static _armies: ArmyEntity[] = [];
    private static _nextArmyId = 1;
    private static _edgesMap: Map<string, EdgeEntity> = new Map();     // "minId_maxId" → EdgeEntity
    private static _adjList: number[][] = [];                           // 邻接表
    private static _nodeCount = 0;

    // 初始化：绑定地图的边和节点，构建邻接表和边查询映射
    static init(edges: EdgeEntity[], nodes: NodeEntity[]): void {
        ArmyManager._edgesMap.clear();
        ArmyManager._armies = [];
        ArmyManager._nextArmyId = 1;
        ArmyManager._nodeCount = nodes.length;

        // 构建边映射 key = "minId_maxId"
        for (const e of edges) {
            const minId = Math.min(e.nodeAId, e.nodeBId);
            const maxId = Math.max(e.nodeAId, e.nodeBId);
            // 将边保存为 "minId_maxId" 的映射，便于快速查找两节点间的边
            ArmyManager._edgesMap.set(`${minId}_${maxId}`, e);
        }

        // 构建邻接表
        ArmyManager._adjList = Array.from({ length: nodes.length }, () => []);
        for (const e of edges) {
            ArmyManager._adjList[e.nodeAId].push(e.nodeBId);
            ArmyManager._adjList[e.nodeBId].push(e.nodeAId);
        }
    }

    // 创建一支新军队（从节点派出），返回创建的ArmyEntity
    static createArmy(ownerId: OwnerType, soldierCount: number, pathNodeIds: number[]): ArmyEntity | null {
        if (soldierCount <= 0 || pathNodeIds.length < 2) return null;

        const army = new ArmyEntity(ArmyManager._nextArmyId++, ownerId, soldierCount, pathNodeIds);
        ArmyManager._armies.push(army);
        return army;
    }

    // 移除军队（到达己方节点后转为驻军，或全军覆没时调用）
    static removeArmy(armyId: number): void {
        ArmyManager._armies = ArmyManager._armies.filter(a => a.id !== armyId);
    }

    // 每帧行军推进（传入逻辑时间增量 dt 秒），返回本帧产生的事件列表
    static update(dt: number): ArmyEvent[] {
        const events: ArmyEvent[] = [];
        const toRemove: number[] = [];
        // 更新每支军队的状态
        for (const army of ArmyManager._armies) {
            // 军队不在移动状态或士兵数为0，标记移除
            if (army.state !== ArmyState.MOVING || army.soldierCount <= 0) {
                toRemove.push(army.id);
                continue;
            }

            // 查找当前所在边
            const edge = ArmyManager.findEdge(army.currentNodeId, army.nextNodeId);
            if (!edge) {
                toRemove.push(army.id);
                continue;
            }

            // 计算当前边实际移速 = 基础移速 × 边等级加成
            const speedBonus = EdgeConfig.SPEED_BONUS[edge.level] || 1.0;
            const currentSpeed = ArmyConfig.MOVE_SPEED * speedBonus;

            // 推进进度
            army.progress += (currentSpeed * dt) / edge.length;
            // 进度超过1表示到达边终点
            if (army.progress >= 1) {
                army.progress = 1;

                if (army.hasMoreEdges) {
                    
                    // 进入下一条边
                    army.currentEdgeIndex++;
                    army.progress = 0; // 进入下一条边，重置进度

                    // 到达的这个节点是 currentNodeId（即刚跨过的边的终点）
                    const arrivedNodeId = army.currentNodeId;
                    // 执行待执行的改道请求
                    ArmyManager.execPendingReroute(army, arrivedNodeId);
                }
            }

            if (army.hasArrived) {
                // 到达最终终点
                events.push(ArmyManager.makeEvent(ArmyEventType.ARRIVED_AT_NODE, army, army.destinationNodeId));
                toRemove.push(army.id);
            }
        }

        // 清理已到达/覆灭的军队
        for (const id of toRemove) {
            ArmyManager.removeArmy(id);
        }

        // 检测同边相遇（双向可能在同一条边上相遇）
        const encounterEvents = ArmyManager.checkEdgeEncounters();
        events.push(...encounterEvents);

        return events;
    }

    // 获取所有活跃军队
    static get armies(): ArmyEntity[] {
        return ArmyManager._armies;
    }

    // 根据两节点ID查找边
    static findEdge(nodeAId: number, nodeBId: number): EdgeEntity | null {
        const minId = Math.min(nodeAId, nodeBId);
        const maxId = Math.max(nodeAId, nodeBId);
        return ArmyManager._edgesMap.get(`${minId}_${maxId}`) || null;
    }

    // 依邻接表更新（边拆分/替换后调用）
    static updateAdjList(edges: EdgeEntity[], nodeCount: number): void {
        ArmyManager._adjList = Array.from({ length: nodeCount }, () => []);
        for (const e of edges) {
            ArmyManager._adjList[e.nodeAId].push(e.nodeBId);
            ArmyManager._adjList[e.nodeBId].push(e.nodeAId);
        }
    }

    // BFS查找两节点间最短路径（跳数最少），返回节点ID序列，不可达返回null
    // 返回的值是节点ID数组
    static findPath(fromNodeId: number, toNodeId: number): number[] | null {
        if (fromNodeId === toNodeId) return [fromNodeId];
        if (fromNodeId < 0 || fromNodeId >= ArmyManager._nodeCount) return null;
        if (toNodeId < 0 || toNodeId >= ArmyManager._nodeCount) return null;

        const visited = new Array<boolean>(ArmyManager._nodeCount).fill(false);
        const parent = new Array<number>(ArmyManager._nodeCount).fill(-1);
        const queue: number[] = [fromNodeId];
        visited[fromNodeId] = true;
        let head = 0;

        while (head < queue.length) {
            const cur = queue[head++];
            for (const nb of ArmyManager._adjList[cur]) {
                if (visited[nb]) continue;
                visited[nb] = true;
                parent[nb] = cur;
                if (nb === toNodeId) {
                    // 回溯路径
                    const path: number[] = [];
                    let node = toNodeId;
                    while (node !== -1) {
                        path.push(node);
                        node = parent[node];
                    }
                    path.reverse();
                    return path;
                }
                queue.push(nb);
            }
        }
        return null; // 不可达
    }

    // 设置军队改道目标。
    // 根据当前军队行进进度判断离哪个端点更近，以该端点为起点计算新路径。
    // - 同向（继续朝当前终点前进）：标记 pendingDestinationNodeId，到达下一节点后自动改道
    // - 反向（需要掉头）：立即修改 progress = 1 - progress，插入掉头节点并替换后续路径
    static setReroute(armyId: number, destNodeId: number): boolean {
        const army = ArmyManager._armies.find(a => a.id === armyId);
        if (!army || army.state !== ArmyState.MOVING) return false;

        const edgeStart = army.currentNodeId;
        const edgeEnd = army.nextNodeId;

        // 距哪端更近就以哪端为路径起点
        const closerNodeId = army.progress <= 0.5 ? edgeStart : edgeEnd;
        const fartherNodeId = army.progress < 0.5 ? edgeEnd : edgeStart;

        const newPath = ArmyManager.findPath(closerNodeId, destNodeId);
        if (!newPath || newPath.length < 1) return false;

        // 判断新路径是否与当前方向一致
        const continuesSameDirection = closerNodeId === edgeStart
            ? (newPath.length >= 2 && newPath[1] === edgeEnd)    // 初始节点=源节点，下一跳=终节点 → 同向
            : (newPath.length >= 2 && newPath[1] !== edgeStart); // 初始节点=终节点，下一跳≠源节点 → 同向

        if (continuesSameDirection) {
            // 同向：等待到达下一节点后执行改道
            army.pendingDestinationNodeId = destNodeId;
        } else {
            // 反向：立即掉头
            // pathNodeIds: [prefix..., edgeStart, edgeEnd, suffix...]
            // 变为:       [prefix..., edgeStart, edgeEnd, edgeStart, X, Y, ...]
            const prefix = army.pathNodeIds.slice(0, army.currentEdgeIndex + 2); // 含 edgeStart, edgeEnd
            const insertSuffix = closerNodeId === edgeStart
                ? newPath                               // [edgeStart, X, Y, ...] — 掉头后重回 edgeStart, 再接后续
                : newPath.slice(1);                     // [edgeStart, X, Y, ...] — closer=edgeEnd 已在 prefix 中

            army.pathNodeIds = [...prefix, ...insertSuffix];
            army.currentEdgeIndex = army.currentEdgeIndex + 1; // 指向 edgeEnd, nextNodeId 变为 edgeStart
            army.progress = 1 - army.progress;
            army.pendingDestinationNodeId = null;
        }

        return true;
    }

    // 从军队中分出一部分士兵向目标节点行进，返回新军队或null（士兵不足）
    static splitArmy(armyId: number, splitCount: number, destNodeId: number): ArmyEntity | null {
        const army = ArmyManager._armies.find(a => a.id === armyId);
        if (!army || army.soldierCount <= splitCount || splitCount <= 0) return null;

        // 从当前军队所在边的起点出发寻路（军队还在连接该节点的边上）
        const currentPosNodeId = army.currentNodeId;
        const path = ArmyManager.findPath(currentPosNodeId, destNodeId);
        if (!path) return null;

        // 扣除原军队士兵
        army.soldierCount -= splitCount;

        // 创建新军队
        const newArmy = new ArmyEntity(
            ArmyManager._nextArmyId++,
            army.ownerId,
            splitCount,
            path,
        );
        ArmyManager._armies.push(newArmy);
        return newArmy;
    }

    // 获取指定边上的所有军队（用于遭遇战检测）
    static getArmiesOnEdge(nodeAId: number, nodeBId: number): ArmyEntity[] {
        return ArmyManager._armies.filter(a => {
            return (a.currentNodeId === nodeAId && a.nextNodeId === nodeBId) ||
                   (a.currentNodeId === nodeBId && a.nextNodeId === nodeAId);
        });
    }

    // 获取指定玩家的所有活跃军队
    static getArmiesByOwner(ownerId: OwnerType): ArmyEntity[] {
        return ArmyManager._armies.filter(a => a.ownerId === ownerId);
    }

    // 通过ID查找军队
    static getArmyById(armyId: number): ArmyEntity | null {
        return ArmyManager._armies.find(a => a.id === armyId) || null;
    }

    // 执行待执行的改道请求：以当前所在节点为起点重新寻路到pending目标
    private static execPendingReroute(army: ArmyEntity, currentNodeId: number): void {
        if (army.pendingDestinationNodeId === null) return;

        const newPath = ArmyManager.findPath(currentNodeId, army.pendingDestinationNodeId);
        if (!newPath || newPath.length < 2) {
            // 目标不可达或已是当前节点，取消改道
            army.pendingDestinationNodeId = null;
            return;
        }

        // 替换剩余路径：当前段之后的全部替换为新路径
        army.pathNodeIds = [currentNodeId, ...newPath.slice(1)];
        army.currentEdgeIndex = 0;
        army.progress = 0;
        army.pendingDestinationNodeId = null;
    }

    // 检测同一条边上是否有两军相遇，根据行进方向和进度精确判断是否发生战斗
    // 同向：进度差 < 0.05（几乎重叠）｜反向：进度之和 > 0.95（即将交错）
    private static checkEdgeEncounters(): ArmyEvent[] {
        const events: ArmyEvent[] = [];
        const visited = new Set<string>();
        const FORWARD_ENCOUNTER_THRESHOLD = 0.05;
        const BACKWARD_ENCOUNTER_THRESHOLD = 0.95;

        for (let i = 0; i < ArmyManager._armies.length; i++) {
            for (let j = i + 1; j < ArmyManager._armies.length; j++) {
                const a = ArmyManager._armies[i];
                const b = ArmyManager._armies[j];
                if (a.ownerId === b.ownerId) continue; // 同盟不战斗
                if (a.state !== ArmyState.MOVING || b.state !== ArmyState.MOVING) continue;

                // 检查是否在同一条边上（方向相同或相反）
                const sameEdgeForward = a.currentNodeId === b.currentNodeId && a.nextNodeId === b.nextNodeId;
                const sameEdgeBackward = a.currentNodeId === b.nextNodeId && a.nextNodeId === b.currentNodeId;

                if (sameEdgeForward || sameEdgeBackward) {
                    const key = `${Math.min(a.id, b.id)}_${Math.max(a.id, b.id)}`;
                    if (visited.has(key)) continue;

                    // 根据方向和进度判定是否触发遭遇
                    let shouldFight = false;
                    if (sameEdgeForward) {
                        // 同向：进度差 < 0.05，后方几乎追上前方
                        shouldFight = Math.abs(a.progress - b.progress) < FORWARD_ENCOUNTER_THRESHOLD;
                    } else {
                        // 反向：进度之和 > 0.95，两军即将擦肩交错
                        shouldFight = a.progress + b.progress > BACKWARD_ENCOUNTER_THRESHOLD;
                    }

                    if (!shouldFight) continue;
                    visited.add(key);

                    // 双方在同一条边上且满足遭遇条件，触发遭遇战
                    events.push(ArmyManager.makeEncounterEvent(a, b));
                }
            }
        }
        return events;
    }

    // 构造节点到达事件
    private static makeEvent(type: ArmyEventType, army: ArmyEntity, nodeId?: number): ArmyEvent {
        const event = new ArmyEvent(type, army);
        event.nodeId = nodeId;
        return event;
    }

    // 构造遭遇战事件
    private static makeEncounterEvent(armyA: ArmyEntity, armyB: ArmyEntity): ArmyEvent {
        const event = new ArmyEvent(ArmyEventType.EDGE_ENCOUNTER, armyA);
        event.otherArmy = armyB;
        return event;
    }
}
