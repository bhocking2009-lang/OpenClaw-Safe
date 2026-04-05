"""ApprovalRequest – a human-in-the-loop gate for high-risk tool invocations."""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum


class ApprovalStatus(str, Enum):
    PENDING = "pending"
    APPROVED = "approved"
    DENIED = "denied"


@dataclass
class ApprovalRequest:
    """A request for a human principal to approve or deny a ToolInvocation."""

    invocation_id: str
    reason: str
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    status: ApprovalStatus = ApprovalStatus.PENDING
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    resolved_at: datetime | None = None

    def approve(self) -> None:
        self.status = ApprovalStatus.APPROVED
        self.resolved_at = datetime.now(timezone.utc)

    def deny(self) -> None:
        self.status = ApprovalStatus.DENIED
        self.resolved_at = datetime.now(timezone.utc)

    @property
    def is_resolved(self) -> bool:
        return self.status != ApprovalStatus.PENDING

    def __str__(self) -> str:
        return (
            f"ApprovalRequest(invocation_id={self.invocation_id!r}, "
            f"status={self.status.value})"
        )
