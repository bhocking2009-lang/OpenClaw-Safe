import { ToolInvocation, InvocationStatus } from "../models/tool_invocation";
import { createArtifact, Artifact } from "../models/artifact";
import { AuditLog, AuditEventKind } from "./audit_log";

export type ToolFn = (args: Record<string, unknown>) => unknown;

export class SandboxWorker {
  private registry: Map<string, ToolFn> = new Map();

  constructor(private readonly auditLog?: AuditLog) {}

  registerTool(name: string, fn: ToolFn): void {
    this.registry.set(name, fn);
  }

  execute(invocation: ToolInvocation, actorId: string): Artifact {
    const fn = this.registry.get(invocation.toolName);
    if (!fn) {
      invocation.status = InvocationStatus.FAILED;
      if (this.auditLog) {
        this.auditLog.record(AuditEventKind.SANDBOX_EXECUTION, actorId, {
          tool: invocation.toolName,
          success: false,
          error: "Tool not registered in sandbox.",
        });
      }
      throw new Error(`Tool '${invocation.toolName}' not registered in sandbox.`);
    }

    try {
      const result = fn(invocation.arguments);
      invocation.status = InvocationStatus.COMPLETED;
      invocation.result = result;
      const artifact = createArtifact(invocation.id, result);
      if (this.auditLog) {
        this.auditLog.record(AuditEventKind.SANDBOX_EXECUTION, actorId, {
          tool: invocation.toolName,
          success: true,
          artifactId: artifact.id,
        });
      }
      return artifact;
    } catch (err) {
      invocation.status = InvocationStatus.FAILED;
      if (this.auditLog) {
        this.auditLog.record(AuditEventKind.SANDBOX_EXECUTION, actorId, {
          tool: invocation.toolName,
          success: false,
          error: String(err),
        });
      }
      throw err;
    }
  }
}
