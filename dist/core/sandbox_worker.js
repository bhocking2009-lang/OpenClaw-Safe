"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SandboxWorker = void 0;
const tool_invocation_1 = require("../models/tool_invocation");
const artifact_1 = require("../models/artifact");
const audit_log_1 = require("./audit_log");
class SandboxWorker {
    auditLog;
    registry = new Map();
    constructor(auditLog) {
        this.auditLog = auditLog;
    }
    registerTool(name, fn) {
        this.registry.set(name, fn);
    }
    execute(invocation, actorId) {
        const fn = this.registry.get(invocation.toolName);
        if (!fn) {
            invocation.status = tool_invocation_1.InvocationStatus.FAILED;
            if (this.auditLog) {
                this.auditLog.record(audit_log_1.AuditEventKind.SANDBOX_EXECUTION, actorId, {
                    tool: invocation.toolName,
                    success: false,
                    error: "Tool not registered in sandbox.",
                });
            }
            throw new Error(`Tool '${invocation.toolName}' not registered in sandbox.`);
        }
        try {
            const result = fn(invocation.arguments);
            invocation.status = tool_invocation_1.InvocationStatus.COMPLETED;
            invocation.result = result;
            const artifact = (0, artifact_1.createArtifact)(invocation.id, result);
            if (this.auditLog) {
                this.auditLog.record(audit_log_1.AuditEventKind.SANDBOX_EXECUTION, actorId, {
                    tool: invocation.toolName,
                    success: true,
                    artifactId: artifact.id,
                });
            }
            return artifact;
        }
        catch (err) {
            invocation.status = tool_invocation_1.InvocationStatus.FAILED;
            if (this.auditLog) {
                this.auditLog.record(audit_log_1.AuditEventKind.SANDBOX_EXECUTION, actorId, {
                    tool: invocation.toolName,
                    success: false,
                    error: String(err),
                });
            }
            throw err;
        }
    }
}
exports.SandboxWorker = SandboxWorker;
//# sourceMappingURL=sandbox_worker.js.map