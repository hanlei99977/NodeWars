import { EconomySystem } from '../economy/EconomySystem';
import { NodeEntity } from '../entity/NodeEntity';
import { EventBus } from '../common/EventBus';
import { GameEvents } from '../common/GameEvents';

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
    // 事件通过 EventBus 发送
    static update(dt: number, ownerIds: string[]): void {
        EventSystem._totalTime += dt;

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
            EventSystem.triggerRandomEvent(ownerIds);
        }
    }

    // 随机触发一个事件
    private static triggerRandomEvent(ownerIds: string[]): void {
        if (ownerIds.length === 0) return;

        // 50%丰收 / 50%战争动员
        const roll = Math.random();
        if (roll < 0.5) {
            EventSystem.triggerHarvest(ownerIds);
        } else {
            EventSystem.triggerWarMobilization(ownerIds);
        }
    }

    // 丰收事件：所有AI和玩家按节点数量获得额外金币
    private static triggerHarvest(ownerIds: string[]): void {
        let totalGold = 0;
        for (const ownerId of ownerIds) {
            const income = EconomySystem.getTotalIncome(ownerId, EventSystem._cachedNodes || []);
            // 丰收奖励 = 当前秒产出 × (5~15) 倍
            const bonus = Math.floor(income * (5 + Math.random() * 10));
            EconomySystem.addGold(ownerId, bonus);
            totalGold += bonus;
        }

        if (totalGold > 0) {
            EventBus.emit(GameEvents.RANDOM_HARVEST, totalGold);
        }
    }

    // 战争动员事件：所有方征兵时间减半，持续15~30秒
    private static triggerWarMobilization(ownerIds: string[]): void {
        if (ownerIds.length === 0) return;

        const duration = 15 + Math.random() * 15;
        for (const ownerId of ownerIds) {
            EventSystem._activeEffects.set(ownerId, duration);
        }

        EventBus.emit(GameEvents.RANDOM_WAR_MOBILIZATION, duration);
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
