/**
 * Tool broker for OpenClaw Secure.
 *
 * Every tool call goes through the broker. No direct raw host power from the model.
 * The broker enforces:
 *   1. Policy evaluation (is this call allowed?)
 *   2. Capability check (is this tool in the task's capability set?)
 *   3. Budget exhaustion guard (session budget must be > 0)
 *   4. Approval gating (is approval required and obtained?)
 *   5. Execution routing (dispatch to the correct worker)
 *   6. Budget decrement (deduct tokensUsed from session after execution)
 *   7. Audit emission
 */

import { v4 as uuidv4 } from 'uuid';
import {
  ToolSchema,
  ToolRequest,
  PolicyContext,
  PolicyDecision,
  RuntimeTarget,
  ToolInvocation,
  ExecutionLease,
  RuntimeReceipt,
  ApprovalOutcome,
} from './types';
import { PolicyEngine } from './policy';
import { AuditLog } from './audit';
import { ArtifactStore } from './artifacts';
import { SessionStore } from './session';

// ---------------------------------------------------------------------------
// Worker interface
// ---------------------------------------------------------------------------

export interface WorkerExecutor {
  runtimeTarget: RuntimeTarget;
  /**
   * Execute the tool and return a receipt.
   * Implementors should be sandbox-first and honour quotas.
   */
  execute(
    tool: ToolSchema,
    params: Record<string, unknown>,
    lease: ExecutionLease
  ): Promise<RuntimeReceipt>;
}

// ---------------------------------------------------------------------------
// Approval resolver interface
// ---------------------------------------------------------------------------

export type ApprovalResolver = (
  request: Omit<import('./types').ApprovalRequest, 'id' | 'createdAt' | 'outcome' | 'resolvedAt'>
) => Promise<ApprovalOutcome>;

// ---------------------------------------------------------------------------
// Broker result
// ---------------------------------------------------------------------------

export interface BrokerResult {
  invocation: ToolInvocation;
  receipt?: RuntimeReceipt;
  policyDecision: PolicyDecision;
  denied: boolean;
  requiresApproval: boolean;
  approvalOutcome?: ApprovalOutcome;
}

// ---------------------------------------------------------------------------
// Tool broker
// ---------------------------------------------------------------------------

export class ToolBroker {
  private registry: Map<string, ToolSchema> = new Map();
  private workers: Map<RuntimeTarget, WorkerExecutor> = new Map();
  private policyEngine: PolicyEngine;
  private auditLog: AuditLog;
  private approvalResolver?: ApprovalResolver;
  private artifactStore?: ArtifactStore;
  private sessionStore?: SessionStore;

  constructor(
    policyEngine: PolicyEngine,
    auditLog: AuditLog,
    approvalResolver?: ApprovalResolver,
    artifactStore?: ArtifactStore,
    sessionStore?: SessionStore
  ) {
    this.policyEngine = policyEngine;
    this.auditLog = auditLog;
    this.approvalResolver = approvalResolver;
    this.artifactStore = artifactStore;
    this.sessionStore = sessionStore;
  }

  // ---------------------------------------------------------------------------
  // Registration
  // ---------------------------------------------------------------------------

  registerTool(schema: ToolSchema): void {
    this.registry.set(schema.name, schema);
  }

  registerWorker(executor: WorkerExecutor): void {
    this.workers.set(executor.runtimeTarget, executor);
  }

  getToolSchema(name: string): ToolSchema | undefined {
    return this.registry.get(name);
  }

  listTools(): ToolSchema[] {
    return Array.from(this.registry.values());
  }

  /**
   * Filter the tool registry to only the schemas visible to this principal/session.
   * This is what the agent runtime uses to build the model's tool list.
   */
  visibleTools(
    ctx: Omit<PolicyContext, 'toolName' | 'toolRiskClass' | 'runtimeTarget'>
  ): ToolSchema[] {
    const all = this.listTools().map((t) => ({
      name: t.name,
      riskClass: t.riskClass,
      defaultRuntimeTarget: t.defaultRuntimeTarget,
    }));
    const visible = this.policyEngine.filterVisibleTools(ctx, all);
    return visible.map((v) => this.registry.get(v.name)!);
  }

  // ---------------------------------------------------------------------------
  // Dispatch
  // ---------------------------------------------------------------------------

