"""AgentProfile – configuration and capability description of an AI agent."""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from typing import Any


@dataclass
class AgentProfile:
    """Describes an AI agent's identity, model, and declared capabilities."""

    name: str
    model: str
    declared_capabilities: list[str] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)
    id: str = field(default_factory=lambda: str(uuid.uuid4()))

    def has_capability(self, capability: str) -> bool:
        return capability in self.declared_capabilities

    def __str__(self) -> str:
        return f"AgentProfile({self.name!r}, model={self.model!r})"
