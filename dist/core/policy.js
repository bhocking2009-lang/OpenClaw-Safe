"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PolicyEngine = exports.PolicyDecision = void 0;
const capability_manifest_1 = require("./capability_manifest");
const audit_log_1 = require("./audit_log");
var PolicyDecision;
(function (PolicyDecision) {
    PolicyDecision["ALLOW"] = "allow";
    PolicyDecision["REQUIRE_APPROVAL"] = "require_approval";
    PolicyDecision["DENY"] = "deny";
})(PolicyDecision || (exports.PolicyDecision = PolicyDecision = {}));
// Default rules (evaluated first-match per risk level).
// Low-trust deny (classes B-F) and readonly session deny must come BEFORE
// class-level allow rules to ensure they are not overridden.
const DEFAULT_RULES = [
    { riskLevel: capability_manifest_1.RiskLevel.LOW, decision: PolicyDecision.ALLOW },
    { riskLevel: capability_manifest_1.RiskLevel.MEDIUM, decision: PolicyDecision.REQUIRE_APPROVAL },
    { riskLevel: capability_manifest_1.RiskLevel.HIGH, decision: PolicyDecision.REQUIRE_APPROVAL },
    { riskLevel: capability_manifest_1.RiskLevel.CRITICAL, decision: PolicyDecision.DENY },
];
class PolicyEngine {
    auditLog;
    ruleMap;
    constructor(rules = DEFAULT_RULES, auditLog) {
        this.auditLog = auditLog;
        // Rules are evaluated in order; first match wins.
        this.ruleMap = new Map(rules.map((r) => [r.riskLevel, r.decision]));
    }
    evaluate(toolName, actorId, manifest) {
        const risk = this.resolveRisk(toolName, manifest);
        const decision = this.ruleMap.get(risk) ?? PolicyDecision.DENY;
        const reasonMap = {
            [PolicyDecision.ALLOW]: `Tool '${toolName}' is low-risk and auto-approved.`,
            [PolicyDecision.REQUIRE_APPROVAL]: `Tool '${toolName}' requires human approval (risk=${risk}).`,
            [PolicyDecision.DENY]: `Tool '${toolName}' is denied by policy (risk=${risk}).`,
        };
        const evaluation = {
            decision,
            toolName,
            riskLevel: risk,
            reason: reasonMap[decision],
        };
        if (this.auditLog) {
            const kindMap = {
                [PolicyDecision.ALLOW]: audit_log_1.AuditEventKind.TOOL_ALLOWED,
                [PolicyDecision.REQUIRE_APPROVAL]: audit_log_1.AuditEventKind.APPROVAL_REQUESTED,
                [PolicyDecision.DENY]: audit_log_1.AuditEventKind.TOOL_DENIED,
            };
            this.auditLog.record(kindMap[decision], actorId, {
                tool: toolName,
                risk,
                reason: evaluation.reason,
            });
        }
        return evaluation;
    }
    resolveRisk(toolName, manifest) {
        if (!manifest)
            return capability_manifest_1.RiskLevel.HIGH;
        const cap = (0, capability_manifest_1.getCapability)(manifest, toolName);
        return cap ? cap.riskLevel : capability_manifest_1.RiskLevel.HIGH;
    }
}
exports.PolicyEngine = PolicyEngine;
//# sourceMappingURL=policy.js.map