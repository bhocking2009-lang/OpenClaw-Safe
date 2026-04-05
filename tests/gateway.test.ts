import { AuditLog, AuditEventKind } from "../src/core/audit_log";
import { PolicyEngine } from "../src/core/policy";
import { PluginManager } from "../src/core/plugin_manager";
import { ToolBroker } from "../src/core/broker";
import { SandboxWorker } from "../src/core/sandbox_worker";
import { HostElevationPath } from "../src/core/host_elevation";
import { Gateway } from "../src/core/gateway";
import { createCapabilityManifest, addCapability, RiskLevel } from "../src/core/capability_manifest";
import { createTaskStep } from "../src/models/task_step";
import { createPrincipal, PrincipalRole } from "../src/models/principal";
import { createAgentProfile } from "../src/models/agent_profile";
import { createApprovalRequest, ApprovalStatus } from "../src/models/approval_request";

function buildGateway() {
  const auditLog = new AuditLog();
  const policy = new PolicyEngine(undefined, auditLog);
  const sandbox = new SandboxWorker(auditLog);
  const elev = new HostElevationPath(auditLog);
  const broker = new ToolBroker(sandbox, elev, auditLog);
  const manager = new PluginManager(policy, auditLog);
  const gateway = new Gateway(policy, manager, broker, auditLog);
  return { gateway, sandbox, auditLog };
}

describe("Gateway", () => {
  let gateway: Gateway;
  let sandbox: SandboxWorker;
  let auditLog: AuditLog;

  beforeEach(() => {
    ({ gateway, sandbox, auditLog } = buildGateway());
  });

  afterEach(() => auditLog.close());

  const principal = createPrincipal("Alice", PrincipalRole.OPERATOR);
  const agent = createAgentProfile("helper", "gpt-4");

  it("opens and closes a session with audit events", () => {
    const session = gateway.openSession(principal, agent);
    expect(session.active).toBe(true);
    expect(auditLog.eventsByKind(AuditEventKind.SESSION_CREATED)).toHaveLength(1);

    gateway.closeSession(session);
    expect(session.active).toBe(false);
    expect(auditLog.eventsByKind(AuditEventKind.SESSION_CLOSED)).toHaveLength(1);
  });

  it("creates a task and attaches it to the session", () => {
    const session = gateway.openSession(principal, agent);
    const task = gateway.createTask(session, "summarise report");
    expect(session.tasks).toContain(task);
    expect(auditLog.eventsByKind(AuditEventKind.TASK_CREATED)).toHaveLength(1);
  });

  it("invokes a LOW-risk tool without approval", () => {
    sandbox.registerTool("echo", ({ msg }) => msg);
    const manifest = createCapabilityManifest("demo", "1.0");
    addCapability(manifest, { name: "echo", description: "echo", riskLevel: RiskLevel.LOW });

    const session = gateway.openSession(principal, agent);
    const task = gateway.createTask(session, "echo");
    const step = createTaskStep("run echo");
    task.steps.push(step);

    const artifact = gateway.invokeTool(session, step, "echo", { msg: "hello" }, manifest);
    expect(artifact.content).toBe("hello");
  });

  it("denies a CRITICAL-risk tool", () => {
    const manifest = createCapabilityManifest("demo", "1.0");
    addCapability(manifest, { name: "nuke", description: "delete everything", riskLevel: RiskLevel.CRITICAL });

    const session = gateway.openSession(principal, agent);
    const step = createTaskStep("nuke");
    expect(() => gateway.invokeTool(session, step, "nuke", {}, manifest)).toThrow();
  });

  it("blocks MEDIUM-risk tool without an approved ApprovalRequest", () => {
    const manifest = createCapabilityManifest("demo", "1.0");
    addCapability(manifest, { name: "risky_op", description: "risky", riskLevel: RiskLevel.MEDIUM });

    const session = gateway.openSession(principal, agent);
    const step = createTaskStep("risky");
    expect(() => gateway.invokeTool(session, step, "risky_op", {}, manifest)).toThrow();
  });

  it("executes MEDIUM-risk tool with an approved ApprovalRequest", () => {
    sandbox.registerTool("risky_op", () => "done");
    const manifest = createCapabilityManifest("demo", "1.0");
    addCapability(manifest, { name: "risky_op", description: "risky", riskLevel: RiskLevel.MEDIUM });

    const session = gateway.openSession(principal, agent);
    const step = createTaskStep("risky");

    const approval = createApprovalRequest("pre-created", "test");
    approval.status = ApprovalStatus.APPROVED;

    const artifact = gateway.invokeTool(session, step, "risky_op", {}, manifest, approval);
    expect(artifact.content).toBe("done");
  });

  it("stores a memory item in the session", () => {
    const session = gateway.openSession(principal, agent);
    const item = gateway.remember(session, "theme", "dark");
    expect(session.memory).toContain(item);
    expect(item.key).toBe("theme");
  });

  it("registers a plugin and issues a scoped token", () => {
    const session = gateway.openSession(principal, agent);
    const manifest = createCapabilityManifest("my_plugin", "2.0");
    addCapability(manifest, { name: "read_file", description: "read", riskLevel: RiskLevel.LOW });
    const token = gateway.registerPlugin(manifest, session);
    expect(token.grantedCapabilities).toContain("read_file");
    expect(token.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });
});
