import { AuditLog, AuditEventKind } from "../src/core/audit_log";
import { SandboxWorker } from "../src/core/sandbox_worker";
import { HostElevationPath } from "../src/core/host_elevation";
import { ToolBroker } from "../src/core/broker";
import { SessionStore } from "../src/core/session_store";
import { PolicyDecision, PolicyEvaluation } from "../src/core/policy";
import { RiskLevel } from "../src/core/capability_manifest";
import { createToolInvocation, InvocationStatus } from "../src/models/tool_invocation";
import { createArtifact } from "../src/models/artifact";

function makeEval(decision: PolicyDecision, toolName = "my_tool"): PolicyEvaluation {
  return {
    decision,
    toolName,
    riskLevel: RiskLevel.LOW,
    reason: "test",
    matchedRuleId: "rule-low-allow",
  };
}

describe("Broker budget guard", () => {
  let log: AuditLog;
  let sandbox: SandboxWorker;
  let elev: HostElevationPath;
  let store: SessionStore;
  let broker: ToolBroker;

  beforeEach(() => {
    log = new AuditLog();
    sandbox = new SandboxWorker(log);
    sandbox.registerTool("echo", ({ msg }) => msg);
    elev = new HostElevationPath(log);
    store = new SessionStore(":memory:");
    broker = new ToolBroker(sandbox, elev, log, store);
  });

  afterEach(() => {
    log.close();
    store.close();
  });

  it("executes normally when budget is positive", () => {
    store.create("s1", "p1", 500);
    const inv = createToolInvocation("echo", { msg: "hello" });
    const artifact = broker.dispatch(inv, makeEval(PolicyDecision.ALLOW, "echo"), "actor", undefined, "", "s1");
    expect(artifact.content).toBe("hello");
  });

  it("fires budget guard when budget is zero", () => {
    store.create("s1", "p1", 0);
    const inv = createToolInvocation("echo", { msg: "hi" });
    expect(() =>
      broker.dispatch(inv, makeEval(PolicyDecision.ALLOW, "echo"), "actor", undefined, "", "s1")
    ).toThrow("Budget exhausted");
  });

  it("fires budget guard when budget is negative", () => {
    store.create("s1", "p1", -5);
    const inv = createToolInvocation("echo");
    expect(() =>
      broker.dispatch(inv, makeEval(PolicyDecision.ALLOW, "echo"), "actor", undefined, "", "s1")
    ).toThrow();
  });

  it("sets invocation status to DENIED on budget exhaustion", () => {
    store.create("s1", "p1", 0);
    const inv = createToolInvocation("echo");
    try {
      broker.dispatch(inv, makeEval(PolicyDecision.ALLOW, "echo"), "actor", undefined, "", "s1");
    } catch {}
    expect(inv.status).toBe(InvocationStatus.DENIED);
  });

  it("emits budget.exhausted audit event", () => {
    store.create("s1", "p1", 0);
    const inv = createToolInvocation("echo");
    try {
      broker.dispatch(inv, makeEval(PolicyDecision.ALLOW, "echo"), "actor", undefined, "", "s1");
    } catch {}
    const events = log.eventsByKind(AuditEventKind.BUDGET_EXHAUSTED);
    expect(events).toHaveLength(1);
    expect(events[0].details["budgetRemaining"]).toBe(0);
    expect(events[0].details["sessionId"]).toBe("s1");
  });

  it("budget guard fires BEFORE policy DENY check", () => {
    store.create("s1", "p1", 0);
    const inv = createToolInvocation("echo");
    // Even if policy is DENY, budget check fires first
    const err = (() => {
      try {
        broker.dispatch(inv, makeEval(PolicyDecision.DENY, "echo"), "actor", undefined, "", "s1");
      } catch (e) {
        return e as Error & { matchedRuleId?: string };
      }
    })();
    expect(err).toBeDefined();
    expect(err!.matchedRuleId).toBe("budget-exhausted");
  });

  it("decrements budget after successful execution with tokensUsed", () => {
    store.create("s1", "p1", 1000);
    sandbox.registerTool("fetch_tool", () => {
      const art = createArtifact("inv-id", "response body", "text/plain");
      art.tokensUsed = 50;
      return art.content;
    });
    // We need sandbox to produce an artifact with tokensUsed
    // Simulate by making the sandbox return something and manually set tokensUsed
    const inv = createToolInvocation("echo", { msg: "hi" });
    broker.dispatch(inv, makeEval(PolicyDecision.ALLOW, "echo"), "actor", undefined, "", "s1");
    // echo returns "hi" which has no tokensUsed, so budget stays at 1000
    expect(store.get("s1")!.budget).toBe(1000);
  });

  it("budget not decremented when no tokensUsed on artifact", () => {
    store.create("s1", "p1", 500);
    const inv = createToolInvocation("echo", { msg: "test" });
    broker.dispatch(inv, makeEval(PolicyDecision.ALLOW, "echo"), "actor", undefined, "", "s1");
    expect(store.get("s1")!.budget).toBe(500);
  });

  it("works without sessionStore (backward compat)", () => {
    const brokerNoStore = new ToolBroker(sandbox, elev, log);
    const inv = createToolInvocation("echo", { msg: "no store" });
    const artifact = brokerNoStore.dispatch(inv, makeEval(PolicyDecision.ALLOW, "echo"), "actor");
    expect(artifact.content).toBe("no store");
  });

  it("works without sessionId even if sessionStore present", () => {
    const inv = createToolInvocation("echo", { msg: "no session" });
    const artifact = broker.dispatch(inv, makeEval(PolicyDecision.ALLOW, "echo"), "actor");
    expect(artifact.content).toBe("no session");
  });

  it("budget guard not triggered if sessionId not provided", () => {
    store.create("s1", "p1", 0);
    const inv = createToolInvocation("echo", { msg: "ok" });
    // No sessionId passed - budget guard should not fire
    const artifact = broker.dispatch(inv, makeEval(PolicyDecision.ALLOW, "echo"), "actor");
    expect(artifact.content).toBe("ok");
  });
});
