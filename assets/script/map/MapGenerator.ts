import { MapSize, NodeLevel, NodeType, SpecialNodeType, OwnerType } from '../config/EnumDefine';
import { NodeEntity, Vec2Data } from '../entity/NodeEntity';
import { EdgeEntity } from '../entity/EdgeEntity';
import { GameConfig } from '../config/GameConfig';
import { NodeConfig } from '../config/NodeConfig';

// 地图生成参数
interface MapGenerateParams {
    nodeCount: number;          // 节点总数
    aiCount: number;            // AI数量
    width: number;              // 地图宽度
    height: number;             // 地图高度
    minEdgeDist: number;        // 节点间最小间距（避免重叠）
}

// 地图生成结果
export class MapGenerateResult {
    nodes: NodeEntity[];
    edges: EdgeEntity[];
    playerNodeId: number;       // 玩家出生节点ID
    aiNodeIds: number[];        // AI出生节点ID列表

    constructor(nodes: NodeEntity[], edges: EdgeEntity[], playerNodeId: number, aiNodeIds: number[]) {
        this.nodes = nodes;
        this.edges = edges;
        this.playerNodeId = playerNodeId;
        this.aiNodeIds = aiNodeIds;
    }
}

// 地图生成器，负责按地图大小和AI数量随机生成连通图、分配出生点与中立节点属性
export class MapGenerator {

    // 公开入口：根据地图大小和AI数量生成完整地图数据
    static generate(mapSize: MapSize, aiCount: number): MapGenerateResult {
        const params = MapGenerator.getParams(mapSize, aiCount);
        return MapGenerator.doGenerate(params);
    }

    // 全局邻接表
    private static _adjList: number[][] = [];

    static get adjList(): number[][] {
        return MapGenerator._adjList;
    }

    // 根据地图大小获取宽高和边距参数
    private static getParams(mapSize: MapSize, aiCount: number): MapGenerateParams {
        switch (mapSize) {
            case MapSize.SMALL:
                return { nodeCount: GameConfig.MAP_NODE_COUNTS[MapSize.SMALL], aiCount, width: 800, height: 600, minEdgeDist: 80 };
            case MapSize.MEDIUM:
                return { nodeCount: GameConfig.MAP_NODE_COUNTS[MapSize.MEDIUM], aiCount, width: 1100, height: 800, minEdgeDist: 90 };
            case MapSize.LARGE:
                return { nodeCount: GameConfig.MAP_NODE_COUNTS[MapSize.LARGE], aiCount, width: 1400, height: 1000, minEdgeDist: 100 };
        }
    }

