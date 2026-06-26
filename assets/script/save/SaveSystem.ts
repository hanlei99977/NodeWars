import { sys } from 'cc';
import { NodeEntity, UpgradeTask, ConvertTask, RecruitTask, Vec2Data } from '../entity/NodeEntity';
import { EdgeEntity } from '../entity/EdgeEntity';
import { ArmyEntity } from '../entity/ArmyEntity';
import {
    NodeLevel, NodeType, SpecialNodeType, OwnerType,
    EdgeLevel, Difficulty, MapSize, FogMode,
    UpgradeTaskState, ConvertTaskState, RecruitTaskState, ArmyState,
} from '../config/EnumDefine';
import { EconomySystem } from '../economy/EconomySystem';

// 可序列化的节点数据（不含引擎引用）
interface NodeSaveData {
    id: number;
    ownerId: string;
    level: number;
    type: string;
    specialType: string;
    garrisonCount: number;
    autoRecruitThreshold: number;
    x: number;
    y: number;
    upgradeTask: { targetLevel: number; state: string; progress: number; totalTime: number } | null;
    convertTask: { targetType: string; state: string; progress: number; totalTime: number } | null;
    recruitQueue: { soldierCount: number; state: string; progress: number; totalTime: number }[];
}

interface EdgeSaveData {
    id: number;
    nodeAId: number;
    nodeBId: number;
    length: number;
    level: number;
}

interface ArmySaveData {
    id: number;
    ownerId: string;
    soldierCount: number;
    pathNodeIds: number[];
    currentEdgeIndex: number;
    progress: number;
    pendingDestinationNodeId: number | null;
    state: string;
    totalSoldiersLost: number;
}

// 完整存档数据
export interface SaveData {
    version: number;
    timestamp: number;
    mapSize: string;
    difficulty: string;
    fogMode: string;
    gameSpeed: number;
    totalTime: number;
    playerNodeId: number;
    aiNodeIds: number[];
    nextArmyId: number;
    nodes: NodeSaveData[];
    edges: EdgeSaveData[];
    armies: ArmySaveData[];
    goldData: Record<string, number>;
    aiThinkTimers: Record<string, number>;
}

// 存档槽位元数据（不包含完整数据，用于存档列表展示）
export interface SaveSlotMeta {
    slotId: number;
    isEmpty: boolean;
    timestamp: number;
    mapSize: string;
    difficulty: string;
    totalTime: number;
    playerNodeCount: number;
}

// 存档系统，负责游戏状态的序列化/反序列化、槽位管理、自动保存
export class SaveSystem {

    static readonly MAX_SLOTS = 3;
    static readonly SLOT_PREFIX = 'nodewars_save_';
    static readonly META_PREFIX = 'nodewars_meta_';

    // 获取所有存档槽位的元数据列表
    static getSlotList(): SaveSlotMeta[] {
        const slots: SaveSlotMeta[] = [];
        for (let i = 0; i < SaveSystem.MAX_SLOTS; i++) {
            slots.push(SaveSystem.getSlotMeta(i));
        }
        return slots;
    }

    // 获取单个槽位的元数据
    static getSlotMeta(slotId: number): SaveSlotMeta {
        const metaStr = sys.localStorage.getItem(SaveSystem.META_PREFIX + slotId);
        if (!metaStr) {
            return { slotId, isEmpty: true, timestamp: 0, mapSize: '', difficulty: '', totalTime: 0, playerNodeCount: 0 };
        }
        try {
            const meta = JSON.parse(metaStr) as SaveSlotMeta;
            meta.slotId = slotId;
            meta.isEmpty = false;
            return meta;
        } catch {
            return { slotId, isEmpty: true, timestamp: 0, mapSize: '', difficulty: '', totalTime: 0, playerNodeCount: 0 };
        }
    }

    // 保存游戏到指定槽位
    // 收集所有系统的当前状态，序列化为JSON存入localStorage
    static save(
        slotId: number,
        nodes: NodeEntity[],
        edges: EdgeEntity[],
        armies: ArmyEntity[],
        mapSize: MapSize,
        difficulty: Difficulty,
        fogMode: FogMode,
        gameSpeed: number,
        totalTime: number,
        playerNodeId: number,
        aiNodeIds: number[],
        nextArmyId: number,
        aiThinkTimers: Record<string, number>,
    ): boolean {
        const data: SaveData = {
            version: 1,
            timestamp: Date.now(),
            mapSize,
            difficulty,
            fogMode,
            gameSpeed,
            totalTime,
            playerNodeId,
            aiNodeIds,
            nextArmyId,
            nodes: SaveSystem.serializeNodes(nodes),
            edges: SaveSystem.serializeEdges(edges),
            armies: SaveSystem.serializeArmies(armies),
            goldData: SaveSystem.serializeGold(),
            aiThinkTimers,
        };

        try {
            const jsonStr = JSON.stringify(data);
            sys.localStorage.setItem(SaveSystem.SLOT_PREFIX + slotId, jsonStr);

            // 写元数据
            const meta: SaveSlotMeta = {
                slotId,
                isEmpty: false,
                timestamp: data.timestamp,
                mapSize,
                difficulty,
                totalTime,
                playerNodeCount: nodes.filter(n => n.ownerId === OwnerType.PLAYER).length,
            };
            sys.localStorage.setItem(SaveSystem.META_PREFIX + slotId, JSON.stringify(meta));

            return true;
        } catch {
            return false;
        }
    }

