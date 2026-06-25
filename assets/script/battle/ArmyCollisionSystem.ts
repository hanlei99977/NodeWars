import { ArmyEntity } from '../entity/ArmyEntity';
import { ArmyState } from '../config/EnumDefine';

// 线路遭遇战结果
export class EdgeBattleResult {
    winner: ArmyEntity;            // 胜利方军队
    loser: ArmyEntity;             // 失败方军队（将被移除）
    remainder: number;             // 胜利方剩余士兵数

    constructor(winner: ArmyEntity, loser: ArmyEntity, remainder: number) {
        this.winner = winner;
        this.loser = loser;
        this.remainder = remainder;
    }
}

// 线路遭遇战系统，处理两军在线路上相遇时的战斗结算，纯逻辑层
export class ArmyCollisionSystem {

    // 处理两军在一对一遭遇战（较大军队消灭较小军队，剩余军队继续前进）
    static resolve(armyA: ArmyEntity, armyB: ArmyEntity): EdgeBattleResult | null {
        // 任一军队已阵亡或不在移动中，视为无效
        if (armyA.soldierCount <= 0 || armyB.soldierCount <= 0) return null;
        if (armyA.state !== ArmyState.MOVING || armyB.state !== ArmyState.MOVING) return null;

        console.log(`[EdgeBattle] 线路遭遇: 军队#${armyA.id}(${armyA.ownerId}) ${armyA.soldierCount}人 VS 军队#${armyB.id}(${armyB.ownerId}) ${armyB.soldierCount}人`);

        if (armyA.soldierCount > armyB.soldierCount) {
            return ArmyCollisionSystem.doBattle(armyA, armyB);
        } else if (armyB.soldierCount > armyA.soldierCount) {
            return ArmyCollisionSystem.doBattle(armyB, armyA);
        }
        // 兵力相等时双方同归于尽，指定armyA为名义"胜方"但剩余为0
        console.log(`[EdgeBattle] 同归于尽: 双方各${armyA.soldierCount}人, 全部阵亡`);
        armyA.soldierCount = 0;
        armyB.soldierCount = 0;
        return new EdgeBattleResult(armyA, armyB, 0);
    }

    // 多条军队同时相遇时，按相遇时间逐次两两处理
    // 输入为同一边上所有不同势力的军队列表，按进度排序后逐对结算
    static resolveMulti(armies: ArmyEntity[]): EdgeBattleResult[] {
        const results: EdgeBattleResult[] = [];
        if (armies.length < 2) return results;

        // 按进度排序（相遇时间越早越先处理）
        const sorted = [...armies].sort((a, b) => {
            if (ArmyCollisionSystem.isSameDirection(a, b)) {
                // 同向追及：进度大的追上进度小的
                return a.progress - b.progress;
            }
            // 反向相遇：按progress升序，先相遇先处理
            return b.progress - a.progress;
        });

        // 分组：同owner不战斗
        const byOwner = new Map<string, ArmyEntity[]>();
        for (const a of sorted) {
            if (a.soldierCount <= 0) continue;
            const key = a.ownerId;
            // 按owner分组
            if (!byOwner.has(key)) byOwner.set(key, []);
            byOwner.get(key).push(a);
        }

        const keys = [...byOwner.keys()];
        // 两两不同势力的军队进行战斗，直到某一方被消灭
        for (let i = 0; i < keys.length; i++) {
            for (let j = i + 1; j < keys.length; j++) {
                const groupA = byOwner.get(keys[i]);
                const groupB = byOwner.get(keys[j]);
                if (!groupA || !groupB) continue;
                // 两两取每方最前面的军队进行战斗
                while (groupA.length > 0 && groupB.length > 0) {
                    const a = groupA[0];
                    const b = groupB[0];
                    if (a.soldierCount <= 0 || b.soldierCount <= 0) break;

                    const result = ArmyCollisionSystem.resolve(a, b);
                    if (result) results.push(result);

                    if (a.soldierCount <= 0) groupA.shift();
                    if (b.soldierCount <= 0) groupB.shift();
                }
            }
        }
        return results;
    }

    // 判断两军是否同向（在同一forward方向的边上）
    private static isSameDirection(a: ArmyEntity, b: ArmyEntity): boolean {
        return a.currentNodeId === b.currentNodeId && a.nextNodeId === b.nextNodeId;
    }

    // 执行一次胜负结算：winner - loser
    private static doBattle(winner: ArmyEntity, loser: ArmyEntity): EdgeBattleResult {
        const remainder = winner.soldierCount - loser.soldierCount;
        winner.soldierCount = remainder;
        loser.soldierCount = 0;
        loser.state = ArmyState.STATIONED;
        console.log(`[EdgeBattle] 战斗结果: 军队#${winner.id}(${winner.ownerId}) 胜, 剩余${remainder}人, 军队#${loser.id}(${loser.ownerId}) 全灭`);
        return new EdgeBattleResult(winner, loser, remainder);
    }
}
