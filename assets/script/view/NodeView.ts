import { _decorator, Component, Sprite, Label, Color } from 'cc';
import { NodeEntity } from '../entity/NodeEntity';
import { OwnerType } from '../config/EnumDefine';

const { ccclass, property } = _decorator;

// 各势力对应节点颜色
// 后续会增加更多节点颜色用以区分AI
const OWNER_COLORS: Record<OwnerType, Color> = {
    [OwnerType.NEUTRAL]: new Color(160, 160, 160),   // 灰色：中立
    [OwnerType.PLAYER]: new Color(64, 140, 255),      // 蓝色：玩家
    [OwnerType.AI]: new Color(220, 60, 60),            // 红色：AI
};

// 节点视图组件，负责节点的视觉呈现，挂载在节点预制体根节点上
@ccclass('NodeView')
export class NodeView extends Component {

    @property(Sprite)
    nodeSprite: Sprite | null = null;      // 节点主图形（由编辑器拖入绑定）

    @property(Label)
    levelLabel: Label | null = null;       // 显示节点等级 Lv1/Lv2/Lv3

    @property(Label)
    garrisonLabel: Label | null = null;    // 显示驻军数量 兵:100

    private _entity: NodeEntity | null = null;

    // 绑定实体数据并刷新显示
    bindToEntity(entity: NodeEntity): void {
        this._entity = entity;
        this.refreshDisplay();
    }

    // 获取当前绑定的实体
    get entity(): NodeEntity | null {
        return this._entity;
    }

    // 根据实体最新数据刷新全部显示
    refreshDisplay(): void {
        if (!this._entity) return;

        // 根据所属方切换节点颜色
        if (this.nodeSprite) {
            const color = OWNER_COLORS[this._entity.ownerId];
            this.nodeSprite.color = color;
        }

        // 显示等级
        if (this.levelLabel) {
            this.levelLabel.string = `Lv${this._entity.level}`;
        }

        // 显示驻军数量
        if (this.garrisonLabel) {
            this.garrisonLabel.string = `${this._entity.garrisonCount}`;
        }
    }

    // 设置节点是否高亮（选中态）
    setHighlight(highlight: boolean): void {
        const scale = highlight ? 1.15 : 1.0;
        this.node.setScale(scale, scale, 1);
    }
}
