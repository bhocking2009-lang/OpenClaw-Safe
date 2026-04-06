export type EventHandler<T = unknown> = (event: T) => void;

export class EventBus {
  private handlers: Map<string, EventHandler[]> = new Map();

  on<T>(eventType: string, handler: EventHandler<T>): void {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, []);
    }
    this.handlers.get(eventType)!.push(handler as EventHandler);
  }

  off(eventType: string, handler: EventHandler<any>): void {
    const list = this.handlers.get(eventType);
    if (!list) return;
    const idx = list.indexOf(handler);
    if (idx !== -1) list.splice(idx, 1);
  }

  emit<T>(eventType: string, event: T): void {
    const list = this.handlers.get(eventType);
    if (!list) return;
    for (const handler of [...list]) {
      (handler as EventHandler<T>)(event);
    }
  }
}
