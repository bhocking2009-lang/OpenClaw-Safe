"""Principal – a human operator, family member, or trusted team member."""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from enum import Enum


class PrincipalRole(str, Enum):
    OPERATOR = "operator"
    FAMILY = "family"
    TRUSTED_MEMBER = "trusted_member"


@dataclass
class Principal:
    """Represents a human principal who owns or interacts with the system."""

    name: str
    role: PrincipalRole
    id: str = field(default_factory=lambda: str(uuid.uuid4()))

    def __str__(self) -> str:
        return f"Principal({self.name!r}, role={self.role.value})"
