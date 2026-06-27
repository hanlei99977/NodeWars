import { NodeEntity } from '../entity/NodeEntity';
import { EdgeEntity } from '../entity/EdgeEntity';
import { ArmyEntity } from '../entity/ArmyEntity';
import { NodeType, OwnerType, Difficulty, AIAllianceState } from '../config/EnumDefine';
import { AIConfig } from '../config/AIConfig';
import { RecruitConfig } from '../config/RecruitConfig';
import { NodeConfig } from '../config/NodeConfig';
import { NodeBattleSystem } from '../battle/NodeBattleSystem';
import { EconomySystem } from '../economy/EconomySystem';
import { RecruitSystem } from '../recruit/RecruitSystem';
import { NodeUpgradeSystem } from '../manager/NodeUpgradeSystem';
import { NodeConvertSystem } from '../manager/NodeConvertSystem';
import { EdgeUpgradeSystem } from '../manager/EdgeUpgradeSystem';
import { ArmyManager } from '../manager/ArmyManager';
import { PathfindingManager } from '../manager/PathfindingManager';

// AI思考结果（供外层记录日志/调试）
export class AIThinkResult {
    aiId: string;
    action: string;
    detail: string;

    constructor(aiId: string, action: string, detail: string) {
        this.aiId = aiId;
        this.action = action;
        this.detail = detail;
    }
}

// AI控制器，管理所有AI的决策、联盟状态机和自动建筑转换
export class AIController {

    private static _aiIds: string[] = [];
    private static _difficulty: Difficulty = Difficulty.EASY;
    private static _thinkTimer: Map<string, number> = new Map();          // aiId → 距下次思考剩余秒数
    private static _thinkInterval = 3;                                    // 思考间隔(秒)
    private static _allianceState: AIAllianceState = AIAllianceState.FREE;// AI联盟状态
    private static _playerId = OwnerType.PLAYER;
    private static _nodes: NodeEntity[] = [];
    private static _edges: EdgeEntity[] = [];
    private static _adjList: number[][] = [];

    // 初始化AI：设置AI ID列表和难度
    static init(aiIds: string[], difficulty: Difficulty, nodes: NodeEntity[], edges: EdgeEntity[]): void {
        AIController._aiIds = aiIds;
        AIController._difficulty = difficulty;
        AIController._allianceState = AIAllianceState.FREE;
        AIController._nodes = nodes;
        AIController._edges = edges;
        AIController._thinkTimer.clear();
        for (const aiId of aiIds) {
            // 错开首次思考时间
            AIController._thinkTimer.set(aiId, Math.random() * AIController._thinkInterval);
        }
        // 构建邻接表
        AIController._adjList = Array.from({ length: nodes.length }, () => []);
        for (const e of edges) {
            AIController._adjList[e.nodeAId].push(e.nodeBId);
            AIController._adjList[e.nodeBId].push(e.nodeAId);
        }
    }

    // 获取当前联盟状态
    static get allianceState(): AIAllianceState {
        return AIController._allianceState;
    }

    // 每帧AI更新，传入逻辑时间增量 dt 秒
    // 更新联盟状态 + 逐个AI决策
    // 返回值是AI的行为
    static update(dt: number, nodes: NodeEntity[], edges: EdgeEntity[], armies: ArmyEntity[]): AIThinkResult[] {
        AIController._nodes = nodes;
        AIController._edges = edges;
        const results: AIThinkResult[] = [];

        // 更新联盟状态
        AIController.updateAlliance(nodes);

        for (const aiId of AIController._aiIds) {
            const remaining = (AIController._thinkTimer.get(aiId) || 0) - dt;//计算距离下一次思考的时间
            if (remaining <= 0) {
                AIController._thinkTimer.set(aiId, AIController._thinkInterval);
                const result = AIController.aiThink(aiId, nodes, edges);
                if (result) results.push(result);
            } else {
                AIController._thinkTimer.set(aiId, remaining);
            }
        }

        return results;
    }

