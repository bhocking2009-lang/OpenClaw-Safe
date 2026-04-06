import { MemoryBroker } from "../src/brokers/memory_broker";

describe("MemoryBroker", () => {
  let broker: MemoryBroker;

  beforeEach(() => {
    broker = new MemoryBroker();
  });

  it("has toolClass = memory", () => {
    expect(broker.toolClass).toBe("memory");
  });

  it("has riskLevel = low", () => {
    expect(broker.riskLevel).toBe("low");
  });

  it("sets and gets a value", () => {
    broker.execute({ operation: "set", key: "foo", value: 42 }, "actor");
    const result = broker.execute({ operation: "get", key: "foo" }, "actor");
    expect(result.value).toBe(42);
  });

  it("gets undefined for missing key", () => {
    const result = broker.execute({ operation: "get", key: "missing" }, "actor");
    expect(result.value).toBeUndefined();
  });

  it("deletes a value", () => {
    broker.execute({ operation: "set", key: "bar", value: "hello" }, "actor");
    broker.execute({ operation: "delete", key: "bar" }, "actor");
    const result = broker.execute({ operation: "get", key: "bar" }, "actor");
    expect(result.value).toBeUndefined();
  });

  it("lists all keys", () => {
    broker.execute({ operation: "set", key: "a", value: 1 }, "actor");
    broker.execute({ operation: "set", key: "b", value: 2 }, "actor");
    const result = broker.execute({ operation: "list" }, "actor");
    expect(result.keys).toContain("a");
    expect(result.keys).toContain("b");
  });

  it("list returns empty array when store is empty", () => {
    const result = broker.execute({ operation: "list" }, "actor");
    expect(result.keys).toEqual([]);
  });

  it("set returns the value that was set", () => {
    const result = broker.execute({ operation: "set", key: "x", value: "val" }, "actor");
    expect(result.value).toBe("val");
    expect(result.key).toBe("x");
  });

  it("throws for set without key", () => {
    expect(() => broker.execute({ operation: "set", value: "x" }, "actor")).toThrow();
  });

  it("throws for get without key", () => {
    expect(() => broker.execute({ operation: "get" }, "actor")).toThrow();
  });

  it("throws for delete without key", () => {
    expect(() => broker.execute({ operation: "delete" }, "actor")).toThrow();
  });

  it("throws for unknown operation", () => {
    expect(() => broker.execute({ operation: "flush" }, "actor")).toThrow();
  });

  it("stores complex objects", () => {
    const obj = { nested: { arr: [1, 2, 3] } };
    broker.execute({ operation: "set", key: "complex", value: obj }, "actor");
    const result = broker.execute({ operation: "get", key: "complex" }, "actor");
    expect(result.value).toEqual(obj);
  });

  it("overrides existing value on re-set", () => {
    broker.execute({ operation: "set", key: "k", value: "v1" }, "actor");
    broker.execute({ operation: "set", key: "k", value: "v2" }, "actor");
    const result = broker.execute({ operation: "get", key: "k" }, "actor");
    expect(result.value).toBe("v2");
  });

  it("defaults to get operation when not specified", () => {
    broker.execute({ operation: "set", key: "x", value: 99 }, "actor");
    const result = broker.execute({ key: "x" }, "actor");
    expect(result.value).toBe(99);
  });
});
