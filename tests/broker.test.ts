import { AuditLog, AuditEventKind } from "../src/core/audit_log";
import { SandboxWorker } from "../src/core/sandbox_worker";
import { HostElevationPath } from "../src/core/host_elevation";
import { ToolBroker } from "../src/core/broker";
import { PolicyDecision, PolicyEvaluation } from "../src/core/policy";
import { RiskLevel } from "../src/core/capability_manifest";
import { createToolInvocation, InvocationStatus } from "../src/models/tool_invocation";
import { createApprovalRequest, ApprovalStatus } from "../src/models/approval_request";

function makeEval(decision: PolicyDecision, toolName = "my_tool"): PolicyEvaluation {
  return { decision, toolName, riskLevel: RiskLevel.LOW, reason: "test", matchedRuleId: "rule-low-allow" };
}

describe("SandboxWorker", () => {
  let log: AuditLog;
  let sandbox: SandboxWorker;

  beforeEach(() => {
    log = new AuditLog();
    sandbox = new SandboxWorker(log);
    sandbox.registerTool("add", ({ a, b }) => (a as number) + (b as number));
  });

  afterEach(() => log.close());

  it("executes a registered tool and returns an artifact", () => {
    const inv = createToolInvocation("add", { a: 1, b: 2 });
    const artifact = sandbox.execute(inv, "s1");
    expect(artifact.content).toBe(3);
    expect(inv.status).toBe(InvocationStatus.COMPLETED);
  });

  it("throws for an unregistered tool and marks invocation FAILED", () => {
    const inv = createToolInvocation("nonexistent");
    expect(() => sandbox.execute(inv, "s1")).toThrow("not registered");
    expect(inv.status).toBe(InvocationStatus.FAILED);
  });

  // Class B tools (MEDIUM risk, auditRequired=true) write SANDBOX_EXECUTION events
  it("writes a SANDBOX_EXECUTION audit event on success", () => {
    const inv = createToolInvocation("add", { a: 5, b: 5 });
    sandbox.execute(inv, "s1");
    const events = log.eventsByKind(AuditEventKind.SANDBOX_EXECUTION);
    expect(events).toHaveLength(1);
    expect(events[0].details["success"]).toBe(true);
  });

  it("writes a failed SANDBOX_EXECUTION audit event on error", () => {
    sandbox.registerTool("boom", () => {
      throw new Error("kaboom");
    });
    const inv = createToolInvocation("boom");
    expect(() => sandbox.execute(inv, "s1")).toThrow("kaboom");
    const events = log.eventsByKind(AuditEventKind.SANDBOX_EXECUTION);
    expect(events[0].details["success"]).toBe(false);
  });
});

describe("HostElevationPath", () => {
  let log: AuditLog;
  let elev: HostElevationPath;

  beforeEach(() => {
    log = new AuditLog();
    elev = new HostElevationPath(log);
    elev.registerTool("privileged_op", () => "elevated_result");
  });

  afterEach(() => log.close());

  it("requires a break-glass token", () => {
    const inv = createToolInvocation("privileged_op");
    expect(() => elev.execute(inv, "s1", "")).toThrow("break-glass token");
  });

  it("executes with a valid token and records HOST_ELEVATION", () => {
    const inv = createToolInvocation("privileged_op");
    const artifact = elev.execute(inv, "s1", "secret-token");
    expect(artifact.content).toBe("elevated_result");
    expect(log.eventsByKind(AuditEventKind.HOST_ELEVATION)).toHaveLength(1);
  });

  it("throws for unregistered tool", () => {
    const inv = createToolInvocation("nope");
    expect(() => elev.execute(inv, "s1", "token")).toThrow("not registered");
  });
});

describe("ToolBroker", () => {
  let log: AuditLog;
  let sandbox: SandboxWorker;
  let elev: HostElevationPath;
  let broker: ToolBroker;

  beforeEach(() => {
    log = new AuditLog();
    sandbox = new SandboxWorker(log);
    sandbox.registerTool("safe_op", () => "safe_result");
    elev = new HostElevationPath(log);
    elev.registerTool("privileged_op", () => "elevated_result");
    broker = new ToolBroker(sandbox, elev, log);
  });

  afterEach(() => log.close());

  it("ALLOW dispatches to sandbox", () => {
    const inv = createToolInvocation("safe_op");
    const artifact = broker.dispatch(inv, makeEval(PolicyDecision.ALLOW, "safe_op"), "s1");
    expect(artifact.content).toBe("safe_result");
  });

  it("DENY throws PermissionError and marks invocation DENIED", () => {
    const inv = createToolInvocation("blocked");
    expect(() =>
      broker.dispatch(inv, makeEval(PolicyDecision.DENY, "blocked"), "s1")
    ).toThrow();
    expect(inv.status).toBe(InvocationStatus.DENIED);
  });

  it("REQUIRE_APPROVAL without approval throws", () => {
    const inv = createToolInvocation("safe_op");
    expect(() =>
      broker.dispatch(inv, makeEval(PolicyDecision.REQUIRE_APPROVAL, "safe_op"), "s1")
    ).toThrow("ApprovalRequest");
  });

  it("REQUIRE_APPROVAL with approved request executes", () => {
    const inv = createToolInvocation("safe_op");
    const approval = createApprovalRequest(inv.id, "needs approval");
    approval.status = ApprovalStatus.APPROVED;
    const artifact = broker.dispatch(
      inv,
      makeEval(PolicyDecision.REQUIRE_APPROVAL, "safe_op"),
      "s1",
      approval
    );
    expect(artifact.content).toBe("safe_result");
  });

  it("REQUIRE_APPROVAL with denied request throws", () => {
    const inv = createToolInvocation("safe_op");
    const approval = createApprovalRequest(inv.id, "needs approval");
    approval.status = ApprovalStatus.DENIED;
    expect(() =>
      broker.dispatch(inv, makeEval(PolicyDecision.REQUIRE_APPROVAL, "safe_op"), "s1", approval)
    ).toThrow();
  });

  it("break-glass token routes to host elevation", () => {
    const inv = createToolInvocation("privileged_op");
    const artifact = broker.dispatch(
      inv,
      makeEval(PolicyDecision.ALLOW, "privileged_op"),
      "s1",
      undefined,
      "secret"
    );
    expect(artifact.content).toBe("elevated_result");
  });
});