    // 更新联盟状态机
    private static updateAlliance(nodes: NodeEntity[]): void {
        const totalNodes = nodes.length;
        const playerNodes = nodes.filter(n => n.ownerId === AIController._playerId).length;
        const ratio = playerNodes / totalNodes;

        if (AIController._allianceState === AIAllianceState.FREE && ratio >= AIConfig.ALLIANCE_THRESHOLD) {
            AIController._allianceState = AIAllianceState.ALLIED;
        }
        if (AIController._allianceState === AIAllianceState.ALLIED && ratio >= AIConfig.JOINT_ATTACK_THRESHOLD) {
            AIController._allianceState = AIAllianceState.JOINT_ATTACK;
        }
        if ((AIController._allianceState === AIAllianceState.ALLIED ||
             AIController._allianceState === AIAllianceState.JOINT_ATTACK) &&
            ratio <= AIConfig.DISBAND_THRESHOLD) {
            AIController._allianceState = AIAllianceState.FREE;
        }
    }

    // 单个AI的一次思考
    // 返回行为 和 详情
    private static aiThink(
        aiId: string,
        nodes: NodeEntity[],
        edges: EdgeEntity[],
    ): AIThinkResult | null {
        const result = new AIThinkResult(aiId, 'idle', '');
        // 获取当前AI的所有节点
        const ownNodes = nodes.filter(n => n.ownerId === aiId);
        if (ownNodes.length === 0) {
            result.action = 'dead';
            result.detail = '无节点';
            return result;
        }

        // 1.自动建筑转换：前线→要塞，后方→市场
        AIController.autoConvertBuildings(aiId, nodes);

        // 2.征兵
        AIController.autoRecruit(aiId, nodes);

        // 3.升级节点和线路
        AIController.autoUpgrade(aiId, nodes, edges);

        // 4.攻击决策（按难度不同）
        const attackInfo = AIController.decideAttack(aiId, nodes);
        if (attackInfo) {
            const { sourceNodeId, targetNodeId, soldierCount } = attackInfo;

            // 从源节点扣兵并发兵
            const sourceNode = nodes[sourceNodeId];
            if (sourceNode && sourceNode.garrisonCount >= soldierCount) {
                sourceNode.garrisonCount -= soldierCount;
                const path = PathfindingManager.findPath(sourceNodeId, targetNodeId);
                if (path && path.length >= 2) {
                    ArmyManager.createArmy(aiId as OwnerType, soldierCount, path);
                    result.action = 'attack';
                    result.detail = `从#${sourceNodeId} 派${soldierCount}兵 → #${targetNodeId}`;
                } else {
                    // 寻路失败，退回兵力
                    sourceNode.garrisonCount += soldierCount;
                }
            }
        } else {
            result.action = 'defend';
            result.detail = '无好的攻击目标';
        }

        return result;
    }

    // 自动建筑转换：有敌军相邻节点 → 要塞，无敌军相邻 → 市场
    private static autoConvertBuildings(aiId: string, nodes: NodeEntity[]): void {
        const ownNodes = nodes.filter(n => n.ownerId === aiId);
        for (const node of ownNodes) {
            if (!node.isIdle) continue; // 忙碌中跳过

            const hasEnemyNeighbor = AIController.hasEnemyNeighbor(node.id, aiId, nodes);
            const targetType = hasEnemyNeighbor ? NodeType.FORTRESS : NodeType.MARKET;
            if (node.type === targetType) continue; // 已是目标类型

            // 金币够才转换
            if (EconomySystem.canAfford(aiId, NodeConfig.CONVERT_GOLD)) {
                NodeConvertSystem.startConvert(node, targetType, aiId);
            }
        }
    }

    // 自动征兵：每个己方节点尽量征兵（征兵队列未满、金币够）
    private static autoRecruit(aiId: string, nodes: NodeEntity[]): void {
        const ownNodes = nodes.filter(n => n.ownerId === aiId);
        const AFFORD_RESERVE = 50; // 保留金币以备用

        for (const node of ownNodes) {
            if (node.isRecruitQueueFull) continue;
            const goldAfter = EconomySystem.getGold(aiId) - RecruitConfig.GOLD_COST;
            if (goldAfter < AFFORD_RESERVE) break;
            RecruitSystem.startRecruit(node, aiId);
        }
    }

