import { ToolInvocation, InvocationStatus } from "../models/tool_invocation";
import { ApprovalRequest, ApprovalStatus } from "../models/approval_request";
import { Artifact } from "../models/artifact";
import { PolicyEvaluation, PolicyDecision } from "./policy";
import { SandboxWorker } from "./sandbox_worker";
import { HostElevationPath } from "./host_elevation";
import { AuditLog } from "./audit_log";

export class ToolBroker {
  constructor(
    private readonly sandbox: SandboxWorker,
    private readonly hostElevation: HostElevationPath,
    private readonly auditLog?: AuditLog
  ) {}

  dispatch(
    invocation: ToolInvocation,
    evaluation: PolicyEvaluation,
    actorId: string,
    approval?: ApprovalRequest,
    breakGlassToken = ""
  ): Artifact {
    if (evaluation.decision === PolicyDecision.DENY) {
      invocation.status = InvocationStatus.DENIED;
      throw new Error(evaluation.reason);
    }

    if (evaluation.decision === PolicyDecision.REQUIRE_APPROVAL) {
      if (!approval || approval.status !== ApprovalStatus.APPROVED) {
        invocation.status = InvocationStatus.DENIED;
        throw new Error(
          `Tool '${invocation.toolName}' requires an approved ApprovalRequest before execution.`
        );
      }
    }

    if (breakGlassToken) {
      return this.hostElevation.execute(invocation, actorId, breakGlassToken);
    }

    return this.sandbox.execute(invocation, actorId);
  }
}
