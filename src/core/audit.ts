/**
 * Audit log for OpenClaw Secure.
 *
 * Every operation yields a structured, append-only audit record.
 * The audit log is the foundation of forensic auditability and replay.
 */

import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import { AuditRecord, ArtifactRef, PolicyDecision, RuntimeTarget } from './types';

export interface AuditLogOptions {
  /** Path to the SQLite database file. Use ':memory:' for in-memory (tests). */
  dbPath: string;
}

export class AuditLog {
  private db: Database.Database;

  constructor(options: AuditLogOptions) {
    this.db = new Database(options.dbPath);
    this.initialize();
  }

  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS audit_records (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        task_id TEXT,
        principal_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        tool_name TEXT,
        params TEXT,
        policy_decision TEXT,
        approval_path TEXT,
        runtime_target TEXT,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        stdout TEXT,
        stderr TEXT,
        file_diffs TEXT,
        network_trace_summary TEXT,
        artifacts TEXT,
        session_delta TEXT,
        error TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_audit_session ON audit_records(session_id);
      CREATE INDEX IF NOT EXISTS idx_audit_task ON audit_records(task_id);
      CREATE INDEX IF NOT EXISTS idx_audit_principal ON audit_records(principal_id);
      CREATE INDEX IF NOT EXISTS idx_audit_event ON audit_records(event_type);
    `);
  }

  /**
   * Append a new audit record. Returns the record with its generated id.
   */
  write(record: Omit<AuditRecord, 'id'>): AuditRecord {
    const id = uuidv4();
    const stmt = this.db.prepare(`
      INSERT INTO audit_records (
        id, session_id, task_id, principal_id, event_type, tool_name,
        params, policy_decision, approval_path, runtime_target,
        started_at, finished_at, stdout, stderr, file_diffs,
        network_trace_summary, artifacts, session_delta, error
      ) VALUES (
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?
      )
    `);

    stmt.run(
      id,
      record.sessionId,
      record.taskId ?? null,
      record.principalId,
      record.eventType,
      record.toolName ?? null,
      record.params ? JSON.stringify(record.params) : null,
      record.policyDecision ? JSON.stringify(record.policyDecision) : null,
      record.approvalPath ?? null,
      record.runtimeTarget ?? null,
      record.startedAt,
      record.finishedAt ?? null,
      record.stdout ?? null,
      record.stderr ?? null,
      record.fileDiffs ? JSON.stringify(record.fileDiffs) : null,
      record.networkTraceSummary ?? null,
      record.artifacts ? JSON.stringify(record.artifacts) : null,
      record.sessionDelta ? JSON.stringify(record.sessionDelta) : null,
      record.error ?? null
    );

    return { id, ...record };
  }

  /**
   * Query audit records by session.
   */
  queryBySession(sessionId: string): AuditRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM audit_records WHERE session_id = ? ORDER BY started_at ASC')
      .all(sessionId) as RawRow[];
    return rows.map(deserializeRow);
  }

  /**
   * Query audit records by task.
   */
  queryByTask(taskId: string): AuditRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM audit_records WHERE task_id = ? ORDER BY started_at ASC')
      .all(taskId) as RawRow[];
    return rows.map(deserializeRow);
  }

  /**
   * Query audit records by principal.
   */
  queryByPrincipal(principalId: string): AuditRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM audit_records WHERE principal_id = ? ORDER BY started_at ASC')
      .all(principalId) as RawRow[];
    return rows.map(deserializeRow);
  }

  /**
   * Fetch a single audit record by id.
   */
  getById(id: string): AuditRecord | undefined {
    const row = this.db
      .prepare('SELECT * FROM audit_records WHERE id = ?')
      .get(id) as RawRow | undefined;
    return row ? deserializeRow(row) : undefined;
  }

  /**
   * Export all records for replay pack generation.
   */
  exportAll(): AuditRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM audit_records ORDER BY started_at ASC')
      .all() as RawRow[];
    return rows.map(deserializeRow);
  }

  /**
   * Close the database connection.
   */
  close(): void {
    this.db.close();
  }
}

// ---------------------------------------------------------------------------
// Internal deserialization helpers
// ---------------------------------------------------------------------------

interface RawRow {
  id: string;
  session_id: string;
  task_id: string | null;
  principal_id: string;
  event_type: string;
  tool_name: string | null;
  params: string | null;
  policy_decision: string | null;
  approval_path: string | null;
  runtime_target: string | null;
  started_at: string;
  finished_at: string | null;
  stdout: string | null;
  stderr: string | null;
  file_diffs: string | null;
  network_trace_summary: string | null;
  artifacts: string | null;
  session_delta: string | null;
  error: string | null;
}

function deserializeRow(row: RawRow): AuditRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    taskId: row.task_id ?? undefined,
    principalId: row.principal_id,
    eventType: row.event_type,
    toolName: row.tool_name ?? undefined,
    params: row.params ? (JSON.parse(row.params) as Record<string, unknown>) : undefined,
    policyDecision: row.policy_decision
      ? (JSON.parse(row.policy_decision) as PolicyDecision)
      : undefined,
    approvalPath: row.approval_path ?? undefined,
    runtimeTarget: row.runtime_target ? (row.runtime_target as RuntimeTarget) : undefined,
    startedAt: row.started_at,
    finishedAt: row.finished_at ?? undefined,
    stdout: row.stdout ?? undefined,
    stderr: row.stderr ?? undefined,
    fileDiffs: row.file_diffs ? (JSON.parse(row.file_diffs) as string[]) : undefined,
    networkTraceSummary: row.network_trace_summary ?? undefined,
    artifacts: row.artifacts ? (JSON.parse(row.artifacts) as ArtifactRef[]) : undefined,
    sessionDelta: row.session_delta
      ? (JSON.parse(row.session_delta) as Record<string, unknown>)
      : undefined,
    error: row.error ?? undefined,
  };
}