    // 自动升级节点和线路：后方节点优先升级，己方线路升级
    private static autoUpgrade(aiId: string, nodes: NodeEntity[], edges: EdgeEntity[]): void {
        NodeUpgradeSystem.batchUpgrade(nodes, 'all', aiId, AIController._adjList);
        EdgeUpgradeSystem.batchUpgrade(edges, nodes, aiId);
    }

    // 攻击决策：根据难度选择不同策略
    // 返回值是 {攻击节点，目标节点，士兵数量}
    private static decideAttack(
        aiId: string,
        nodes: NodeEntity[],
    ): { sourceNodeId: number; targetNodeId: number; soldierCount: number } | null {
        switch (AIController._difficulty) {
            case Difficulty.EASY: return AIController.decideAttackEasy(aiId, nodes);
            case Difficulty.NORMAL: return AIController.decideAttackNormal(aiId, nodes);
            case Difficulty.HARD: return AIController.decideAttackHard(aiId, nodes);
        }
    }

    // 简单AI：无脑扩张，选最近的非己方节点攻击，派半数驻军
    private static decideAttackEasy(
        aiId: string,
        nodes: NodeEntity[],
    ): { sourceNodeId: number; targetNodeId: number; soldierCount: number } | null {
        const ownNodes = nodes.filter(n => n.ownerId === aiId && n.garrisonCount >= 10);
        if (ownNodes.length === 0) return null;

        // 收集所有可达的非己方节点
        const targets = AIController.getValidTargets(aiId, nodes);
        if (targets.length === 0) return null;

        // 找最近的源→目标对
        let bestSource: NodeEntity | null = null;
        let bestTarget: NodeEntity | null = null;
        let bestDist = Infinity;

        for (const src of ownNodes) {
            for (const tgt of targets) {
                const path = PathfindingManager.findPath(src.id, tgt.id);
                if (!path || path.length < 2) continue;
                if (path.length < bestDist) {
                    bestDist = path.length;
                    bestSource = src;
                    bestTarget = tgt;
                }
            }
        }

        if (!bestSource || !bestTarget) return null;

        return {
            sourceNodeId: bestSource.id,
            targetNodeId: bestTarget.id,
            soldierCount: Math.floor(bestSource.garrisonCount * 0.5),
        };
    }

    // 普通AI：优先攻击弱节点（驻军少的），派足够攻占的兵力 + 余量
    private static decideAttackNormal(
        aiId: string,
        nodes: NodeEntity[],
    ): { sourceNodeId: number; targetNodeId: number; soldierCount: number } | null {
        const ownNodes = nodes.filter(n => n.ownerId === aiId && n.garrisonCount >= 10);
        if (ownNodes.length === 0) return null;
        // 获取所有可攻击目标
        const targets = AIController.getValidTargets(aiId, nodes);
        if (targets.length === 0) return null;

        // 按等效防御力升序，优先攻击弱节点
        targets.sort((a, b) => NodeBattleSystem.getEffectiveDefense(a) - NodeBattleSystem.getEffectiveDefense(b));

        const MARGIN_RATIO = 1.2; // 出兵余量（多带20%）
        for (const tgt of targets) {
            const required = NodeBattleSystem.getRequiredAttackers(tgt);
            const sendCount = Math.ceil(required * MARGIN_RATIO);

            // 找最近的足够兵力的己方节点
            let bestSrc: NodeEntity | null = null;
            let bestDist = Infinity;
            for (const src of ownNodes) {
                if (src.garrisonCount < sendCount) continue;// 节点军队数量不足
                const path = PathfindingManager.findPath(src.id, tgt.id);
                if (!path || path.length < 2) continue;
                // 找到最近的源节点
                if (path.length < bestDist) {
                    bestDist = path.length;
                    bestSrc = src;
                }
            }
            if (bestSrc) {
                return {
                    sourceNodeId: bestSrc.id,
                    targetNodeId: tgt.id,
                    soldierCount: sendCount,
                };
            }
        }
        return null;
    }

