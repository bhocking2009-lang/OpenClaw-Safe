import { AuditLog, AuditEventKind } from "../src/core/audit_log";
import {
  PolicyEngine,
  PolicyDecision,
  PolicyRule,
} from "../src/core/policy";
import {
  createCapabilityManifest,
  addCapability,
  RiskLevel,
} from "../src/core/capability_manifest";

function makeManifest(...caps: Array<[string, RiskLevel]>) {
  const m = createCapabilityManifest("test_plugin", "1.0");
  for (const [name, risk] of caps) {
    addCapability(m, { name, description: "", riskLevel: risk });
  }
  return m;
}

describe("PolicyEngine", () => {
  let log: AuditLog;
  let engine: PolicyEngine;

  beforeEach(() => {
    log = new AuditLog();
    engine = new PolicyEngine(undefined, log);
  });

  afterEach(() => log.close());

  it("allows LOW risk tools", () => {
    const m = makeManifest(["read_file", RiskLevel.LOW]);
    const result = engine.evaluate("read_file", "s1", m);
    expect(result.decision).toBe(PolicyDecision.ALLOW);
  });

  it("requires approval for MEDIUM risk", () => {
    const m = makeManifest(["write_file", RiskLevel.MEDIUM]);
    const result = engine.evaluate("write_file", "s1", m);
    expect(result.decision).toBe(PolicyDecision.REQUIRE_APPROVAL);
  });

  it("requires approval for HIGH risk", () => {
    const m = makeManifest(["exec_shell", RiskLevel.HIGH]);
    const result = engine.evaluate("exec_shell", "s1", m);
    expect(result.decision).toBe(PolicyDecision.REQUIRE_APPROVAL);
  });

  it("denies CRITICAL risk tools", () => {
    const m = makeManifest(["delete_system", RiskLevel.CRITICAL]);
    const result = engine.evaluate("delete_system", "s1", m);
    expect(result.decision).toBe(PolicyDecision.DENY);
  });

  it("treats undeclared tools as HIGH risk", () => {
    const m = makeManifest(["known_tool", RiskLevel.LOW]);
    const result = engine.evaluate("unknown_tool", "s1", m);
    expect(result.riskLevel).toBe(RiskLevel.HIGH);
    expect(result.decision).toBe(PolicyDecision.REQUIRE_APPROVAL);
  });

  it("treats missing manifest as HIGH risk", () => {
    const result = engine.evaluate("any_tool", "s1");
    expect(result.riskLevel).toBe(RiskLevel.HIGH);
  });

  it("writes an audit event for each evaluation (Class B+ tools hit audit)", () => {
    const m = makeManifest(["write_file", RiskLevel.MEDIUM]);
    engine.evaluate("write_file", "s1", m);
    expect(log.eventsByKind(AuditEventKind.APPROVAL_REQUESTED)).toHaveLength(1);
  });

  it("writes TOOL_ALLOWED for LOW risk tools", () => {
    const m = makeManifest(["read_file", RiskLevel.LOW]);
    engine.evaluate("read_file", "s1", m);
    expect(log.eventsByKind(AuditEventKind.TOOL_ALLOWED)).toHaveLength(1);
  });

  it("supports custom rules (overriding LOW to require-approval)", () => {
    const customRules: PolicyRule[] = [
      { riskLevel: RiskLevel.LOW, decision: PolicyDecision.REQUIRE_APPROVAL },
      { riskLevel: RiskLevel.MEDIUM, decision: PolicyDecision.DENY },
      { riskLevel: RiskLevel.HIGH, decision: PolicyDecision.DENY },
      { riskLevel: RiskLevel.CRITICAL, decision: PolicyDecision.DENY },
    ];
    const strictEngine = new PolicyEngine(customRules);
    const m = makeManifest(["read_file", RiskLevel.LOW]);
    const result = strictEngine.evaluate("read_file", "s1", m);
    expect(result.decision).toBe(PolicyDecision.REQUIRE_APPROVAL);
  });
});