    // 从指定槽位加载游戏数据
    static load(slotId: number): SaveData | null {
        const jsonStr = sys.localStorage.getItem(SaveSystem.SLOT_PREFIX + slotId);
        if (!jsonStr) return null;

        try {
            const data = JSON.parse(jsonStr) as SaveData;
            return data;
        } catch {
            return null;
        }
    }

    // 将加载的SaveData还原为实体对象并写入各系统
    static restore(data: SaveData): {
        nodes: NodeEntity[];
        edges: EdgeEntity[];
        armies: ArmyEntity[];
    } {
        const nodes = SaveSystem.deserializeNodes(data.nodes);
        const edges = SaveSystem.deserializeEdges(data.edges);
        const armies = SaveSystem.deserializeArmies(data.armies);

        // 恢复经济系统
        SaveSystem.restoreGold(data.goldData);

        return { nodes, edges, armies };
    }

    // 删除指定槽位
    static deleteSlot(slotId: number): void {
        sys.localStorage.removeItem(SaveSystem.SLOT_PREFIX + slotId);
        sys.localStorage.removeItem(SaveSystem.META_PREFIX + slotId);
    }

    // --- 序列化 ---

    private static serializeNodes(nodes: NodeEntity[]): NodeSaveData[] {
        return nodes.map(n => ({
            id: n.id,
            ownerId: n.ownerId,
            level: n.level,
            type: n.type,
            specialType: n.specialType,
            garrisonCount: n.garrisonCount,
            autoRecruitThreshold: n.autoRecruitThreshold,
            x: n.position.x,
            y: n.position.y,
            upgradeTask: n.upgradeTask ? {
                targetLevel: n.upgradeTask.targetLevel,
                state: n.upgradeTask.state,
                progress: n.upgradeTask.progress,
                totalTime: n.upgradeTask.totalTime,
            } : null,
            convertTask: n.convertTask ? {
                targetType: n.convertTask.targetType,
                state: n.convertTask.state,
                progress: n.convertTask.progress,
                totalTime: n.convertTask.totalTime,
            } : null,
            recruitQueue: n.recruitQueue.map(t => ({
                soldierCount: t.soldierCount,
                state: t.state,
                progress: t.progress,
                totalTime: t.totalTime,
            })),
        }));
    }

    private static serializeEdges(edges: EdgeEntity[]): EdgeSaveData[] {
        return edges.map(e => ({
            id: e.id,
            nodeAId: e.nodeAId,
            nodeBId: e.nodeBId,
            length: e.length,
            level: e.level,
        }));
    }

    private static serializeArmies(armies: ArmyEntity[]): ArmySaveData[] {
        return armies.map(a => ({
            id: a.id,
            ownerId: a.ownerId,
            soldierCount: a.soldierCount,
            pathNodeIds: a.pathNodeIds,
            currentEdgeIndex: a.currentEdgeIndex,
            progress: a.progress,
            pendingDestinationNodeId: a.pendingDestinationNodeId,
            state: a.state,
            totalSoldiersLost: a.totalSoldiersLost,
        }));
    }

    private static serializeGold(): Record<string, number> {
        const result: Record<string, number> = {};
        for (const id of EconomySystem.allOwnerIds) {
            result[id] = EconomySystem.getGold(id);
        }
        return result;
    }

    // --- 反序列化 ---

    private static deserializeNodes(data: NodeSaveData[]): NodeEntity[] {
        return data.map(d => {
            const node = new NodeEntity(
                d.id,
                d.ownerId as OwnerType,
                d.level as NodeLevel,
                d.type as NodeType,
                d.specialType as SpecialNodeType,
                d.garrisonCount,
                new Vec2Data(d.x, d.y),
            );
            if (d.upgradeTask) {
                node.upgradeTask = new UpgradeTask(d.upgradeTask.targetLevel as NodeLevel, d.upgradeTask.totalTime);
                node.upgradeTask.state = d.upgradeTask.state as UpgradeTaskState;
                node.upgradeTask.progress = d.upgradeTask.progress;
            }
            if (d.convertTask) {
                node.convertTask = new ConvertTask(d.convertTask.targetType as NodeType, d.convertTask.totalTime);
                node.convertTask.state = d.convertTask.state as ConvertTaskState;
                node.convertTask.progress = d.convertTask.progress;
            }
            node.recruitQueue = d.recruitQueue.map(t => {
                const task = new RecruitTask(t.soldierCount, t.totalTime);
                task.state = t.state as RecruitTaskState;
                task.progress = t.progress;
                return task;
            });
            node.autoRecruitThreshold = d.autoRecruitThreshold || 0;
            return node;
        });
    }

    private static deserializeEdges(data: EdgeSaveData[]): EdgeEntity[] {
        return data.map(d => new EdgeEntity(d.id, d.nodeAId, d.nodeBId, d.length, d.level as EdgeLevel));
    }

    private static deserializeArmies(data: ArmySaveData[]): ArmyEntity[] {
        return data.map(d => {
            const army = new ArmyEntity(d.id, d.ownerId as OwnerType, d.soldierCount, d.pathNodeIds);
            army.currentEdgeIndex = d.currentEdgeIndex;
            army.progress = d.progress;
            army.pendingDestinationNodeId = d.pendingDestinationNodeId;
            army.state = d.state as ArmyState;
            army.totalSoldiersLost = d.totalSoldiersLost;
            return army;
        });
    }

    private static restoreGold(data: Record<string, number>): void {
        const keys = Object.keys(data);
        for (const key of keys) {
            EconomySystem.addGold(key, data[key] - EconomySystem.getGold(key));
        }
    }
}
