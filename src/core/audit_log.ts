import crypto from "crypto";
import Database from "better-sqlite3";

export enum AuditEventKind {
  SESSION_CREATED = "session_created",
  SESSION_CLOSED = "session_closed",
  TASK_CREATED = "task_created",
  TASK_COMPLETED = "task_completed",
  TASK_FAILED = "task_failed",
  TOOL_INVOKED = "tool_invoked",
  TOOL_ALLOWED = "tool_allowed",
  TOOL_DENIED = "tool_denied",
  APPROVAL_REQUESTED = "approval_requested",
  APPROVAL_GRANTED = "approval_granted",
  APPROVAL_DENIED = "approval_denied",
  PLUGIN_REGISTERED = "plugin_registered",
  PLUGIN_UNREGISTERED = "plugin_unregistered",
  CAPABILITY_TOKEN_ISSUED = "capability_token_issued",
  SANDBOX_EXECUTION = "sandbox_execution",
  HOST_ELEVATION = "host_elevation",
}

export interface AuditEvent {
  id: string;
  kind: AuditEventKind;
  actorId: string;
  timestamp: string;
  details: Record<string, unknown>;
}

interface AuditRow {
  id: string;
  kind: string;
  actor_id: string;
  timestamp: string;
  details: string;
}

export class AuditLog {
  private db: Database.Database;

  constructor(dbPath = ":memory:") {
    this.db = new Database(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS audit_events (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        details TEXT NOT NULL
      )
    `);
  }

  record(kind: AuditEventKind, actorId: string, details: Record<string, unknown> = {}): AuditEvent {
    const event: AuditEvent = {
      id: crypto.randomUUID(),
      kind,
      actorId,
      timestamp: new Date().toISOString(),
      details,
    };
    this.db
      .prepare(
        "INSERT INTO audit_events (id, kind, actor_id, timestamp, details) VALUES (?, ?, ?, ?, ?)"
      )
      .run(event.id, event.kind, event.actorId, event.timestamp, JSON.stringify(event.details));
    return event;
  }

  events(): AuditEvent[] {
    return (this.db.prepare("SELECT * FROM audit_events ORDER BY timestamp ASC").all() as AuditRow[]).map(
      this.deserialize
    );
  }

  eventsByKind(kind: AuditEventKind): AuditEvent[] {
    return (
      this.db
        .prepare("SELECT * FROM audit_events WHERE kind = ? ORDER BY timestamp ASC")
        .all(kind) as AuditRow[]
    ).map(this.deserialize);
  }

  eventsByActor(actorId: string): AuditEvent[] {
    return (
      this.db
        .prepare("SELECT * FROM audit_events WHERE actor_id = ? ORDER BY timestamp ASC")
        .all(actorId) as AuditRow[]
    ).map(this.deserialize);
  }

  count(): number {
    const row = this.db.prepare("SELECT COUNT(*) as cnt FROM audit_events").get() as { cnt: number };
    return row.cnt;
  }

  close(): void {
    this.db.close();
  }

  private deserialize(row: AuditRow): AuditEvent {
    return {
      id: row.id,
      kind: row.kind as AuditEventKind,
      actorId: row.actor_id,
      timestamp: row.timestamp,
      details: JSON.parse(row.details) as Record<string, unknown>,
    };
  }
}