    // 核心生成流程
    private static doGenerate(params: MapGenerateParams): MapGenerateResult {
        const maxAttempts = 50; // 最多尝试50次以满足出生点约束
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            // 1.生成随机位置
            const positions = MapGenerator.generatePositions(params);
            // 2.生成MST保证连通，MST边数为节点数-1，且倾向于连接近邻节点，形成合理拓扑基础
            let edges = MapGenerator.buildMST(positions, params.nodeCount);
            // 3.添加额外边以丰富拓扑
            edges = MapGenerator.addExtraEdges(edges, positions, params.nodeCount);
            // 4.构建邻接表用于后续跳数计算
            MapGenerator._adjList = MapGenerator.buildAdjList(edges, params.nodeCount);
            // 5.选择出生点（满足3跳间距）
            const birthIds = MapGenerator.selectBirths(MapGenerator.adjList, params.nodeCount, params.aiCount + 1); // +1为玩家
            if (!birthIds) continue; // 无法满足约束，重试
            // 6.校验3跳资源平衡
            const balanceOk = MapGenerator.checkBirthBalance(MapGenerator.adjList, positions, params.nodeCount, birthIds);
            if (!balanceOk) continue;
            // 7.分配属性生成节点
            const playerNodeId = birthIds[0];
            const aiNodeIds = birthIds.slice(1);
            // 根据出生点分配节点属性，保证玩家和AI出生点属性相似，其他中立节点随机分布等级和特殊类型
            const nodes = MapGenerator.buildNodes(positions, params.nodeCount, playerNodeId, aiNodeIds);
            // 8.特殊节点分配
            MapGenerator.assignSpecialNodes(nodes, MapGenerator.adjList, playerNodeId, aiNodeIds);
            return new MapGenerateResult(nodes, edges, playerNodeId, aiNodeIds);
        }
        // 兜底：去约束直接生成
        return MapGenerator.fallbackGenerate(params);
    }

    // 在给定宽高内随机散布节点位置，保证最小间距
    private static generatePositions(params: MapGenerateParams): Vec2Data[] {
        const positions: Vec2Data[] = [];
        const padding = 60;
        for (let i = 0; i < params.nodeCount; i++) {
            let pos: Vec2Data;
            let attempts = 0;
            do {
                const x = padding + Math.random() * (params.width - padding * 2);
                const y = padding + Math.random() * (params.height - padding * 2);
                pos = new Vec2Data(x, y);
                attempts++;
            } while (MapGenerator.isTooClose(pos, positions, params.minEdgeDist) && attempts < 200);
            positions.push(pos);
        }
        return positions;
    }

    // 判断给定点是否与已有位置列表中的任意点过近
    private static isTooClose(pos: Vec2Data, existing: Vec2Data[], minDist: number): boolean {
        for (const p of existing) {
            const dx = pos.x - p.x;
            const dy = pos.y - p.y;
            if (dx * dx + dy * dy < minDist * minDist) return true;
        }
        return false;
    }

    // 基于欧几里得距离构建最小生成树，保证图连通
    private static buildMST(positions: Vec2Data[], nodeCount: number): EdgeEntity[] {
        const edges: EdgeEntity[] = [];
        const visited = new Array<boolean>(nodeCount).fill(false);
        visited[0] = true;
        let edgeId = 0;

        while (edges.length < nodeCount - 1) {
            let minDist = Infinity;
            let minU = -1;// 最小边的起点
            let minV = -1;// 最小边的终点
            // 连接已访问节点与未访问节点，找到全图最短边
            for (let u = 0; u < nodeCount; u++) {
                if (!visited[u]) continue;
                for (let v = 0; v < nodeCount; v++) {
                    if (visited[v]) continue;
                    const dx = positions[u].x - positions[v].x;
                    const dy = positions[u].y - positions[v].y;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    if (dist < minDist) {
                        minDist = dist;
                        minU = u;
                        minV = v;
                    }
                }
            }
            if (minU === -1) break;
            visited[minV] = true;
            edges.push(new EdgeEntity(edgeId++, minU, minV, Math.round(minDist)));
        }
        return edges;
    }

    // 在MST基础上添加额外边，使图密度适中（每个节点平均2~3条边）
    private static addExtraEdges(edges: EdgeEntity[], positions: Vec2Data[], nodeCount: number): EdgeEntity[] {
        const edgeSet = new Set<string>();// 已有边的集合，格式为 "minNodeId_maxNodeId" 以避免重复和无向边问题
        for (const e of edges) {
            edgeSet.add(`${Math.min(e.nodeAId, e.nodeBId)}_${Math.max(e.nodeAId, e.nodeBId)}`);
        }
        // 计算所有可能边并按距离排序
        // u是起点，v是终点，dist是两节点间的欧几里得距离
        // 只考虑u<v的组合以避免重复边（无向图）
        const candidates: { u: number; v: number; dist: number }[] = [];
        for (let u = 0; u < nodeCount; u++) {
            for (let v = u + 1; v < nodeCount; v++) {
                const key = `${u}_${v}`;
                if (edgeSet.has(key)) continue;
                const dx = positions[u].x - positions[v].x;
                const dy = positions[u].y - positions[v].y;
                candidates.push({ u, v, dist: Math.sqrt(dx * dx + dy * dy) });
            }
        }
        candidates.sort((a, b) => a.dist - b.dist);
        // 目标边数：约 nodeCount * 1.3（稀疏但非树形）
        const targetEdgeCount = Math.floor(nodeCount * 1.3);
        let edgeId = edges.length;
        for (const cand of candidates) {
            if (edges.length >= targetEdgeCount) break;// 已达目标边数
            const key = `${cand.u}_${cand.v}`;
            if (edgeSet.has(key)) continue;// 已存在边
            edgeSet.add(key);
            edges.push(new EdgeEntity(edgeId++, cand.u, cand.v, Math.round(cand.dist)));
        }
        return edges;
    }

    // 根据边列表构建邻接表
    // adj[nodeId] = [neighborNodeId1, neighborNodeId2, ...]
    private static buildAdjList(edges: EdgeEntity[], nodeCount: number): number[][] {
        const adj: number[][] = Array.from({ length: nodeCount }, () => []);
        for (const e of edges) {
            adj[e.nodeAId].push(e.nodeBId);
            adj[e.nodeBId].push(e.nodeAId);
        }
        return adj;
    }

    // BFS计算两节点间最短跳数
    private static bfsHops(adjList: number[][], start: number, end: number): number {
        if (start === end) return 0;
        const visited = new Array<boolean>(adjList.length).fill(false);
        const queue: { node: number; hops: number }[] = [{ node: start, hops: 0 }];
        visited[start] = true;
        let head = 0;
        while (head < queue.length) {
            const cur = queue[head++];
            // 当前节点的邻居遍历
            for (const nb of adjList[cur.node]) {
                // 如果邻居是目标节点，返回当前跳数+1
                if (nb === end) return cur.hops + 1;
                if (!visited[nb]) {
                    visited[nb] = true;
                    queue.push({ node: nb, hops: cur.hops + 1 });
                }
            }
        }
        return Infinity; // 不连通
    }

    // 获取距给定节点hopRange跳内的所有节点ID集合
    private static getNodesInRange(adjList: number[][], start: number, hopRange: number): number[] {
        const visited = new Array<boolean>(adjList.length).fill(false);
        const result: number[] = [];
        const queue: { node: number; hops: number }[] = [{ node: start, hops: 0 }];
        visited[start] = true;
        let head = 0;
        while (head < queue.length) {
            const cur = queue[head++];
            // 如果当前节点的跳数在hopRange范围内，加入结果集
            if (cur.hops > 0 && cur.hops <= hopRange) {
                result.push(cur.node);
            }
            // 如果当前跳数已达到hopRange，则不再继续扩展
            if (cur.hops >= hopRange) continue;
            // 遍历当前节点的邻居
            for (const nb of adjList[cur.node]) {
                if (!visited[nb]) {
                    visited[nb] = true;
                    queue.push({ node: nb, hops: cur.hops + 1 });
                }
            }
        }
        return result;
    }

    // 选择出生点，保证两两之间最短距离 >= 3跳
    private static selectBirths(adjList: number[][], nodeCount: number, birthCount: number): number[] | null {
        const maxAttempts = 200;// 最多尝试200次随机选择出生点
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            const candidates: number[] = [];// 已选出生点列表
            const available = Array.from({ length: nodeCount }, (_, i) => i);
            // Fisher-Yates洗牌
            for (let i = available.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [available[i], available[j]] = [available[j], available[i]];
            }
            // 遍历洗牌后的节点列表，尝试选择出生点
            for (const nodeId of available) {
                let valid = true;
                for (const existing of candidates) {
                    if (MapGenerator.bfsHops(adjList, nodeId, existing) < GameConfig.BIRTH_MIN_DISTANCE_HOPS) {
                        valid = false;
                        break;
                    }
                }
                if (valid) {
                    candidates.push(nodeId);
                    if (candidates.length >= birthCount) return candidates;
                }
            }
        }
        return null;
    }

    // 估算节点基础资源价值（仅基于位置和连接数，用于出生点平衡校验）
    private static estimateNodeValue(adjList: number[][], nodeId: number): number {
        // 连接数越多通常越有价值（可达性强）
        return adjList[nodeId].length;
    }

    // 校验各出生点3跳范围内的资源价值是否接近（最大差异不超过均值的50%）
    private static checkBirthBalance(
        adjList: number[][],
        _positions: Vec2Data[],
        nodeCount: number,
        birthIds: number[],
    ): boolean {
        const rangeValues: number[] = [];
        for (const birthId of birthIds) {
            // 获取 BIRTH_CHECK_HOPS 跳范围内的节点ID集合，并计算总价值
            const nodesInRange = MapGenerator.getNodesInRange(adjList, birthId, GameConfig.BIRTH_CHECK_HOPS);
            // 计算出生点本身和范围内节点的总价值
            let totalValue = MapGenerator.estimateNodeValue(adjList, birthId);
            for (const nid of nodesInRange) {
                totalValue += MapGenerator.estimateNodeValue(adjList, nid);
            }
            rangeValues.push(totalValue);
        }
        const avg = rangeValues.reduce((a, b) => a + b, 0) / rangeValues.length;
        if (avg === 0) return true;
        // 任意出生点的3跳资源价值与均值差异不超过50%
        for (const v of rangeValues) {
            if (Math.abs(v - avg) / avg > 0.5) return false;
        }
        return true;
    }

    // 根据位置和出生点分配构建节点实体数组
    private static buildNodes(
        positions: Vec2Data[],
        nodeCount: number,
        playerNodeId: number,
        aiNodeIds: number[],
    ): NodeEntity[] {
        const aiSet = new Set(aiNodeIds);// AI出生点ID集合，便于快速判断
        const nodes: NodeEntity[] = [];
        // 遍历所有节点ID，分配归属、等级和驻军数量
        for (let i = 0; i < nodeCount; i++) {
            let ownerId: OwnerType;// 节点归属
            let garrisonCount: number;// 初始驻军数量
            if (i === playerNodeId) {// 玩家出生点
                ownerId = OwnerType.PLAYER;
                garrisonCount = GameConfig.INITIAL_SOLDIERS;
            } else if (aiSet.has(i)) {// AI出生点
                ownerId = OwnerType.AI;
                garrisonCount = GameConfig.INITIAL_SOLDIERS;
            } else {// 中立节点
                ownerId = OwnerType.NEUTRAL;
                // 中立节点随机等级和对应驻军
                const level = MapGenerator.randomNeutralLevel();
                garrisonCount = NodeConfig.NEUTRAL_GARRISON[level];
                const node = new NodeEntity(i, ownerId, level, NodeType.NORMAL, SpecialNodeType.NONE, garrisonCount, positions[i]);
                nodes.push(node);
                continue;
            }
            // 玩家/AI初始节点均为1级
            const node = new NodeEntity(i, ownerId, NodeLevel.LV1, NodeType.NORMAL, SpecialNodeType.NONE, garrisonCount, positions[i]);
            nodes.push(node);
        }
        return nodes;
    }

    // 随机产出中立节点等级（1/2/3），2级最多，1级其次，3级最少
    private static randomNeutralLevel(): NodeLevel {
        const r = Math.random();
        if (r < 0.5) return NodeLevel.LV1;
        if (r < 0.85) return NodeLevel.LV2;
        return NodeLevel.LV3;
    }

    // 分配特殊节点属性（金矿/军营/高地），避开出生点
    private static assignSpecialNodes(
        nodes: NodeEntity[],
        adjList: number[][],
        playerNodeId: number,
        aiNodeIds: number[],
    ): void {
        const birthSet = new Set([playerNodeId, ...aiNodeIds]);
        const neutralIds = nodes.filter(n => n.ownerId === OwnerType.NEUTRAL).map(n => n.id);
        // 特殊节点数量约占中立节点的15%
        const specialCount = Math.max(1, Math.floor(neutralIds.length * 0.15));
        const specialTypes = [SpecialNodeType.GOLD_MINE, SpecialNodeType.BARRACKS, SpecialNodeType.HIGHLAND];
        // 洗牌 fisher-yates shuffle
        for (let i = neutralIds.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [neutralIds[i], neutralIds[j]] = [neutralIds[j], neutralIds[i]];
        }
        let assigned = 0;// 已分配特殊节点数量
        for (const nid of neutralIds) {
            if (assigned >= specialCount) break;
            if (birthSet.has(nid)) continue;
            const type = specialTypes[Math.floor(Math.random() * specialTypes.length)];
            nodes[nid].specialType = type;
            assigned++;
        }
    }

    // 兜底生成：当约束算法50次都失败时，不验证出生点平衡直接生成
    private static fallbackGenerate(params: MapGenerateParams): MapGenerateResult {
        console.warn('MapGenerator: Failed to generate balanced map after multiple attempts, using fallback generation.');
        // 直接生成位置
        const positions = MapGenerator.generatePositions(params);
        // 生成MST
        let edges = MapGenerator.buildMST(positions, params.nodeCount);
        // 添加额外边
        edges = MapGenerator.addExtraEdges(edges, positions, params.nodeCount);
        // 简单取分散ID作为出生点
        const step = Math.floor(params.nodeCount / (params.aiCount + 1));
        const birthIds: number[] = [];
        for (let i = 0; i <= params.aiCount; i++) {
            birthIds.push(i * step);
        }
        const playerNodeId = birthIds[0];
        const aiNodeIds = birthIds.slice(1);
        const nodes = MapGenerator.buildNodes(positions, params.nodeCount, playerNodeId, aiNodeIds);
        MapGenerator._adjList = MapGenerator.buildAdjList(edges, params.nodeCount);
        MapGenerator.assignSpecialNodes(nodes, MapGenerator.adjList, playerNodeId, aiNodeIds);
        return new MapGenerateResult(nodes, edges, playerNodeId, aiNodeIds);
    }
}
