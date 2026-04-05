"""ScopedCapabilityToken – a short-lived token granting limited capabilities to a plugin."""

from __future__ import annotations

import secrets
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone


_DEFAULT_TTL_SECONDS = 300  # 5 minutes


@dataclass
class ScopedCapabilityToken:
    """A cryptographically random token that scopes plugin access to declared capabilities."""

    plugin_name: str
    granted_capabilities: list[str]
    session_id: str
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    token: str = field(default_factory=lambda: secrets.token_hex(32))
    issued_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    expires_at: datetime = field(
        default_factory=lambda: datetime.now(timezone.utc)
        + timedelta(seconds=_DEFAULT_TTL_SECONDS)
    )

    @property
    def is_expired(self) -> bool:
        return datetime.now(timezone.utc) >= self.expires_at

    @property
    def is_valid(self) -> bool:
        return not self.is_expired

    def allows(self, capability: str) -> bool:
        return capability in self.granted_capabilities and self.is_valid

    def __str__(self) -> str:
        status = "valid" if self.is_valid else "expired"
        return (
            f"ScopedCapabilityToken(plugin={self.plugin_name!r}, "
            f"caps={self.granted_capabilities}, status={status})"
        )
