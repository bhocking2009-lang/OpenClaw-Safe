/**
 * Approval system for OpenClaw Secure.
 *
 * The approval inbox supports:
 *   - inline approve/deny
 *   - duration: once | session | task | policy_rule
 *   - class-based approvals
 *   - human-readable diff of requested effect
 *   - filesystem / network / secret usage preview
 *   - replay link to prior similar approval
 */

import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import { ApprovalRequest, ApprovalOutcome, ApprovalDuration, ToolRiskClass } from './types';

export interface ApprovalStoreOptions {
  dbPath: string;
}

export class ApprovalStore {
  private db: Database.Database;

  constructor(options: ApprovalStoreOptions) {
    this.db = new Database(options.dbPath);
    this.initialize();
  }

  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS approval_requests (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        tool_invocation_id TEXT,
        requested_action TEXT NOT NULL,
        risk_class TEXT NOT NULL,
        proposed_scope TEXT NOT NULL,
        approver_id TEXT,
        outcome TEXT NOT NULL DEFAULT 'pending',
        duration TEXT NOT NULL DEFAULT 'once',
        human_readable_diff TEXT NOT NULL,
        created_at TEXT NOT NULL,
        resolved_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_approvals_task ON approval_requests(task_id);
      CREATE INDEX IF NOT EXISTS idx_approvals_outcome ON approval_requests(outcome);
    `);
  }

  createRequest(params: {
    taskId: string;
    toolInvocationId?: string;
    requestedAction: string;
    riskClass: ToolRiskClass;
    proposedScope: Record<string, unknown>;
    duration: ApprovalDuration;
    humanReadableDiff: string;
  }): ApprovalRequest {
    const request: ApprovalRequest = {
      id: uuidv4(),
      taskId: params.taskId,
      toolInvocationId: params.toolInvocationId,
      requestedAction: params.requestedAction,
      riskClass: params.riskClass,
      proposedScope: params.proposedScope,
      outcome: 'pending',
      duration: params.duration,
      humanReadableDiff: params.humanReadableDiff,
      createdAt: new Date().toISOString(),
    };
    this.db
      .prepare(
        `INSERT INTO approval_requests
          (id, task_id, tool_invocation_id, requested_action, risk_class,
           proposed_scope, outcome, duration, human_readable_diff, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        request.id,
        request.taskId,
        request.toolInvocationId ?? null,
        request.requestedAction,
        request.riskClass,
        JSON.stringify(request.proposedScope),
        request.outcome,
        request.duration,
        request.humanReadableDiff,
        request.createdAt
      );
    return request;
  }

  getRequest(id: string): ApprovalRequest | undefined {
    const row = this.db
      .prepare('SELECT * FROM approval_requests WHERE id = ?')
      .get(id) as RawApproval | undefined;
    return row ? deserializeApproval(row) : undefined;
  }

  listPending(): ApprovalRequest[] {
    return (
      this.db
        .prepare("SELECT * FROM approval_requests WHERE outcome = 'pending' ORDER BY created_at ASC")
        .all() as RawApproval[]
    ).map(deserializeApproval);
  }

  listByTask(taskId: string): ApprovalRequest[] {
    return (
      this.db
        .prepare('SELECT * FROM approval_requests WHERE task_id = ? ORDER BY created_at ASC')
        .all(taskId) as RawApproval[]
    ).map(deserializeApproval);
  }

  resolve(id: string, approverId: string, outcome: 'approved' | 'denied'): ApprovalRequest | undefined {
    const existing = this.getRequest(id);
    if (!existing || existing.outcome !== 'pending') return undefined;
    const resolvedAt = new Date().toISOString();
    this.db
      .prepare(
        'UPDATE approval_requests SET outcome = ?, approver_id = ?, resolved_at = ? WHERE id = ?'
      )
      .run(outcome, approverId, resolvedAt, id);
    return { ...existing, outcome, approverId, resolvedAt };
  }

  close(): void {
    this.db.close();
  }
}

// ---------------------------------------------------------------------------
// Internal deserialization
// ---------------------------------------------------------------------------

interface RawApproval {
  id: string;
  task_id: string;
  tool_invocation_id: string | null;
  requested_action: string;
  risk_class: string;
  proposed_scope: string;
  approver_id: string | null;
  outcome: string;
  duration: string;
  human_readable_diff: string;
  created_at: string;
  resolved_at: string | null;
}

function deserializeApproval(row: RawApproval): ApprovalRequest {
  return {
    id: row.id,
    taskId: row.task_id,
    toolInvocationId: row.tool_invocation_id ?? undefined,
    requestedAction: row.requested_action,
    riskClass: row.risk_class as ToolRiskClass,
    proposedScope: JSON.parse(row.proposed_scope) as Record<string, unknown>,
    approverId: row.approver_id ?? undefined,
    outcome: row.outcome as ApprovalOutcome,
    duration: row.duration as ApprovalDuration,
    humanReadableDiff: row.human_readable_diff,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at ?? undefined,
  };
}
