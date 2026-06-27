import { EdgeEntity } from '../entity/EdgeEntity';
import { NodeEntity } from '../entity/NodeEntity';

/**
 * 寻路管理器，负责地图图结构维护和路径查找
 *
 * 职责：
 *   - 维护边映射表（快速查找两节点间的边）
 *   - 维护邻接表（BFS 寻路所需）
 *   - 提供 BFS 最短路径查找
 *
 * 注意：这是一个纯静态工具类，不持有 Cocos 组件
 */
export class PathfindingManager {

    /** 边映射表，key = "minId_maxId"，value = EdgeEntity，用于快速查找两节点间的边 */
    private static _edgesMap: Map<string, EdgeEntity> = new Map();

    /** 邻接表，adjList[i] = [j, k, ...] 表示节点 i 与节点 j, k 相邻 */
    private static _adjList: number[][] = [];

    /** 地图节点总数 */
    private static _nodeCount = 0;

    /**
     * 初始化：绑定地图的边和节点，构建邻接表和边查询映射
     *
     * @param edges  地图所有边实体
     * @param nodes  地图所有节点实体
     * @returns 无
     */
    static init(edges: EdgeEntity[], nodes: NodeEntity[]): void {
        PathfindingManager._edgesMap.clear();
        PathfindingManager._nodeCount = nodes.length;

        // 构建边映射 key = "minId_maxId"
        for (const e of edges) {
            const minId = Math.min(e.nodeAId, e.nodeBId);
            const maxId = Math.max(e.nodeAId, e.nodeBId);
            PathfindingManager._edgesMap.set(`${minId}_${maxId}`, e);
        }

        // 构建邻接表
        PathfindingManager._adjList = Array.from({ length: nodes.length }, () => []);
        for (const e of edges) {
            PathfindingManager._adjList[e.nodeAId].push(e.nodeBId);
            PathfindingManager._adjList[e.nodeBId].push(e.nodeAId);
        }
    }

    /** 获取邻接表 */
    static get adjList(): number[][] {
        return PathfindingManager._adjList;
    }

    /**
     * 根据两节点ID查找连接它们的边
     *
     * @param nodeAId  节点A的ID
     * @param nodeBId  节点B的ID
     * @returns 找到的 EdgeEntity，无则返回 null
     */
    static findEdge(nodeAId: number, nodeBId: number): EdgeEntity | null {
        const minId = Math.min(nodeAId, nodeBId);
        const maxId = Math.max(nodeAId, nodeBId);
        return PathfindingManager._edgesMap.get(`${minId}_${maxId}`) || null;
    }

    /**
     * 依邻接表更新（边拆分/替换后调用）
     *
     * @param edges     更新后的边列表
     * @param nodeCount 更新后的节点总数
     * @returns 无
     */
    static updateAdjList(edges: EdgeEntity[], nodeCount: number): void {
        PathfindingManager._adjList = Array.from({ length: nodeCount }, () => []);
        for (const e of edges) {
            PathfindingManager._adjList[e.nodeAId].push(e.nodeBId);
            PathfindingManager._adjList[e.nodeBId].push(e.nodeAId);
        }
    }

    /**
     * BFS 查找两节点间最短路径（跳数最少）
     *
     * @param fromNodeId  起始节点ID
     * @param toNodeId    目标节点ID
     * @returns 节点ID序列（从 fromNodeId 到 toNodeId 经过的节点），不可达返回 null
     */
    static findPath(fromNodeId: number, toNodeId: number): number[] | null {
        if (fromNodeId === toNodeId) return [fromNodeId];
        if (fromNodeId < 0 || fromNodeId >= PathfindingManager._nodeCount) return null;
        if (toNodeId < 0 || toNodeId >= PathfindingManager._nodeCount) return null;

        const visited = new Array<boolean>(PathfindingManager._nodeCount).fill(false);
        const parent = new Array<number>(PathfindingManager._nodeCount).fill(-1);
        const queue: number[] = [fromNodeId];
        visited[fromNodeId] = true;
        let head = 0;

        while (head < queue.length) {
            const cur = queue[head++];
            for (const nb of PathfindingManager._adjList[cur]) {
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
}