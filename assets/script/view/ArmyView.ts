import { _decorator, Component, Sprite, Label, Color, Node, Vec3 } from 'cc';
import { ArmyEntity } from '../entity/ArmyEntity';
import { OwnerType } from '../config/EnumDefine';

const { ccclass, property } = _decorator;

// 各势力对应军队颜色
const OWNER_COLORS: Record<OwnerType, Color> = {
    [OwnerType.NEUTRAL]: new Color(160, 160, 160),   // 灰色：中立（不应出现）
    [OwnerType.PLAYER]: new Color(64, 140, 255),      // 蓝色：玩家
    [OwnerType.AI]: new Color(220, 60, 60),            // 红色：AI
};

// 军队视图组件，负责军队在边上的位置显示和人数标签，挂载在军队预制体根节点上
@ccclass('ArmyView')
export class ArmyView extends Component {

    @property(Sprite)
    armySprite: Sprite | null = null;        // 军队圆形图标（由编辑器拖入）

    @property(Label)
    soldierLabel: Label | null = null;       // 显示士兵人数 兵:100

    private _entity: ArmyEntity | null = null;

    // 当前边两个端节点的视图引用（由外部设置，用于实时计算军队位置）
    private _nodeAView: Node | null = null;   // 当前边起点节点
    private _nodeBView: Node | null = null;   // 当前边终点节点

    // 绑定实体数据并设置两端节点引用
    bindToEntity(entity: ArmyEntity, nodeAView: Node, nodeBView: Node): void {
        this._entity = entity;
        this._nodeAView = nodeAView;
        this._nodeBView = nodeBView;
        this.refreshDisplay();
        this.updatePosition();
    }

    // 获取当前绑定的实体
    get entity(): ArmyEntity | null {
        return this._entity;
    }

    // 根据实体最新数据刷新显示
    refreshDisplay(): void {
        if (!this._entity) return;

        // 根据所属方切换军队图标颜色
        if (this.armySprite) {
            const color = OWNER_COLORS[this._entity.ownerId];
            this.armySprite.color = color;
        }

        // 显示士兵人数
        if (this.soldierLabel) {
            this.soldierLabel.string = `${this._entity.soldierCount}`;
        }
    }

    // 根据当前边两个端节点世界坐标和行军进度插值更新军队位置
    updatePosition(): void {
        if (!this._entity || !this._nodeAView || !this._nodeBView) return;

        const posA = this._nodeAView.worldPosition;
        const posB = this._nodeBView.worldPosition;
        const t = this._entity.progress;

        // 线性插值：posA + (posB - posA) * progress
        this.node.worldPosition = new Vec3(
            posA.x + (posB.x - posA.x) * t,
            posA.y + (posB.y - posA.y) * t,
            0,
        );
    }

    // 更新端节点视图引用（军队跨入下一条边时调用）
    setNodeViews(nodeAView: Node, nodeBView: Node): void {
        this._nodeAView = nodeAView;
        this._nodeBView = nodeBView;
        this.updatePosition();
    }
}
