"""MemoryItem – persisted knowledge attached to a Session."""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any


@dataclass
class MemoryItem:
    """A piece of information stored in a session's long-term memory."""

    key: str
    value: Any
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    def __str__(self) -> str:
        return f"MemoryItem(key={self.key!r})"