  async dispatch(
    request: ToolRequest,
    policyCtx: PolicyContext,
    task: { capabilitySet: string[]; sandboxClass: string }
  ): Promise<BrokerResult> {
    const now = new Date().toISOString();
    const schema = this.registry.get(request.toolName);

    if (!schema) {
      const invocation = this.buildInvocation(request, 'sandbox', now, undefined, 'Tool not found');
      this.auditLog.write({
        sessionId: request.sessionId,
        taskId: request.taskId,
        principalId: request.principalId,
        eventType: 'tool.error',
        toolName: request.toolName,
        params: request.params,
        startedAt: now,
        finishedAt: now,
        error: 'Tool not found in registry',
      });
      return {
        invocation,
        policyDecision: { mode: 'deny', reason: 'Tool not found', requiresApproval: false, auditRequired: true },
        denied: true,
        requiresApproval: false,
      };
    }

    // Budget exhaustion guard: deny immediately if the session budget is at zero.
    if (policyCtx.session.budget <= 0) {
      const invocation = this.buildInvocation(request, schema.defaultRuntimeTarget, now, undefined, 'Session budget exhausted');
      this.auditLog.write({
        sessionId: request.sessionId,
        taskId: request.taskId,
        principalId: request.principalId,
        eventType: 'budget.exhausted',
        toolName: request.toolName,
        params: request.params,
        startedAt: now,
        finishedAt: now,
        error: 'Session budget exhausted',
        budgetConsumed: 0,
        budgetRemaining: 0,
      });
      return {
        invocation,
        policyDecision: { mode: 'deny', reason: 'Session budget exhausted', requiresApproval: false, auditRequired: true, matchedRuleId: 'budget-exhausted' },
        denied: true,
        requiresApproval: false,
      };
    }

    // Capability check: is this tool in the task's allowed set?
    if (!task.capabilitySet.includes(request.toolName)) {
      const invocation = this.buildInvocation(request, schema.defaultRuntimeTarget, now, undefined, 'Tool not in capability set');
      this.auditLog.write({
        sessionId: request.sessionId,
        taskId: request.taskId,
        principalId: request.principalId,
        eventType: 'tool.denied',
        toolName: request.toolName,
        params: request.params,
        startedAt: now,
        finishedAt: now,
        error: 'Tool not in task capability set',
      });
      return {
        invocation,
        policyDecision: { mode: 'deny', reason: 'Tool not in task capability set', requiresApproval: false, auditRequired: true },
        denied: true,
        requiresApproval: false,
      };
    }

    // Policy evaluation
    const fullCtx: PolicyContext = {
      ...policyCtx,
      toolName: request.toolName,
      toolRiskClass: schema.riskClass,
      runtimeTarget: schema.defaultRuntimeTarget,
    };
    let decision = this.policyEngine.evaluate(fullCtx);

    // Handle approval flow
    let approvalOutcome: ApprovalOutcome | undefined;
    if (decision.mode === 'allow_with_approval') {
      if (!this.approvalResolver) {
        // No resolver configured: deny
        const invocation = this.buildInvocation(request, schema.defaultRuntimeTarget, now, undefined, 'Approval required but no resolver configured');
        this.writeAuditDenied(request, schema.defaultRuntimeTarget, decision, now, 'Approval required but no resolver configured');
        return { invocation, policyDecision: decision, denied: true, requiresApproval: true };
      }
      approvalOutcome = await this.approvalResolver({
        taskId: request.taskId,
        requestedAction: `${request.toolName}(${JSON.stringify(request.params)})`,
        riskClass: schema.riskClass,
        proposedScope: request.params,
        duration: 'once',
        humanReadableDiff: `Call ${schema.name}: ${schema.description}`,
      });

      if (approvalOutcome !== 'approved') {
        const invocation = this.buildInvocation(request, schema.defaultRuntimeTarget, now, undefined, `Approval ${approvalOutcome}`);
        this.writeAuditDenied(request, schema.defaultRuntimeTarget, decision, now, `Approval ${approvalOutcome}`);
        return { invocation, policyDecision: decision, denied: true, requiresApproval: true, approvalOutcome };
      }

      // Re-evaluate with approval state set
      decision = this.policyEngine.evaluate({ ...fullCtx, approvalState: 'approved' });
    }

    if (decision.mode === 'deny' || decision.mode === 'host_elevated_only') {
      // host_elevated_only requires explicit elevation
      if (decision.mode === 'host_elevated_only' && !policyCtx.session.elevationState) {
        const invocation = this.buildInvocation(request, schema.defaultRuntimeTarget, now, undefined, 'Host elevation required');
        this.writeAuditDenied(request, schema.defaultRuntimeTarget, decision, now, 'Host elevation required');
        return { invocation, policyDecision: decision, denied: true, requiresApproval: false };
      }
      if (decision.mode === 'deny') {
        const invocation = this.buildInvocation(request, schema.defaultRuntimeTarget, now, undefined, 'Policy denied');
        this.writeAuditDenied(request, schema.defaultRuntimeTarget, decision, now, 'Policy denied');
        return { invocation, policyDecision: decision, denied: true, requiresApproval: false };
      }
    }

    const runtimeTarget: RuntimeTarget = decision.allowedRuntimeTarget ?? schema.defaultRuntimeTarget;

    // Emit tool.started audit record
    if (decision.auditRequired) {
      this.auditLog.write({
        sessionId: request.sessionId,
        taskId: request.taskId,
        principalId: request.principalId,
        eventType: 'tool.started',
        toolName: request.toolName,
        params: request.params,
        policyDecision: decision,
        runtimeTarget,
        startedAt: now,
      });
    }

    // Build execution lease
    const lease: ExecutionLease = {
      id: uuidv4(),
      toolInvocationId: request.id,
      runtimeTarget,
      expiresAt: new Date(Date.now() + 30_000).toISOString(),
    };

    const worker = this.workers.get(runtimeTarget);
    if (!worker) {
      const invocation = this.buildInvocation(request, runtimeTarget, now, undefined, `No worker for runtime target: ${runtimeTarget}`);
      this.auditLog.write({
        sessionId: request.sessionId,
        taskId: request.taskId,
        principalId: request.principalId,
        eventType: 'tool.error',
        toolName: request.toolName,
        params: request.params,
        runtimeTarget,
        startedAt: now,
        finishedAt: new Date().toISOString(),
        error: `No worker registered for runtime target: ${runtimeTarget}`,
      });
      return { invocation, policyDecision: decision, denied: false, requiresApproval: false };
    }

    let receipt: RuntimeReceipt | undefined;
    let error: string | undefined;
    try {
      receipt = await worker.execute(schema, request.params, lease);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }

    const finishedAt = new Date().toISOString();
    const invocation = this.buildInvocation(
      request,
      runtimeTarget,
      now,
      receipt?.stdout ?? undefined,
      error
    );
    invocation.finishedAt = finishedAt;
    if (receipt) {
      invocation.result = receipt;
      invocation.diffSummary = receipt.fileDiffs?.join('\n');

      // Persist any artifacts returned by the worker
      if (this.artifactStore && receipt.artifacts && receipt.artifacts.length > 0) {
        for (const ref of receipt.artifacts) {
          this.artifactStore.store({
            type: 'file',
            uri: ref.uri,
            provenanceId: request.taskId,
            checksum: ref.checksum,
          });
        }
      }
    }

    // Budget decrement: if the worker reported tokensUsed, deduct from session budget.
    let budgetConsumed: number | undefined;
    let budgetRemaining: number | undefined;
    if (receipt?.tokensUsed !== undefined && this.sessionStore) {
      budgetConsumed = receipt.tokensUsed;
      const updated = this.sessionStore.decrementBudget(request.sessionId, budgetConsumed);
      budgetRemaining = updated?.budget;
    }

    // Emit tool.finished audit record
    if (decision.auditRequired) {
      this.auditLog.write({
        sessionId: request.sessionId,
        taskId: request.taskId,
        principalId: request.principalId,
        eventType: error ? 'tool.error' : 'tool.finished',
        toolName: request.toolName,
        params: request.params,
        policyDecision: decision,
        runtimeTarget,
        startedAt: now,
        finishedAt,
        stdout: receipt?.stdout,
        stderr: receipt?.stderr,
        fileDiffs: receipt?.fileDiffs,
        networkTraceSummary: receipt?.networkSummary,
        artifacts: receipt?.artifacts,
        error,
        budgetConsumed,
        budgetRemaining,
      });
    }

    return { invocation, receipt, policyDecision: decision, denied: false, requiresApproval: false, approvalOutcome };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private buildInvocation(
    request: ToolRequest,
    runtimeTarget: RuntimeTarget,
    startedAt: string,
    result?: unknown,
    error?: string
  ): ToolInvocation {
    const schema = this.registry.get(request.toolName);
    return {
      id: request.id,
      taskId: request.taskId,
      toolName: request.toolName,
      params: request.params,
      riskClass: schema?.riskClass ?? 'A',
      runtimeTarget,
      result,
      startedAt,
      error,
    };
  }

  private writeAuditDenied(
    request: ToolRequest,
    runtimeTarget: RuntimeTarget,
    decision: PolicyDecision,
    now: string,
    error: string
  ): void {
    this.auditLog.write({
      sessionId: request.sessionId,
      taskId: request.taskId,
      principalId: request.principalId,
      eventType: 'policy.denied',
      toolName: request.toolName,
      params: request.params,
      policyDecision: decision,
      runtimeTarget,
      startedAt: now,
      finishedAt: now,
      error,
    });
  }
}
