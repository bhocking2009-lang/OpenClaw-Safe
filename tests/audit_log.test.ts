import { AuditLog, AuditEventKind } from "../src/core/audit_log";

describe("AuditLog", () => {
  let log: AuditLog;

  beforeEach(() => {
    log = new AuditLog(); // in-memory SQLite
  });

  afterEach(() => {
    log.close();
  });

  it("records events and retrieves them", () => {
    log.record(AuditEventKind.SESSION_CREATED, "actor-1", { sessionId: "s1" });
    expect(log.count()).toBe(1);
    const events = log.events();
    expect(events[0].kind).toBe(AuditEventKind.SESSION_CREATED);
    expect(events[0].details["sessionId"]).toBe("s1");
  });

  it("filters by kind", () => {
    log.record(AuditEventKind.TOOL_ALLOWED, "a1");
    log.record(AuditEventKind.TOOL_DENIED, "a1");
    const allowed = log.eventsByKind(AuditEventKind.TOOL_ALLOWED);
    expect(allowed).toHaveLength(1);
    expect(allowed[0].kind).toBe(AuditEventKind.TOOL_ALLOWED);
  });

  it("filters by actor", () => {
    log.record(AuditEventKind.TASK_CREATED, "actor-A");
    log.record(AuditEventKind.TASK_CREATED, "actor-B");
    expect(log.eventsByActor("actor-A")).toHaveLength(1);
    expect(log.eventsByActor("actor-B")).toHaveLength(1);
  });
});
