import { SessionStore } from "../src/core/session_store";

describe("SessionStore", () => {
  let store: SessionStore;

  beforeEach(() => {
    store = new SessionStore(":memory:");
  });

  afterEach(() => store.close());

  it("creates a session record", () => {
    const record = store.create("session-1", "principal-1", 1000);
    expect(record.sessionId).toBe("session-1");
    expect(record.principalId).toBe("principal-1");
    expect(record.budget).toBe(1000);
    expect(record.active).toBe(true);
    expect(typeof record.createdAt).toBe("string");
  });

  it("retrieves a created session", () => {
    store.create("s1", "p1", 500);
    const record = store.get("s1");
    expect(record).toBeDefined();
    expect(record!.sessionId).toBe("s1");
    expect(record!.budget).toBe(500);
  });

  it("returns undefined for unknown session", () => {
    const record = store.get("nonexistent");
    expect(record).toBeUndefined();
  });

  it("decrements budget by amount", () => {
    store.create("s1", "p1", 1000);
    const updated = store.decrementBudget("s1", 100);
    expect(updated.budget).toBe(900);
  });

  it("decrements budget multiple times", () => {
    store.create("s1", "p1", 1000);
    store.decrementBudget("s1", 200);
    store.decrementBudget("s1", 300);
    const record = store.get("s1");
    expect(record!.budget).toBe(500);
  });

  it("allows budget to go to zero", () => {
    store.create("s1", "p1", 100);
    const updated = store.decrementBudget("s1", 100);
    expect(updated.budget).toBe(0);
  });

  it("allows budget to go negative", () => {
    store.create("s1", "p1", 50);
    const updated = store.decrementBudget("s1", 100);
    expect(updated.budget).toBe(-50);
  });

  it("creates multiple sessions independently", () => {
    store.create("s1", "p1", 100);
    store.create("s2", "p2", 200);
    expect(store.get("s1")!.budget).toBe(100);
    expect(store.get("s2")!.budget).toBe(200);
  });

  it("decrementBudget does not affect other sessions", () => {
    store.create("s1", "p1", 100);
    store.create("s2", "p2", 100);
    store.decrementBudget("s1", 30);
    expect(store.get("s2")!.budget).toBe(100);
  });

  it("createdAt is a valid ISO string", () => {
    const record = store.create("s1", "p1", 100);
    expect(() => new Date(record.createdAt)).not.toThrow();
    expect(new Date(record.createdAt).toISOString()).toBe(record.createdAt);
  });

  it("can create session with zero budget", () => {
    const record = store.create("s-zero", "p1", 0);
    expect(record.budget).toBe(0);
  });
});
