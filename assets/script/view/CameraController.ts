import { _decorator, Component, Camera, EventMouse, Input, input } from 'cc';

const { ccclass, property } = _decorator;

@ccclass('CameraController')
export class CameraController extends Component {

    @property(Camera)
    mainCamera: Camera | null = null;

    @property
    zoomSpeed = 0.05;

    @property
    minZoom = 0.3;

    @property
    maxZoom = 3.0;

    onLoad(): void {
        if (!this.mainCamera) {
            this.mainCamera = this.getComponent(Camera);
        }
        input.on(Input.EventType.MOUSE_WHEEL, this.onMouseWheel, this);
    }

    onDestroy(): void {
        input.off(Input.EventType.MOUSE_WHEEL, this.onMouseWheel, this);
    }

    private onMouseWheel(event: EventMouse): void {
        const scrollY = event.getScrollY();
        const delta = scrollY * this.zoomSpeed * -1;
        if (!this.mainCamera || !this.mainCamera.node) return;

        const curScale = this.mainCamera.node.scale.x;
        const newScale = Math.max(this.minZoom, Math.min(this.maxZoom, curScale + delta));
        this.mainCamera.node.setScale(newScale, newScale, 1);
    }
}
