import { _decorator, Component, Graphics, Node, Color, Vec3, Label } from 'cc';
import { EdgeEntity } from '../entity/EdgeEntity';
import { EdgeLevel } from '../config/EnumDefine';

const { ccclass, property } = _decorator;

// 线路等级对应颜色
const EDGE_LEVEL_COLORS: Record<EdgeLevel, Color> = {
    [EdgeLevel.LV1]: new Color(120, 120, 120, 200),  // 灰色：1级线路
    [EdgeLevel.LV2]: new Color(80, 180, 80, 220),    // 绿色：2级线路（移速+30%）
    [EdgeLevel.LV3]: new Color(255, 180, 40, 240),   // 橙色：3级线路（移速+50%）
};

// 线路等级对应线宽
const EDGE_LEVEL_WIDTH: Record<EdgeLevel, number> = {
    [EdgeLevel.LV1]: 3,
    [EdgeLevel.LV2]: 5,
    [EdgeLevel.LV3]: 7,
};

// 线路视图组件，用 Graphics 在节点间绘制连线，挂载在线路预制体根节点上
@ccclass('EdgeView')
export class EdgeView extends Component {

    @property(Graphics)
    graphics: Graphics | null = null;     // 绘制组件（由编辑器拖入）

    @property(Label)
    lengthLabel: Label | null = null;     // 显示线路长度

    private _entity: EdgeEntity | null = null;

    // 两个端节点的视图引用（由外部设置，用于实时获取节点位置）
    private _nodeAView: Node | null = null;
    private _nodeBView: Node | null = null;

    // 绑定实体数据并记录端点视图引用
    bindToEntity(entity: EdgeEntity, nodeAView: Node, nodeBView: Node): void {
        this._entity = entity;
        this._nodeAView = nodeAView;
        this._nodeBView = nodeBView;
        this.drawLine();

        if (this.lengthLabel) {
            this.lengthLabel.string = `${entity.length}`;
        }
    }

    // 获取当前绑定的实体
    get entity(): EdgeEntity | null {
        return this._entity;
    }

    // 根据当前端节点世界坐标和线路等级重新绘制连线
    drawLine(): void {
        if (!this._entity || !this.graphics || !this._nodeAView || !this._nodeBView) return;

        const startPos = this._nodeAView.worldPosition;
        const endPos = this._nodeBView.worldPosition;

        const color = EDGE_LEVEL_COLORS[this._entity.level];
        const lineWidth = EDGE_LEVEL_WIDTH[this._entity.level];
        // 绘制线路
        this.graphics.clear();
        this.graphics.lineWidth = lineWidth;
        this.graphics.strokeColor = color;
        this.graphics.moveTo(startPos.x, startPos.y);// 从节点A位置开始绘制
        this.graphics.lineTo(endPos.x, endPos.y);// 绘制到节点B位置
        this.graphics.stroke();// 执行绘制

        // 更新本节点的位置到线路中点，以便标签显示在中间
        this.node.worldPosition = new Vec3(
            (startPos.x + endPos.x) / 2,
            (startPos.y + endPos.y) / 2,
            0,
        );
    }

    // 更新端节点引用（节点视图被替换时调用）
    setNodeViews(nodeAView: Node, nodeBView: Node): void {
        this._nodeAView = nodeAView;
        this._nodeBView = nodeBView;
        this.drawLine();
    }
}
