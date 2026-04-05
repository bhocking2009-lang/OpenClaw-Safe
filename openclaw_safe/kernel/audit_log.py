"""AuditLog – append-only record of all significant kernel events."""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any


class AuditEventKind(str, Enum):
    SESSION_CREATED = "session_created"
    SESSION_CLOSED = "session_closed"
    TASK_CREATED = "task_created"
    TASK_COMPLETED = "task_completed"
    TASK_FAILED = "task_failed"
    TOOL_INVOKED = "tool_invoked"
    TOOL_ALLOWED = "tool_allowed"
    TOOL_DENIED = "tool_denied"
    APPROVAL_REQUESTED = "approval_requested"
    APPROVAL_GRANTED = "approval_granted"
    APPROVAL_DENIED = "approval_denied"
    PLUGIN_REGISTERED = "plugin_registered"
    PLUGIN_UNREGISTERED = "plugin_unregistered"
    CAPABILITY_TOKEN_ISSUED = "capability_token_issued"
    SANDBOX_EXECUTION = "sandbox_execution"
    HOST_ELEVATION = "host_elevation"


@dataclass
class AuditEvent:
    kind: AuditEventKind
    actor_id: str
    details: dict[str, Any] = field(default_factory=dict)
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    timestamp: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    def __str__(self) -> str:
        return (
            f"AuditEvent({self.kind.value}, actor={self.actor_id!r}, "
            f"at={self.timestamp.isoformat()})"
        )


class AuditLog:
    """Thread-safe append-only audit log."""

    def __init__(self) -> None:
        self._events: list[AuditEvent] = []

    def record(
        self,
        kind: AuditEventKind,
        actor_id: str,
        **details: Any,
    ) -> AuditEvent:
        event = AuditEvent(kind=kind, actor_id=actor_id, details=dict(details))
        self._events.append(event)
        return event

    @property
    def events(self) -> list[AuditEvent]:
        return list(self._events)

    def events_by_kind(self, kind: AuditEventKind) -> list[AuditEvent]:
        return [e for e in self._events if e.kind == kind]

    def events_by_actor(self, actor_id: str) -> list[AuditEvent]:
        return [e for e in self._events if e.actor_id == actor_id]

    def __len__(self) -> int:
        return len(self._events)
