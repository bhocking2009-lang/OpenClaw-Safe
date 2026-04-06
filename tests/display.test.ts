import { formatReplaySummary, formatReplayDiff, formatPolicyExplanation, formatIntegrityReport } from "../src/core/display";
import { ExportManifest } from "../src/core/types";
import { PolicyEvaluation, PolicyDecision } from "../src/core/policy";
import { RiskLevel } from "../src/core/capability_manifest";

function makeManifest(overrides: Partial<ExportManifest> = {}): ExportManifest {
  return {
    provenanceId: "prov-abc",
    sessionCount: 3,
    taskCount: 7,
    toolInvocationCount: 15,
    browserDenialCount: 2,
    artifactCount: 10,
    ...overrides,
  };
}

function makeEval(overrides: Partial<PolicyEvaluation> = {}): PolicyEvaluation {
  return {
    decision: PolicyDecision.ALLOW,
    toolName: "read_file",
    riskLevel: RiskLevel.LOW,
    reason: "Tool is low-risk and auto-approved.",
    matchedRuleId: "rule-low-allow",
    ...overrides,
  };
}

describe("formatReplaySummary", () => {
  it("formats a complete manifest summary", () => {
    const m = makeManifest();
    const result = formatReplaySummary(m);
    expect(result).toContain("3 sessions");
    expect(result).toContain("7 tasks");
    expect(result).toContain("15 tool calls");
    expect(result).toContain("2 browser denials");
    expect(result).toContain("10 artifacts");
    expect(result).toContain("prov-abc");
    expect(result).toContain("Replay summary");
  });

  it("includes provenance id in brackets", () => {
    const m = makeManifest({ provenanceId: "xyz-123" });
    expect(formatReplaySummary(m)).toContain("[provenance: xyz-123]");
  });

  it("handles zero counts", () => {
    const m = makeManifest({ sessionCount: 0, taskCount: 0, toolInvocationCount: 0, browserDenialCount: 0, artifactCount: 0 });
    const result = formatReplaySummary(m);
    expect(result).toContain("0 sessions");
    expect(result).toContain("0 tasks");
  });

  it("returns a single string (no newlines)", () => {
    const result = formatReplaySummary(makeManifest());
    expect(result.split("\n")).toHaveLength(1);
  });

  it("format matches exactly", () => {
    const m: ExportManifest = {
      provenanceId: "p1",
      sessionCount: 1,
      taskCount: 2,
      toolInvocationCount: 3,
      browserDenialCount: 4,
      artifactCount: 5,
    };
    const result = formatReplaySummary(m);
    expect(result).toBe(
      "Replay summary: 1 sessions, 2 tasks, 3 tool calls, 4 browser denials, 5 artifacts [provenance: p1]"
    );
  });
});

describe("formatReplayDiff", () => {
  it("returns multi-line string", () => {
    const before = makeManifest();
    const after = makeManifest({ sessionCount: 5, taskCount: 9 });
    const result = formatReplayDiff(before, after);
    expect(result.split("\n").length).toBeGreaterThan(2);
  });

  it("shows session difference", () => {
    const before = makeManifest({ sessionCount: 3 });
    const after = makeManifest({ sessionCount: 6 });
    const result = formatReplayDiff(before, after);
    expect(result).toContain("3 -> 6");
  });

  it("shows task difference", () => {
    const before = makeManifest({ taskCount: 5 });
    const after = makeManifest({ taskCount: 10 });
    const result = formatReplayDiff(before, after);
    expect(result).toContain("5 -> 10");
  });

  it("includes provenance ids", () => {
    const before = makeManifest({ provenanceId: "old-prov" });
    const after = makeManifest({ provenanceId: "new-prov" });
    const result = formatReplayDiff(before, after);
    expect(result).toContain("old-prov");
    expect(result).toContain("new-prov");
  });

  it("shows browser denials difference", () => {
    const before = makeManifest({ browserDenialCount: 1 });
    const after = makeManifest({ browserDenialCount: 5 });
    const result = formatReplayDiff(before, after);
    expect(result).toContain("1 -> 5");
  });

  it("shows artifact difference", () => {
    const before = makeManifest({ artifactCount: 0 });
    const after = makeManifest({ artifactCount: 8 });
    const result = formatReplayDiff(before, after);
    expect(result).toContain("0 -> 8");
  });
});

describe("formatPolicyExplanation", () => {
  it("includes tool name", () => {
    const result = formatPolicyExplanation(makeEval({ toolName: "my_tool" }));
    expect(result).toContain("my_tool");
  });

  it("includes decision", () => {
    const result = formatPolicyExplanation(makeEval({ decision: PolicyDecision.DENY }));
    expect(result).toContain("deny");
  });

  it("includes riskLevel", () => {
    const result = formatPolicyExplanation(makeEval({ riskLevel: RiskLevel.HIGH }));
    expect(result).toContain("high");
  });

  it("includes matchedRuleId", () => {
    const result = formatPolicyExplanation(makeEval({ matchedRuleId: "rule-critical-deny" }));
    expect(result).toContain("rule-critical-deny");
  });

  it("includes reason", () => {
    const result = formatPolicyExplanation(makeEval({ reason: "custom reason text" }));
    expect(result).toContain("custom reason text");
  });

  it("omits trace section when no evaluationTrace", () => {
    const result = formatPolicyExplanation(makeEval());
    expect(result).not.toContain("Trace");
  });

  it("includes trace when evaluationTrace present", () => {
    const eval_ = makeEval({
      evaluationTrace: [
        { ruleId: "rule-low-allow", matched: true, reason: "matched low" },
      ],
    });
    const result = formatPolicyExplanation(eval_);
    expect(result).toContain("Trace");
    expect(result).toContain("rule-low-allow");
  });

  it("shows matched/not-matched in trace", () => {
    const eval_ = makeEval({
      evaluationTrace: [
        { ruleId: "rule-low-allow", matched: true, reason: "matched" },
        { ruleId: "rule-high-require-approval", matched: false, reason: "not matched" },
      ],
    });
    const result = formatPolicyExplanation(eval_);
    expect(result).toContain("matched");
    expect(result).toContain("not matched");
  });

  it("returns multi-line string", () => {
    const result = formatPolicyExplanation(makeEval());
    expect(result.split("\n").length).toBeGreaterThanOrEqual(2);
  });
});

describe("formatIntegrityReport", () => {
  it("formats a passing report", () => {
    const result = formatIntegrityReport("prov-1", true, "All checks passed.");
    expect(result).toBe("Integrity report [prov-1]: PASS - All checks passed.");
  });

  it("formats a failing report", () => {
    const result = formatIntegrityReport("prov-2", false, "Hash mismatch.");
    expect(result).toBe("Integrity report [prov-2]: FAIL - Hash mismatch.");
  });

  it("includes provenanceId in brackets", () => {
    const result = formatIntegrityReport("test-prov", true, "ok");
    expect(result).toContain("[test-prov]");
  });

  it("PASS for valid=true", () => {
    expect(formatIntegrityReport("p", true, "d")).toContain("PASS");
  });

  it("FAIL for valid=false", () => {
    expect(formatIntegrityReport("p", false, "d")).toContain("FAIL");
  });
});
