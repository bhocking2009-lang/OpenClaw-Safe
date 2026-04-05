import { CapabilityManifest, RiskLevel, getCapability } from "./capability_manifest";
import { AuditLog, AuditEventKind } from "./audit_log";

export enum PolicyDecision {
  ALLOW = "allow",
  REQUIRE_APPROVAL = "require_approval",
  DENY = "deny",
}

export interface PolicyRule {
  riskLevel: RiskLevel;
  decision: PolicyDecision;
}

export interface PolicyEvaluation {
  decision: PolicyDecision;
  toolName: string;
  riskLevel: RiskLevel;
  reason: string;
}

// Default rules (evaluated first-match per risk level).
// Low-trust deny (classes B-F) and readonly session deny must come BEFORE
// class-level allow rules to ensure they are not overridden.
const DEFAULT_RULES: PolicyRule[] = [
  { riskLevel: RiskLevel.LOW, decision: PolicyDecision.ALLOW },
  { riskLevel: RiskLevel.MEDIUM, decision: PolicyDecision.REQUIRE_APPROVAL },
  { riskLevel: RiskLevel.HIGH, decision: PolicyDecision.REQUIRE_APPROVAL },
  { riskLevel: RiskLevel.CRITICAL, decision: PolicyDecision.DENY },
];

export class PolicyEngine {
  private ruleMap: Map<RiskLevel, PolicyDecision>;

  constructor(
    rules: PolicyRule[] = DEFAULT_RULES,
    private readonly auditLog?: AuditLog
  ) {
    // Rules are evaluated in order; first match wins.
    this.ruleMap = new Map(rules.map((r) => [r.riskLevel, r.decision]));
  }

  evaluate(
    toolName: string,
    actorId: string,
    manifest?: CapabilityManifest
  ): PolicyEvaluation {
    const risk = this.resolveRisk(toolName, manifest);
    const decision = this.ruleMap.get(risk) ?? PolicyDecision.DENY;

    const reasonMap: Record<PolicyDecision, string> = {
      [PolicyDecision.ALLOW]: `Tool '${toolName}' is low-risk and auto-approved.`,
      [PolicyDecision.REQUIRE_APPROVAL]: `Tool '${toolName}' requires human approval (risk=${risk}).`,
      [PolicyDecision.DENY]: `Tool '${toolName}' is denied by policy (risk=${risk}).`,
    };

    const evaluation: PolicyEvaluation = {
      decision,
      toolName,
      riskLevel: risk,
      reason: reasonMap[decision],
    };

    if (this.auditLog) {
      const kindMap: Record<PolicyDecision, AuditEventKind> = {
        [PolicyDecision.ALLOW]: AuditEventKind.TOOL_ALLOWED,
        [PolicyDecision.REQUIRE_APPROVAL]: AuditEventKind.APPROVAL_REQUESTED,
        [PolicyDecision.DENY]: AuditEventKind.TOOL_DENIED,
      };
      this.auditLog.record(kindMap[decision], actorId, {
        tool: toolName,
        risk,
        reason: evaluation.reason,
      });
    }

    return evaluation;
  }

  private resolveRisk(toolName: string, manifest?: CapabilityManifest): RiskLevel {
    if (!manifest) return RiskLevel.HIGH;
    const cap = getCapability(manifest, toolName);
    return cap ? cap.riskLevel : RiskLevel.HIGH;
  }
}
