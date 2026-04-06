import { ExportManifest } from "./types";
import { PolicyEvaluation } from "./policy";

export function formatReplaySummary(manifest: ExportManifest): string {
  return (
    `Replay summary: ${manifest.sessionCount} sessions, ` +
    `${manifest.taskCount} tasks, ` +
    `${manifest.toolInvocationCount} tool calls, ` +
    `${manifest.browserDenialCount} browser denials, ` +
    `${manifest.artifactCount} artifacts ` +
    `[provenance: ${manifest.provenanceId}]`
  );
}

export function formatReplayDiff(before: ExportManifest, after: ExportManifest): string {
  const lines: string[] = [`Replay diff [provenance: ${before.provenanceId} -> ${after.provenanceId}]:`];
  lines.push(`  sessions: ${before.sessionCount} -> ${after.sessionCount}`);
  lines.push(`  tasks: ${before.taskCount} -> ${after.taskCount}`);
  lines.push(`  tool calls: ${before.toolInvocationCount} -> ${after.toolInvocationCount}`);
  lines.push(`  browser denials: ${before.browserDenialCount} -> ${after.browserDenialCount}`);
  lines.push(`  artifacts: ${before.artifactCount} -> ${after.artifactCount}`);
  return lines.join("\n");
}

export function formatPolicyExplanation(evaluation: PolicyEvaluation): string {
  const lines: string[] = [
    `Policy explanation for '${evaluation.toolName}': decision=${evaluation.decision}, risk=${evaluation.riskLevel}, rule=${evaluation.matchedRuleId ?? "unknown"}`,
    `  Reason: ${evaluation.reason}`,
  ];
  if (evaluation.evaluationTrace && evaluation.evaluationTrace.length > 0) {
    lines.push("  Trace:");
    for (const entry of evaluation.evaluationTrace) {
      const matched = entry.matched ? "matched" : "not matched";
      lines.push(`    - ${entry.ruleId}: ${matched} - ${entry.reason}`);
    }
  }
  return lines.join("\n");
}

export function formatIntegrityReport(
  provenanceId: string,
  valid: boolean,
  details: string
): string {
  const status = valid ? "PASS" : "FAIL";
  return `Integrity report [${provenanceId}]: ${status} - ${details}`;
}
