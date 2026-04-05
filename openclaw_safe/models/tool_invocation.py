"""ToolInvocation – a record of a single tool call made during a TaskStep."""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any


class InvocationStatus(str, Enum):
    PENDING = "pending"
    APPROVED = "approved"
    DENIED = "denied"
    COMPLETED = "completed"
    FAILED = "failed"


@dataclass
class ToolInvocation:
    """Records a request to execute a tool with specific arguments."""

    tool_name: str
    arguments: dict[str, Any] = field(default_factory=dict)
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    status: InvocationStatus = InvocationStatus.PENDING
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    result: Any = None

    def approve(self) -> None:
        self.status = InvocationStatus.APPROVED

    def deny(self) -> None:
        self.status = InvocationStatus.DENIED

    def complete(self, result: Any) -> None:
        self.status = InvocationStatus.COMPLETED
        self.result = result

    def fail(self) -> None:
        self.status = InvocationStatus.FAILED

    def __str__(self) -> str:
        return f"ToolInvocation(tool={self.tool_name!r}, status={self.status.value})"
