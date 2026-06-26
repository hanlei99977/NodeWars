// 事件监听函数类型
type Listener = (...args: any[]) => void;

class EventBusImpl {

    // 监听事件的映射表，key为事件名，value为监听函数数组
    private _map = new Map<string, Listener[]>();
    
    // 订阅事件
    // 参数是事件名和监听函数，监听函数会被调用多次，直到取消订阅
    on(event: string, listener: Listener): void {
        let list = this._map.get(event);
        if (!list) {
            list = [];
            this._map.set(event, list);
        }
        if (list.indexOf(listener) === -1) {
            list.push(listener);
        }
    }

    // 订阅一次性事件
    // 参数是事件名和监听函数，监听函数只会被调用一次，调用后自动取消订阅
    once(event: string, listener: Listener): void {
        const wrapper: Listener = (...args: any[]) => {
            this.off(event, wrapper);
            listener(...args);
        };
        this.on(event, wrapper);
    }

    // 取消订阅事件
    off(event: string, listener: Listener): void {
        const list = this._map.get(event);
        if (!list) return;
        const index = list.indexOf(listener);
        if (index !== -1) list.splice(index, 1);
    }

    // 触发事件
    // 参数是事件名和任意数量的参数，传递给监听函数
    emit(event: string, ...args: any[]): void {
        const list = this._map.get(event);
        if (!list) return;
        for (let i = 0; i < list.length; i++) {
            list[i](...args);
        }
    }

    // 移除所有事件监听
    removeAll(event?: string): void {
        if (event) {
            this._map.delete(event);
        } else {
            this._map.clear();
        }
    }
}

export const EventBus = new EventBusImpl();
