import { _decorator, Component, Camera, Vec2, EventTouch, EventMouse, Input, input } from 'cc';

const { ccclass, property } = _decorator;

// 摄像机控制器，支持拖拽平移 + 滚轮缩放
@ccclass('CameraController')
export class CameraController extends Component {

    @property(Camera)
    mainCamera: Camera | null = null;

    @property
    moveSpeed = 1.0;

    @property
    zoomSpeed = 0.05;

    @property
    minZoom = 0.3;

    @property
    maxZoom = 3.0;

    @property
    useBoundary = false;

    @property
    boundaryMinX = -3000;

    @property
    boundaryMaxX = 3000;

    @property
    boundaryMinY = -3000;

    @property
    boundaryMaxY = 3000;

    private _isDragging = false;
    private _prevTouchPos = new Vec2();

    onLoad(): void {
        if (!this.mainCamera) {
            this.mainCamera = this.getComponent(Camera);
        }
        input.on(Input.EventType.TOUCH_START, this.onTouchStart, this);
        input.on(Input.EventType.TOUCH_MOVE, this.onTouchMove, this);
        input.on(Input.EventType.TOUCH_END, this.onTouchEnd, this);
        input.on(Input.EventType.MOUSE_WHEEL, this.onMouseWheel, this);
    }
    
    onDestroy(): void {
        input.off(Input.EventType.TOUCH_START, this.onTouchStart, this);
        input.off(Input.EventType.TOUCH_MOVE, this.onTouchMove, this);
        input.off(Input.EventType.TOUCH_END, this.onTouchEnd, this);
        input.off(Input.EventType.MOUSE_WHEEL, this.onMouseWheel, this);
    }
    
    private onTouchStart(event: EventTouch): void {
        this._isDragging = true;
        this._prevTouchPos.set(event.getUILocation());
    }

    private onTouchMove(event: EventTouch): void {
        if (!this._isDragging) return;
        const curPos = event.getUILocation();
        const delta = new Vec2(curPos.x - this._prevTouchPos.x, curPos.y - this._prevTouchPos.y);
        this._prevTouchPos.set(curPos.x, curPos.y);

        this.panCamera(delta);
    }

    private onTouchEnd(_event: EventTouch): void {
        this._isDragging = false;
    }

    private onMouseWheel(event: EventMouse): void {
        const scrollY = event.getScrollY();
        this.zoomCamera(scrollY * this.zoomSpeed * -1);
    }

    // 平移摄像机
    private panCamera(delta: Vec2): void {
        if (!this.mainCamera) return;

        const curPos = this.mainCamera.node.position.clone();
        curPos.x -= delta.x * this.moveSpeed;
        curPos.y -= delta.y * this.moveSpeed;

        if (this.useBoundary) {
            curPos.x = Math.max(this.boundaryMinX, Math.min(this.boundaryMaxX, curPos.x));
            curPos.y = Math.max(this.boundaryMinY, Math.min(this.boundaryMaxY, curPos.y));
        }

        this.mainCamera.node.setPosition(curPos);
    }

    // 缩放摄像机（正值为放大）
    private zoomCamera(delta: number): void {
        if (!this.mainCamera || !this.mainCamera.node) return;

        const curScale = this.mainCamera.node.scale.x;
        const newScale = Math.max(this.minZoom, Math.min(this.maxZoom, curScale + delta));
        this.mainCamera.node.setScale(newScale, newScale, 1);
    }
}
