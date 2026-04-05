"""Artifact – output produced by a ToolInvocation."""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any


@dataclass
class Artifact:
    """An output artifact produced when a tool executes successfully."""

    invocation_id: str
    content: Any
    mime_type: str = "text/plain"
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    def __str__(self) -> str:
        return f"Artifact(invocation_id={self.invocation_id!r}, mime={self.mime_type!r})"
