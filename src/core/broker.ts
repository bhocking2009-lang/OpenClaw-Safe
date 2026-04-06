import { ToolInvocation, InvocationStatus } from "../models/tool_invocation";
import { ApprovalRequest, ApprovalStatus } from "../models/approval_request";
import { Artifact } from "../models/artifact";
import { PolicyEvaluation, PolicyDecision } from "./policy";
import { SandboxWorker } from "./sandbox_worker";
import { HostElevationPath } from "./host_elevation";
import { AuditLog, AuditEventKind } from "./audit_log";
import { SessionStore } from "./session_store";

export class ToolBroker {
  constructor(
    private readonly sandbox: SandboxWorker,
    private readonly hostElevation: HostElevationPath,
    private readonly auditLog?: AuditLog,
    private readonly sessionStore?: SessionStore
  ) {}

  dispatch(
    invocation: ToolInvocation,
    evaluation: PolicyEvaluation,
    actorId: string,
    approval?: ApprovalRequest,
    breakGlassToken = "",
    sessionId?: string
  ): Artifact {
    // Budget guard fires BEFORE the policy decision check
    if (this.sessionStore && sessionId) {
      const record = this.sessionStore.get(sessionId);
      if (record && record.budget <= 0) {
        if (this.auditLog) {
          this.auditLog.record(AuditEventKind.BUDGET_EXHAUSTED, actorId, {
            sessionId,
            budgetRemaining: 0,
          });
        }
        invocation.status = InvocationStatus.DENIED;
        class BudgetExhaustedError extends Error {
          readonly matchedRuleId = "budget-exhausted";
          constructor(msg: string) { super(msg); this.name = "BudgetExhaustedError"; }
        }
        throw new BudgetExhaustedError(`Budget exhausted for session '${sessionId}'.`);
      }
    }

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

    const artifact = breakGlassToken
      ? this.hostElevation.execute(invocation, actorId, breakGlassToken)
      : this.sandbox.execute(invocation, actorId);

    if (this.sessionStore && sessionId && artifact.tokensUsed !== undefined) {
      this.sessionStore.decrementBudget(sessionId, artifact.tokensUsed);
    }

    return artifact;
  }
}
