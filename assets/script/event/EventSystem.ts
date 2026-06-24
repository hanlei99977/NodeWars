import { EventType } from '../config/EnumDefine';
import { EconomySystem } from '../economy/EconomySystem';
import { NodeEntity } from '../entity/NodeEntity';

// 随机事件结果
export class GameEventResult {
    eventType: EventType;           // 事件类型
    targetOwnerId: string;          // 受影响的owner（HARVEST为全局ALL，WAR_MOBILIZATION为随机选中的一方）
    magnitude: number;              // 事件量（金币数 / 动员时间缩减比例）
    duration: number;               // 事件持续秒数（瞬时事件为0）

    constructor(eventType: EventType, targetOwnerId: string, magnitude: number, duration: number) {
        this.eventType = eventType;
        this.targetOwnerId = targetOwnerId;
        this.magnitude = magnitude;
        this.duration = duration;
    }
}

// 随机事件系统，负责定时触发丰收/战争动员等全局随机事件，纯逻辑层
export class EventSystem {

    private static _nextEventTime = 0;           // 距下次事件剩余秒数
    private static _eventIntervalMin = 45;       // 事件最小间隔(秒)
    private static _eventIntervalMax = 120;      // 事件最大间隔(秒)
    private static _activeEffects: Map<string, number> = new Map(); // ownerId → 剩余动员加速秒数
    private static _totalTime = 0;

    // 初始化：随机事件触发时间
    static init(): void {
        EventSystem._totalTime = 0;
        EventSystem._activeEffects.clear();
        EventSystem._nextEventTime = EventSystem.randomInterval();
    }

    // 获取指定方的当前战争动员加速系数（无动员时返回1.0）
    static getWarMobilizationMultiplier(ownerId: string): number {
        const remaining = EventSystem._activeEffects.get(ownerId) || 0;
        return remaining > 0 ? 0.5 : 1.0;
    }

    // 每帧更新，传入逻辑时间增量 dt 秒和所有参与经济的owner列表
    // 返回本帧触发的随机事件列表
    static update(dt: number, ownerIds: string[]): GameEventResult[] {
        EventSystem._totalTime += dt;
        const results: GameEventResult[] = [];

        // 倒计时活动效果
        const expiredKeys: string[] = [];
        for (const [ownerId, remaining] of EventSystem._activeEffects.entries()) {
            const newRemaining = remaining - dt;
            if (newRemaining <= 0) {
                expiredKeys.push(ownerId);
            } else {
                EventSystem._activeEffects.set(ownerId, newRemaining);
            }
        }
        for (const key of expiredKeys) {
            EventSystem._activeEffects.delete(key);
        }

        // 检查是否触发新一轮事件
        EventSystem._nextEventTime -= dt;
        if (EventSystem._nextEventTime <= 0) {
            EventSystem._nextEventTime = EventSystem.randomInterval();
            const result = EventSystem.triggerRandomEvent(ownerIds);
            if (result) results.push(result);
        }

        return results;
    }

    // 随机触发一个事件
    private static triggerRandomEvent(ownerIds: string[]): GameEventResult | null {
        if (ownerIds.length === 0) return null;

        // 50%丰收 / 50%战争动员
        const roll = Math.random();
        if (roll < 0.5) {
            return EventSystem.triggerHarvest(ownerIds);
        } else {
            return EventSystem.triggerWarMobilization(ownerIds);
        }
    }

    // 丰收事件：所有AI和玩家按节点数量获得额外金币（每节点3~8金币）一次性获得
    private static triggerHarvest(ownerIds: string[]): GameEventResult | null {
        let totalGold = 0;
        for (const ownerId of ownerIds) {
            const income = EconomySystem.getTotalIncome(ownerId, EventSystem._cachedNodes || []);
            // 丰收奖励 = 当前秒产出 × (5~15) 倍
            const bonus = Math.floor(income * (5 + Math.random() * 10));
            EconomySystem.addGold(ownerId, bonus);
            totalGold += bonus;
        }

        if (totalGold <= 0) return null;
        return new GameEventResult(EventType.HARVEST, 'ALL', totalGold, 0);
    }

    // 战争动员事件：所有方征兵时间减半，持续15~30秒
    private static triggerWarMobilization(ownerIds: string[]): GameEventResult | null {
        if (ownerIds.length === 0) return null;

        const duration = 15 + Math.random() * 15;
        for (const ownerId of ownerIds) {
            EventSystem._activeEffects.set(ownerId, duration);
        }

        return new GameEventResult(EventType.WAR_MOBILIZATION, 'ALL', 0.5, duration);
    }

    // 生成随机事件间隔
    private static randomInterval(): number {
        return EventSystem._eventIntervalMin + Math.random() * (EventSystem._eventIntervalMax - EventSystem._eventIntervalMin);
    }

    // 节点缓存，供harvest时计算收入（外部每帧调用updateNodes更新）
    private static _cachedNodes: NodeEntity[] = [];
    static updateNodes(nodes: NodeEntity[]): void {
        EventSystem._cachedNodes = nodes;
    }
}
