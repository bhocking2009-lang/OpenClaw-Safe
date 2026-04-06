import { ApprovalInbox, PendingApproval } from "../src/core/approval_inbox";

describe("ApprovalInbox", () => {
  let inbox: ApprovalInbox;

  beforeEach(() => {
    inbox = new ApprovalInbox();
  });

  it("submits a new approval and returns it as pending", () => {
    const approval = inbox.submit("inv-1", "sess-1", "read_file", "needs file access");
    expect(approval.status).toBe("pending");
    expect(approval.invocationId).toBe("inv-1");
    expect(approval.sessionId).toBe("sess-1");
    expect(approval.toolName).toBe("read_file");
    expect(approval.reason).toBe("needs file access");
    expect(approval.resolvedAt).toBeNull();
  });

  it("assigns a unique id", () => {
    const a1 = inbox.submit("inv-1", "sess-1", "tool", "reason");
    const a2 = inbox.submit("inv-2", "sess-1", "tool", "reason");
    expect(a1.id).not.toBe(a2.id);
  });

  it("sets requestedAt to a valid ISO string", () => {
    const a = inbox.submit("inv-1", "s1", "tool", "r");
    expect(() => new Date(a.requestedAt)).not.toThrow();
    expect(new Date(a.requestedAt).toISOString()).toBe(a.requestedAt);
  });

  it("approve() changes status to approved", () => {
    const a = inbox.submit("inv-1", "s1", "tool", "r");
    const approved = inbox.approve(a.id);
    expect(approved.status).toBe("approved");
    expect(approved.resolvedAt).not.toBeNull();
  });

  it("deny() changes status to denied", () => {
    const a = inbox.submit("inv-1", "s1", "tool", "r");
    const denied = inbox.deny(a.id);
    expect(denied.status).toBe("denied");
    expect(denied.resolvedAt).not.toBeNull();
  });

  it("get() returns the approval by id", () => {
    const a = inbox.submit("inv-1", "s1", "tool", "r");
    const found = inbox.get(a.id);
    expect(found).toBeDefined();
    expect(found!.id).toBe(a.id);
  });

  it("get() returns undefined for unknown id", () => {
    expect(inbox.get("nonexistent")).toBeUndefined();
  });

  it("pending() returns only pending approvals", () => {
    const a1 = inbox.submit("inv-1", "s1", "t1", "r");
    const a2 = inbox.submit("inv-2", "s1", "t2", "r");
    inbox.approve(a1.id);
    const pending = inbox.pending();
    expect(pending).toHaveLength(1);
    expect(pending[0].id).toBe(a2.id);
  });

  it("resolved() returns approved and denied", () => {
    const a1 = inbox.submit("inv-1", "s1", "t1", "r");
    const a2 = inbox.submit("inv-2", "s1", "t2", "r");
    const a3 = inbox.submit("inv-3", "s1", "t3", "r");
    inbox.approve(a1.id);
    inbox.deny(a2.id);
    const resolved = inbox.resolved();
    expect(resolved).toHaveLength(2);
    expect(resolved.map((r) => r.id)).toContain(a1.id);
    expect(resolved.map((r) => r.id)).toContain(a2.id);
  });

  it("approve() throws for unknown id", () => {
    expect(() => inbox.approve("nonexistent")).toThrow();
  });

  it("deny() throws for unknown id", () => {
    expect(() => inbox.deny("nonexistent")).toThrow();
  });

  it("resolvedAt is set after approve()", () => {
    const before = Date.now();
    const a = inbox.submit("inv-1", "s1", "tool", "r");
    inbox.approve(a.id);
    const updated = inbox.get(a.id)!;
    expect(updated.resolvedAt).not.toBeNull();
    expect(new Date(updated.resolvedAt!).getTime()).toBeGreaterThanOrEqual(before);
  });

  it("pending() returns empty array when all resolved", () => {
    const a = inbox.submit("inv-1", "s1", "t", "r");
    inbox.approve(a.id);
    expect(inbox.pending()).toHaveLength(0);
  });

  it("resolved() returns empty array when none resolved", () => {
    inbox.submit("inv-1", "s1", "t", "r");
    expect(inbox.resolved()).toHaveLength(0);
  });

  it("can handle many approvals", () => {
    for (let i = 0; i < 20; i++) {
      inbox.submit(`inv-${i}`, "s1", "tool", "reason");
    }
    expect(inbox.pending()).toHaveLength(20);
  });
});
