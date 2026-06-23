import { EdgeLevel } from '../config/EnumDefine';

// 线路实体（纯数据容器，表示地图上连接两个节点的一条边）
export class EdgeEntity {

    id: number;                 // 线路唯一ID
    nodeAId: number;            // 端点A的节点ID
    nodeBId: number;            // 端点B的节点ID
    length: number;             // 线路长度（像素/米）
    level: EdgeLevel;           // 线路等级 1/2/3（影响移速加成）

    constructor(
        id: number,
        nodeAId: number,
        nodeBId: number,
        length: number,
        level: EdgeLevel = EdgeLevel.LV1,
    ) {
        this.id = id;
        this.nodeAId = nodeAId;
        this.nodeBId = nodeBId;
        this.length = length;
        this.level = level;
    }

    // 判断给定节点ID是否为此边的一个端点
    hasNode(nodeId: number): boolean {
        return this.nodeAId === nodeId || this.nodeBId === nodeId;
    }

    // 获取另一个端点ID，若nodeId不在此边上则返回-1
    getOtherEnd(nodeId: number): number {
        if (this.nodeAId === nodeId) return this.nodeBId;
        if (this.nodeBId === nodeId) return this.nodeAId;
        return -1;
    }
}
