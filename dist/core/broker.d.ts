import { ToolInvocation } from "../models/tool_invocation";
import { ApprovalRequest } from "../models/approval_request";
import { Artifact } from "../models/artifact";
import { PolicyEvaluation } from "./policy";
import { SandboxWorker } from "./sandbox_worker";
import { HostElevationPath } from "./host_elevation";
import { AuditLog } from "./audit_log";
export declare class ToolBroker {
    private readonly sandbox;
    private readonly hostElevation;
    private readonly auditLog?;
    constructor(sandbox: SandboxWorker, hostElevation: HostElevationPath, auditLog?: AuditLog | undefined);
    dispatch(invocation: ToolInvocation, evaluation: PolicyEvaluation, actorId: string, approval?: ApprovalRequest, breakGlassToken?: string): Artifact;
}
//# sourceMappingURL=broker.d.ts.map