import { ToolInvocation } from "../models/tool_invocation";
import { Artifact } from "../models/artifact";
import { AuditLog } from "./audit_log";
export type ToolFn = (args: Record<string, unknown>) => unknown;
export declare class SandboxWorker {
    private readonly auditLog?;
    private registry;
    constructor(auditLog?: AuditLog | undefined);
    registerTool(name: string, fn: ToolFn): void;
    execute(invocation: ToolInvocation, actorId: string): Artifact;
}
//# sourceMappingURL=sandbox_worker.d.ts.map