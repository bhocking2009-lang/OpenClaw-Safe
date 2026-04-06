import { ToolContext, EvaluationTraceEntry, ExportManifest } from "../src/core/types";

describe("Types", () => {
  describe("ToolContext", () => {
    it("creates a minimal ToolContext", () => {
      const ctx: ToolContext = { toolName: "read_file", actorId: "actor-1" };
      expect(ctx.toolName).toBe("read_file");
      expect(ctx.actorId).toBe("actor-1");
      expect(ctx.riskLevel).toBeUndefined();
      expect(ctx.sessionBudget).toBeUndefined();
    });

    it("creates a full ToolContext", () => {
      const ctx: ToolContext = {
        toolName: "exec_shell",
        actorId: "actor-2",
        riskLevel: "high",
        sessionBudget: 1000,
      };
      expect(ctx.riskLevel).toBe("high");
      expect(ctx.sessionBudget).toBe(1000);
    });
  });

  describe("EvaluationTraceEntry", () => {
    it("has required fields", () => {
      const entry: EvaluationTraceEntry = {
        ruleId: "rule-low-allow",
        matched: true,
        reason: "Low risk tool matched",
      };
      expect(entry.ruleId).toBe("rule-low-allow");
      expect(entry.matched).toBe(true);
      expect(entry.reason).toBe("Low risk tool matched");
    });

    it("matched can be false", () => {
      const entry: EvaluationTraceEntry = {
        ruleId: "rule-high-require-approval",
        matched: false,
        reason: "Tool is low risk, not high",
      };
      expect(entry.matched).toBe(false);
    });
  });

  describe("ExportManifest", () => {
    it("has all required fields", () => {
      const manifest: ExportManifest = {
        provenanceId: "prov-123",
        sessionCount: 5,
        taskCount: 10,
        toolInvocationCount: 42,
        browserDenialCount: 3,
        artifactCount: 8,
      };
      expect(manifest.provenanceId).toBe("prov-123");
      expect(manifest.sessionCount).toBe(5);
      expect(manifest.taskCount).toBe(10);
      expect(manifest.toolInvocationCount).toBe(42);
      expect(manifest.browserDenialCount).toBe(3);
      expect(manifest.artifactCount).toBe(8);
    });

    it("allows zero counts", () => {
      const manifest: ExportManifest = {
        provenanceId: "empty",
        sessionCount: 0,
        taskCount: 0,
        toolInvocationCount: 0,
        browserDenialCount: 0,
        artifactCount: 0,
      };
      expect(manifest.sessionCount).toBe(0);
      expect(manifest.taskCount).toBe(0);
    });
  });
});
