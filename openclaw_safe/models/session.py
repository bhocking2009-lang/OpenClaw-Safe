"""Session – binds a Principal to an AgentProfile for the duration of an interaction."""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .principal import Principal
    from .agent_profile import AgentProfile
    from .task import Task
    from .memory_item import MemoryItem


@dataclass
class Session:
    """A live session connecting a Principal with an Agent."""

    principal: "Principal"
    agent_profile: "AgentProfile"
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    tasks: list["Task"] = field(default_factory=list)
    memory: list["MemoryItem"] = field(default_factory=list)
    active: bool = True

    def add_task(self, task: "Task") -> None:
        self.tasks.append(task)

    def add_memory(self, item: "MemoryItem") -> None:
        self.memory.append(item)

    def close(self) -> None:
        self.active = False

    def __str__(self) -> str:
        return (
            f"Session(id={self.id!r}, principal={self.principal}, "
            f"agent={self.agent_profile})"
        )
