import { EventBus, EventHandler } from "../src/core/event_bus";

describe("EventBus", () => {
  let bus: EventBus;

  beforeEach(() => {
    bus = new EventBus();
  });

  it("emits events to registered handlers", () => {
    const received: string[] = [];
    bus.on<string>("test", (e) => received.push(e));
    bus.emit("test", "hello");
    expect(received).toEqual(["hello"]);
  });

  it("emits to multiple handlers", () => {
    const results: number[] = [];
    bus.on<number>("evt", (e) => results.push(e));
    bus.on<number>("evt", (e) => results.push(e * 2));
    bus.emit("evt", 5);
    expect(results).toEqual([5, 10]);
  });

  it("does nothing when no handlers registered", () => {
    expect(() => bus.emit("no-handlers", { x: 1 })).not.toThrow();
  });

  it("removes a handler with off()", () => {
    const results: string[] = [];
    const handler: EventHandler<string> = (e) => results.push(e);
    bus.on("evt", handler);
    bus.off("evt", handler);
    bus.emit("evt", "should-not-appear");
    expect(results).toHaveLength(0);
  });

  it("off() only removes the specified handler", () => {
    const results: string[] = [];
    const h1: EventHandler<string> = (e) => results.push("h1:" + e);
    const h2: EventHandler<string> = (e) => results.push("h2:" + e);
    bus.on("evt", h1);
    bus.on("evt", h2);
    bus.off("evt", h1);
    bus.emit("evt", "test");
    expect(results).toEqual(["h2:test"]);
  });

  it("off() on non-existent event type does nothing", () => {
    const handler: EventHandler = () => {};
    expect(() => bus.off("nonexistent", handler)).not.toThrow();
  });

  it("handles multiple event types independently", () => {
    const aEvents: string[] = [];
    const bEvents: number[] = [];
    bus.on<string>("typeA", (e) => aEvents.push(e));
    bus.on<number>("typeB", (e) => bEvents.push(e));
    bus.emit("typeA", "hello");
    bus.emit("typeB", 42);
    expect(aEvents).toEqual(["hello"]);
    expect(bEvents).toEqual([42]);
  });

  it("emits multiple times", () => {
    const results: number[] = [];
    bus.on<number>("count", (e) => results.push(e));
    bus.emit("count", 1);
    bus.emit("count", 2);
    bus.emit("count", 3);
    expect(results).toEqual([1, 2, 3]);
  });

  it("handlers receive complex objects", () => {
    let received: { key: string; value: number } | null = null;
    bus.on<{ key: string; value: number }>("obj-evt", (e) => { received = e; });
    bus.emit("obj-evt", { key: "x", value: 99 });
    expect(received).toEqual({ key: "x", value: 99 });
  });

  it("can register same handler for different event types", () => {
    const results: string[] = [];
    const handler: EventHandler<string> = (e) => results.push(e);
    bus.on("evt1", handler);
    bus.on("evt2", handler);
    bus.emit("evt1", "a");
    bus.emit("evt2", "b");
    expect(results).toEqual(["a", "b"]);
  });

  it("removal does not affect subsequent adds", () => {
    const results: string[] = [];
    const handler: EventHandler<string> = (e) => results.push(e);
    bus.on("evt", handler);
    bus.off("evt", handler);
    bus.on("evt", handler);
    bus.emit("evt", "back");
    expect(results).toEqual(["back"]);
  });

  it("emitting to non-registered handler does not throw", () => {
    expect(() => bus.emit("ghost-event", null)).not.toThrow();
  });
});
