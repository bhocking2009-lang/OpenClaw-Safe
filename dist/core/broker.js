"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ToolBroker = void 0;
const tool_invocation_1 = require("../models/tool_invocation");
const approval_request_1 = require("../models/approval_request");
const policy_1 = require("./policy");
class ToolBroker {
    sandbox;
    hostElevation;
    auditLog;
    constructor(sandbox, hostElevation, auditLog) {
        this.sandbox = sandbox;
        this.hostElevation = hostElevation;
        this.auditLog = auditLog;
    }
    dispatch(invocation, evaluation, actorId, approval, breakGlassToken = "") {
        if (evaluation.decision === policy_1.PolicyDecision.DENY) {
            invocation.status = tool_invocation_1.InvocationStatus.DENIED;
            throw new Error(evaluation.reason);
        }
        if (evaluation.decision === policy_1.PolicyDecision.REQUIRE_APPROVAL) {
            if (!approval || approval.status !== approval_request_1.ApprovalStatus.APPROVED) {
                invocation.status = tool_invocation_1.InvocationStatus.DENIED;
                throw new Error(`Tool '${invocation.toolName}' requires an approved ApprovalRequest before execution.`);
            }
        }
        if (breakGlassToken) {
            return this.hostElevation.execute(invocation, actorId, breakGlassToken);
        }
        return this.sandbox.execute(invocation, actorId);
    }
}
exports.ToolBroker = ToolBroker;
//# sourceMappingURL=broker.js.map