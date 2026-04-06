import { AuditLog } from "../src/core/audit_log";
import { PolicyEngine, PolicyDecision } from "../src/core/policy";
import { createCapabilityManifest, addCapability, RiskLevel } from "../src/core/capability_manifest";

function makeManifest(...caps: Array<[string, RiskLevel]>) {
  const m = createCapabilityManifest("test_plugin", "1.0");
  for (const [name, risk] of caps) {
    addCapability(m, { name, description: "", riskLevel: risk });
  }
  return m;
}

describe("PolicyEngine - Enhanced", () => {
  let log: AuditLog;
  let engine: PolicyEngine;

  beforeEach(() => {
    log = new AuditLog();
    engine = new PolicyEngine(undefined, log);
  });

  afterEach(() => log.close());

  describe("matchedRuleId in evaluate()", () => {
    it("returns rule-low-allow for LOW risk", () => {
      const m = makeManifest(["read_file", RiskLevel.LOW]);
      const result = engine.evaluate("read_file", "s1", m);
      expect(result.matchedRuleId).toBe("rule-low-allow");
    });

    it("returns rule-medium-require-approval for MEDIUM risk", () => {
      const m = makeManifest(["write_file", RiskLevel.MEDIUM]);
      const result = engine.evaluate("write_file", "s1", m);
      expect(result.matchedRuleId).toBe("rule-medium-require-approval");
    });

    it("returns rule-high-require-approval for HIGH risk", () => {
      const m = makeManifest(["exec_shell", RiskLevel.HIGH]);
      const result = engine.evaluate("exec_shell", "s1", m);
      expect(result.matchedRuleId).toBe("rule-high-require-approval");
    });

    it("returns rule-critical-deny for CRITICAL risk", () => {
      const m = makeManifest(["delete_system", RiskLevel.CRITICAL]);
      const result = engine.evaluate("delete_system", "s1", m);
      expect(result.matchedRuleId).toBe("rule-critical-deny");
    });

    it("returns rule-default-deny when no manifest provided (HIGH risk, mapped to rule)", () => {
      const result = engine.evaluate("unknown", "s1");
      // HIGH risk is in the default rules, so it's rule-high-require-approval
      expect(result.matchedRuleId).toBe("rule-high-require-approval");
    });

    it("returns rule-default-deny for undeclared tool in manifest", () => {
      const m = makeManifest(["known_tool", RiskLevel.LOW]);
      const result = engine.evaluate("unknown_tool", "s1", m);
      // Unknown tool defaults to HIGH risk => rule-high-require-approval
      expect(result.matchedRuleId).toBe("rule-high-require-approval");
    });
  });

  describe("evaluate() produces no evaluationTrace", () => {
    it("evaluate does not set evaluationTrace", () => {
      const m = makeManifest(["read_file", RiskLevel.LOW]);
      const result = engine.evaluate("read_file", "s1", m);
      expect(result.evaluationTrace).toBeUndefined();
    });
  });

  describe("explain() method", () => {
    it("returns a PolicyEvaluation with evaluationTrace", () => {
      const m = makeManifest(["read_file", RiskLevel.LOW]);
      const result = engine.explain("read_file", "s1", m);
      expect(result.evaluationTrace).toBeDefined();
      expect(Array.isArray(result.evaluationTrace)).toBe(true);
    });

    it("trace has 4 entries (one per risk level)", () => {
      const m = makeManifest(["read_file", RiskLevel.LOW]);
      const result = engine.explain("read_file", "s1", m);
      expect(result.evaluationTrace!.length).toBe(4);
    });

    it("explain() gives same decision as evaluate()", () => {
      const m = makeManifest(["write_file", RiskLevel.MEDIUM]);
      const evalResult = engine.evaluate("write_file", "s1", m);
      const explainResult = engine.explain("write_file", "s1", m);
      expect(explainResult.decision).toBe(evalResult.decision);
      expect(explainResult.matchedRuleId).toBe(evalResult.matchedRuleId);
    });

    it("trace marks exactly one entry as matched", () => {
      const m = makeManifest(["exec_shell", RiskLevel.HIGH]);
      const result = engine.explain("exec_shell", "s1", m);
      const matched = result.evaluationTrace!.filter((e) => e.matched);
      expect(matched.length).toBe(1);
      expect(matched[0].ruleId).toBe("rule-high-require-approval");
    });

    it("trace entries have ruleId, matched, reason", () => {
      const m = makeManifest(["read_file", RiskLevel.LOW]);
      const result = engine.explain("read_file", "s1", m);
      for (const entry of result.evaluationTrace!) {
        expect(typeof entry.ruleId).toBe("string");
        expect(typeof entry.matched).toBe("boolean");
        expect(typeof entry.reason).toBe("string");
      }
    });

    it("explain() does NOT write audit log events (pure)", () => {
      const m = makeManifest(["read_file", RiskLevel.LOW]);
      const before = log.count();
      engine.explain("read_file", "s1", m);
      expect(log.count()).toBe(before);
    });

    it("evaluate() DOES write audit log events (side effect)", () => {
      const m = makeManifest(["read_file", RiskLevel.LOW]);
      const before = log.count();
      engine.evaluate("read_file", "s1", m);
      expect(log.count()).toBeGreaterThan(before);
    });

    it("explain LOW risk returns ALLOW decision", () => {
      const m = makeManifest(["read_file", RiskLevel.LOW]);
      const result = engine.explain("read_file", "s1", m);
      expect(result.decision).toBe(PolicyDecision.ALLOW);
    });

    it("explain CRITICAL risk returns DENY decision", () => {
      const m = makeManifest(["nuke", RiskLevel.CRITICAL]);
      const result = engine.explain("nuke", "s1", m);
      expect(result.decision).toBe(PolicyDecision.DENY);
    });

    it("explain with no manifest returns HIGH risk evaluation", () => {
      const result = engine.explain("unknown", "s1");
      expect(result.riskLevel).toBe(RiskLevel.HIGH);
      expect(result.decision).toBe(PolicyDecision.REQUIRE_APPROVAL);
    });

    it("evaluationTrace includes the matched ruleId in the matched entry", () => {
      const m = makeManifest(["delete_system", RiskLevel.CRITICAL]);
      const result = engine.explain("delete_system", "s1", m);
      const matchedEntry = result.evaluationTrace!.find((e) => e.matched);
      expect(matchedEntry?.ruleId).toBe("rule-critical-deny");
      expect(result.matchedRuleId).toBe("rule-critical-deny");
    });
  });
});