    // 困难AI：综合评判收益/防御/距离，选最优目标
    private static decideAttackHard(
        aiId: string,
        nodes: NodeEntity[],
    ): { sourceNodeId: number; targetNodeId: number; soldierCount: number } | null {
        const ownNodes = nodes.filter(n => n.ownerId === aiId && n.garrisonCount >= 10);
        if (ownNodes.length === 0) return null;

        const targets = AIController.getValidTargets(aiId, nodes);
        if (targets.length === 0) return null;

        // 对每个目标计算得分
        const scored: { target: NodeEntity; score: number }[] = [];
        for (const tgt of targets) {
            const required = NodeBattleSystem.getRequiredAttackers(tgt);
            const income = EconomySystem.getNodeIncome(tgt);
            const cost = required * RecruitConfig.MILITARY_GOLD_COST_RATE;

            // 找最近且有足够兵力的源节点
            let bestDist = Infinity;
            let bestSrcGarrison = 0;
            for (const src of ownNodes) {
                if (src.garrisonCount < required) continue;
                const path = PathfindingManager.findPath(src.id, tgt.id);
                if (!path || path.length < 2) continue;
                if (path.length < bestDist) {
                    bestDist = path.length;
                    bestSrcGarrison = src.garrisonCount;
                }
            }
            if (bestDist === Infinity) continue; // 不可达

            // 综合得分 = 收益 - 损耗 - 距离惩罚
            const distPenalty = bestDist * 0.5;
            const score = income * 10 - cost - distPenalty;
            scored.push({ target: tgt, score });
        }

        if (scored.length === 0) return null;

        // 选最高分目标
        scored.sort((a, b) => b.score - a.score);
        const bestTarget = scored[0].target;

        // 再找最佳源节点发兵
        const required = NodeBattleSystem.getRequiredAttackers(bestTarget);
        let bestSrc: NodeEntity | null = null;
        let bestDist = Infinity;
        for (const src of ownNodes) {
            if (src.garrisonCount < required) continue;
            const path = PathfindingManager.findPath(src.id, bestTarget.id);
            if (!path || path.length < 2) continue;
            if (path.length < bestDist) {
                bestDist = path.length;
                bestSrc = src;
            }
        }
        if (!bestSrc) return null;

        return {
            sourceNodeId: bestSrc.id,
            targetNodeId: bestTarget.id,
            soldierCount: required,
        };
    }

    // 获取有效的攻击目标（非己方、非同盟AI、有路径可达）
    private static getValidTargets(aiId: string, nodes: NodeEntity[]): NodeEntity[] {
        return nodes.filter(n => {
            if (n.ownerId === aiId) return false;                    // 不是己方
            if (n.ownerId === OwnerType.NEUTRAL) return true;        // 中立节点总是可攻击
            // 同盟状态下不攻击其他AI
            if (AIController._allianceState !== AIAllianceState.FREE && n.ownerId !== AIController._playerId) {
                return false;
            }
            return true;
        });
    }

    // 检查某节点是否有敌军相邻（用于建筑转换判断）
    private static hasEnemyNeighbor(nodeId: number, aiId: string, nodes: NodeEntity[]): boolean {
        // 遍历与当前节点连接的节点
        for (const nb of AIController._adjList[nodeId]) {
            const neighbor = nodes[nb];
            if (!neighbor) continue;
            if (neighbor.ownerId === OwnerType.NEUTRAL) continue;
            if (neighbor.ownerId === aiId) continue;
            // 同盟时不把其他AI视为敌人
            if (AIController._allianceState !== AIAllianceState.FREE) {
                if (neighbor.ownerId !== AIController._playerId) continue;
            }
            return true;
        }
        return false;
    }
}
