"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HostElevationPath = void 0;
const tool_invocation_1 = require("../models/tool_invocation");
const artifact_1 = require("../models/artifact");
const audit_log_1 = require("./audit_log");
class HostElevationPath {
    auditLog;
    registry = new Map();
    constructor(auditLog) {
        this.auditLog = auditLog;
    }
    registerTool(name, fn) {
        this.registry.set(name, fn);
    }
    execute(invocation, actorId, breakGlassToken) {
        if (!breakGlassToken) {
            invocation.status = tool_invocation_1.InvocationStatus.DENIED;
            throw new Error("Host elevation requires a non-empty break-glass token.");
        }
        const fn = this.registry.get(invocation.toolName);
        if (!fn) {
            invocation.status = tool_invocation_1.InvocationStatus.FAILED;
            throw new Error(`Tool '${invocation.toolName}' not registered in host elevation path.`);
        }
        if (this.auditLog) {
            this.auditLog.record(audit_log_1.AuditEventKind.HOST_ELEVATION, actorId, {
                tool: invocation.toolName,
                breakGlassTokenPrefix: breakGlassToken.slice(0, 8) + "…",
            });
        }
        try {
            const result = fn(invocation.arguments);
            invocation.status = tool_invocation_1.InvocationStatus.COMPLETED;
            invocation.result = result;
            return (0, artifact_1.createArtifact)(invocation.id, result);
        }
        catch (err) {
            invocation.status = tool_invocation_1.InvocationStatus.FAILED;
            throw err;
        }
    }
}
exports.HostElevationPath = HostElevationPath;
//# sourceMappingURL=host_elevation.js.map