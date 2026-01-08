export type EventHandler = (...args: any[]) => void;

export class EventBus<TEvent extends string> {
  private handlers = new Map<TEvent, Set<EventHandler>>();

  on(event: TEvent, handler: EventHandler) {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler);
  }

  offAll(event: TEvent) {
    this.handlers.delete(event);
  }

  emit(event: TEvent, ...args: any[]) {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const handler of set) {
      try {
        handler(...args);
      } catch (err) {
        console.error('[webrtc-sdk] handler error', event, err);
      }
    }
  }
}
