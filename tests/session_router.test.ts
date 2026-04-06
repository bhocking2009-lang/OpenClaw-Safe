import { SessionRouter } from "../src/core/session_router";

describe("SessionRouter", () => {
  let router: SessionRouter;

  beforeEach(() => {
    router = new SessionRouter();
  });

  it("registers and looks up a session", () => {
    router.register("discord", "user-123", "session-abc");
    expect(router.lookup("discord", "user-123")).toBe("session-abc");
  });

  it("returns undefined for unknown channel", () => {
    expect(router.lookup("slack", "user-1")).toBeUndefined();
  });

  it("returns undefined for unknown sender in known channel", () => {
    router.register("discord", "user-1", "s1");
    expect(router.lookup("discord", "unknown-user")).toBeUndefined();
  });

  it("unregisters a sender", () => {
    router.register("discord", "user-1", "s1");
    router.unregister("discord", "user-1");
    expect(router.lookup("discord", "user-1")).toBeUndefined();
  });

  it("handles multiple channels independently", () => {
    router.register("discord", "user-1", "discord-session");
    router.register("slack", "user-1", "slack-session");
    expect(router.lookup("discord", "user-1")).toBe("discord-session");
    expect(router.lookup("slack", "user-1")).toBe("slack-session");
  });

  it("handles multiple senders in same channel", () => {
    router.register("discord", "alice", "s-alice");
    router.register("discord", "bob", "s-bob");
    expect(router.lookup("discord", "alice")).toBe("s-alice");
    expect(router.lookup("discord", "bob")).toBe("s-bob");
  });

  it("unregister on unknown channel does nothing", () => {
    expect(() => router.unregister("unknown", "user")).not.toThrow();
  });

  it("overrides session on re-register", () => {
    router.register("discord", "user-1", "old-session");
    router.register("discord", "user-1", "new-session");
    expect(router.lookup("discord", "user-1")).toBe("new-session");
  });

  it("unregister does not affect other senders", () => {
    router.register("discord", "alice", "s-alice");
    router.register("discord", "bob", "s-bob");
    router.unregister("discord", "alice");
    expect(router.lookup("discord", "bob")).toBe("s-bob");
  });

  it("can re-register after unregister", () => {
    router.register("discord", "user-1", "s1");
    router.unregister("discord", "user-1");
    router.register("discord", "user-1", "s2");
    expect(router.lookup("discord", "user-1")).toBe("s2");
  });
});
