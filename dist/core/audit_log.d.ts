export declare enum AuditEventKind {
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
    HOST_ELEVATION = "host_elevation"
}
export interface AuditEvent {
    id: string;
    kind: AuditEventKind;
    actorId: string;
    timestamp: string;
    details: Record<string, unknown>;
}
export declare class AuditLog {
    private db;
    constructor(dbPath?: string);
    record(kind: AuditEventKind, actorId: string, details?: Record<string, unknown>): AuditEvent;
    events(): AuditEvent[];
    eventsByKind(kind: AuditEventKind): AuditEvent[];
    eventsByActor(actorId: string): AuditEvent[];
    count(): number;
    close(): void;
    private deserialize;
}
//# sourceMappingURL=audit_log.d.ts.map