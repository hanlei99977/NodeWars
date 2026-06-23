import { NodeEntity, ConvertTask } from '../entity/NodeEntity';
import { NodeType, ConvertTaskState } from '../config/EnumDefine';
import { NodeConfig } from '../config/NodeConfig';
import { EconomySystem } from '../economy/EconomySystem';

// 转换事件类型
export enum ConvertEventType {
    STARTED = 'started',               // 转换已开始
    COMPLETED = 'completed',           // 转换完成
    INSUFFICIENT_GOLD = 'insufficient_gold', // 金币不足
    SAME_TYPE = 'same_type',           // 已是该类型，无需转换
    BUSY = 'busy',                     // 节点忙碌中（有进行中的升级/转换）
}

// 转换事件数据
export class ConvertEvent {
    type: ConvertEventType;
    nodeId: number;                    // 相关节点ID
    newType?: NodeType;                // 完成后的新类型

    constructor(type: ConvertEventType, nodeId: number, newType?: NodeType) {
        this.type = type;
        this.nodeId = nodeId;
        this.newType = newType;
    }
}

// 节点类型转换系统，负责节点在普通/要塞/市场之间转换，纯逻辑层
export class NodeConvertSystem {

    // 在指定节点上发起类型转换，扣100金币后创建ConvertTask
    static startConvert(node: NodeEntity, targetType: NodeType, ownerId: string): ConvertEvent {
        if (node.type === targetType) {
            return new ConvertEvent(ConvertEventType.SAME_TYPE, node.id);
        }

        if (!node.isIdle) {
            return new ConvertEvent(ConvertEventType.BUSY, node.id);
        }

        if (!EconomySystem.canAfford(ownerId, NodeConfig.CONVERT_GOLD)) {
            return new ConvertEvent(ConvertEventType.INSUFFICIENT_GOLD, node.id);
        }

        // 扣金币
        EconomySystem.spend(ownerId, NodeConfig.CONVERT_GOLD);

        // 创建转换任务
        node.convertTask = new ConvertTask(targetType, NodeConfig.CONVERT_TIME);
        node.convertTask.state = ConvertTaskState.IN_PROGRESS;

        return new ConvertEvent(ConvertEventType.STARTED, node.id, targetType);
    }

    // 每帧推进所有节点的转换任务，完成时修改节点类型
    // 返回本帧完成的转换事件列表
    static update(dt: number, nodes: NodeEntity[]): ConvertEvent[] {
        const events: ConvertEvent[] = [];

        for (const node of nodes) {
            const task = node.convertTask;
            if (!task || task.state === ConvertTaskState.COMPLETED) continue;
            if (task.state === ConvertTaskState.PENDING) {
                task.state = ConvertTaskState.IN_PROGRESS;
            }

            task.progress += dt;

            if (task.progress >= task.totalTime) {
                // 转换完成
                node.type = task.targetType;
                node.convertTask = null;
                events.push(new ConvertEvent(ConvertEventType.COMPLETED, node.id, node.type));
            }
        }

        return events;
    }
}
