import { CapabilityManifest, RiskLevel } from "./capability_manifest";
import { AuditLog } from "./audit_log";
export declare enum PolicyDecision {
    ALLOW = "allow",
    REQUIRE_APPROVAL = "require_approval",
    DENY = "deny"
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
export declare class PolicyEngine {
    private readonly auditLog?;
    private ruleMap;
    constructor(rules?: PolicyRule[], auditLog?: AuditLog | undefined);
    evaluate(toolName: string, actorId: string, manifest?: CapabilityManifest): PolicyEvaluation;
    private resolveRisk;
}
//# sourceMappingURL=policy.d.ts.map