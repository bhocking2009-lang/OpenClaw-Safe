import { ToolInvocation } from "../models/tool_invocation";
import { Artifact } from "../models/artifact";
import { AuditLog } from "./audit_log";
import { ToolFn } from "./sandbox_worker";
export declare class HostElevationPath {
    private readonly auditLog?;
    private registry;
    constructor(auditLog?: AuditLog | undefined);
    registerTool(name: string, fn: ToolFn): void;
    execute(invocation: ToolInvocation, actorId: string, breakGlassToken: string): Artifact;
}
//# sourceMappingURL=host_elevation.d.ts.map