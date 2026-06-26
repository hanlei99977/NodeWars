import { NodeEntity, RecruitTask } from '../entity/NodeEntity';
import { SpecialNodeType, RecruitTaskState, OwnerType, RecruitEventType } from '../config/EnumDefine';
import { RecruitConfig } from '../config/RecruitConfig';
import { NodeConfig } from '../config/NodeConfig';
import { EconomySystem } from '../economy/EconomySystem';
import { EventSystem } from '../event/EventSystem';

// 征兵事件数据
export class RecruitEvent {
    type: RecruitEventType;
    nodeId: number;            // 相关节点ID
    soldierCount?: number;     // 完成时新增的士兵数

    constructor(type: RecruitEventType, nodeId: number, soldierCount?: number) {
        this.type = type;
        this.nodeId = nodeId;
        this.soldierCount = soldierCount;
    }
}

// 征兵系统，负责征兵队列管理、训练进度推进和结算，纯逻辑层
export class RecruitSystem {

    // 在指定节点上发起征兵（count 士兵，count 金币）
    static startRecruit(node: NodeEntity, ownerId: string, count: number = RecruitConfig.SOLDIER_COUNT): RecruitEvent {
        if (count <= 0) return new RecruitEvent(RecruitEventType.INSUFFICIENT_GOLD, node.id);

        const cost = count;

        if (node.recruitQueue.length >= RecruitConfig.MAX_QUEUE_PER_NODE) {
            return new RecruitEvent(RecruitEventType.QUEUE_FULL, node.id);
        }

        if (!EconomySystem.canAfford(ownerId, cost)) {
            return new RecruitEvent(RecruitEventType.INSUFFICIENT_GOLD, node.id);
        }

        EconomySystem.spend(ownerId, cost);

        const baseTimePerSoldier = RecruitConfig.TIME / RecruitConfig.SOLDIER_COUNT;
        const reduction = node.specialType === SpecialNodeType.BARRACKS
            ? (NodeConfig.SPECIAL_RECRUIT_TIME_REDUCTION[SpecialNodeType.BARRACKS] || 0)
            : 0;
        const mobilizationMultiplier = EventSystem.getWarMobilizationMultiplier(ownerId);
        const actualTime = baseTimePerSoldier * count * (1 - reduction) * mobilizationMultiplier;

        const task = new RecruitTask(count, actualTime);
        node.recruitQueue.push(task);

        return new RecruitEvent(RecruitEventType.STARTED, node.id, count);
    }

    // 每帧推进所有节点的征兵队列，传入逻辑时间增量 dt 秒
    // 返回本帧产生的征兵完成事件列表
    static update(dt: number, nodes: NodeEntity[]): RecruitEvent[] {
        const events: RecruitEvent[] = [];

        for (const node of nodes) {
            if (node.ownerId === OwnerType.NEUTRAL) continue;
            if (node.recruitQueue.length === 0) continue;

            // 队列中第一个任务正在训练，后续等待
            const currentTask = node.recruitQueue[0];
            if (currentTask.state === RecruitTaskState.PENDING) {
                currentTask.state = RecruitTaskState.IN_PROGRESS;
            }
            // 只有正在训练的任务才推进进度
            if (currentTask.state !== RecruitTaskState.IN_PROGRESS) continue;

            // 推进训练进度
            currentTask.progress += dt;

            if (currentTask.progress >= currentTask.totalTime) {
                // 训练完成：增加驻军，移除已完成的任务
                node.garrisonCount += currentTask.soldierCount;
                node.recruitQueue.shift();

                events.push(new RecruitEvent(
                    RecruitEventType.COMPLETED,
                    node.id,
                    currentTask.soldierCount,
                ));

                // 如果队列中还有后续任务，下一个自动开始训练
                if (node.recruitQueue.length > 0) {
                    const nextTask = node.recruitQueue[0];
                    nextTask.state = RecruitTaskState.IN_PROGRESS;
                }
            }
        }

        return events;
    }
}
