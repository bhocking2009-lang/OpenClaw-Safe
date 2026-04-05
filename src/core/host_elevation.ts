import { ToolInvocation, InvocationStatus } from "../models/tool_invocation";
import { createArtifact, Artifact } from "../models/artifact";
import { AuditLog, AuditEventKind } from "./audit_log";
import { ToolFn } from "./sandbox_worker";

export class HostElevationPath {
  private registry: Map<string, ToolFn> = new Map();

  constructor(private readonly auditLog?: AuditLog) {}

  registerTool(name: string, fn: ToolFn): void {
    this.registry.set(name, fn);
  }

  execute(invocation: ToolInvocation, actorId: string, breakGlassToken: string): Artifact {
    if (!breakGlassToken) {
      invocation.status = InvocationStatus.DENIED;
      throw new Error("Host elevation requires a non-empty break-glass token.");
    }

    const fn = this.registry.get(invocation.toolName);
    if (!fn) {
      invocation.status = InvocationStatus.FAILED;
      throw new Error(`Tool '${invocation.toolName}' not registered in host elevation path.`);
    }

    if (this.auditLog) {
      this.auditLog.record(AuditEventKind.HOST_ELEVATION, actorId, {
        tool: invocation.toolName,
        breakGlassTokenPrefix: breakGlassToken.slice(0, 8) + "…",
      });
    }

    try {
      const result = fn(invocation.arguments);
      invocation.status = InvocationStatus.COMPLETED;
      invocation.result = result;
      return createArtifact(invocation.id, result);
    } catch (err) {
      invocation.status = InvocationStatus.FAILED;
      throw err;
    }
  }
}
