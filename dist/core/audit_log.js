"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuditLog = exports.AuditEventKind = void 0;
const crypto_1 = __importDefault(require("crypto"));
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
var AuditEventKind;
(function (AuditEventKind) {
    AuditEventKind["SESSION_CREATED"] = "session_created";
    AuditEventKind["SESSION_CLOSED"] = "session_closed";
    AuditEventKind["TASK_CREATED"] = "task_created";
    AuditEventKind["TASK_COMPLETED"] = "task_completed";
    AuditEventKind["TASK_FAILED"] = "task_failed";
    AuditEventKind["TOOL_INVOKED"] = "tool_invoked";
    AuditEventKind["TOOL_ALLOWED"] = "tool_allowed";
    AuditEventKind["TOOL_DENIED"] = "tool_denied";
    AuditEventKind["APPROVAL_REQUESTED"] = "approval_requested";
    AuditEventKind["APPROVAL_GRANTED"] = "approval_granted";
    AuditEventKind["APPROVAL_DENIED"] = "approval_denied";
    AuditEventKind["PLUGIN_REGISTERED"] = "plugin_registered";
    AuditEventKind["PLUGIN_UNREGISTERED"] = "plugin_unregistered";
    AuditEventKind["CAPABILITY_TOKEN_ISSUED"] = "capability_token_issued";
    AuditEventKind["SANDBOX_EXECUTION"] = "sandbox_execution";
    AuditEventKind["HOST_ELEVATION"] = "host_elevation";
})(AuditEventKind || (exports.AuditEventKind = AuditEventKind = {}));
class AuditLog {
    db;
    constructor(dbPath = ":memory:") {
        this.db = new better_sqlite3_1.default(dbPath);
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
    record(kind, actorId, details = {}) {
        const event = {
            id: crypto_1.default.randomUUID(),
            kind,
            actorId,
            timestamp: new Date().toISOString(),
            details,
        };
        this.db
            .prepare("INSERT INTO audit_events (id, kind, actor_id, timestamp, details) VALUES (?, ?, ?, ?, ?)")
            .run(event.id, event.kind, event.actorId, event.timestamp, JSON.stringify(event.details));
        return event;
    }
    events() {
        return this.db.prepare("SELECT * FROM audit_events ORDER BY timestamp ASC").all().map(this.deserialize);
    }
    eventsByKind(kind) {
        return this.db
            .prepare("SELECT * FROM audit_events WHERE kind = ? ORDER BY timestamp ASC")
            .all(kind).map(this.deserialize);
    }
    eventsByActor(actorId) {
        return this.db
            .prepare("SELECT * FROM audit_events WHERE actor_id = ? ORDER BY timestamp ASC")
            .all(actorId).map(this.deserialize);
    }
    count() {
        const row = this.db.prepare("SELECT COUNT(*) as cnt FROM audit_events").get();
        return row.cnt;
    }
    close() {
        this.db.close();
    }
    deserialize(row) {
        return {
            id: row.id,
            kind: row.kind,
            actorId: row.actor_id,
            timestamp: row.timestamp,
            details: JSON.parse(row.details),
        };
    }
}
exports.AuditLog = AuditLog;
//# sourceMappingURL=audit_log.js.map