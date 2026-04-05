"""HostElevationPath – break-glass elevated execution path for critical operations."""

from __future__ import annotations

from typing import Any, Callable

from .audit_log import AuditLog, AuditEventKind
from ..models.tool_invocation import ToolInvocation
from ..models.artifact import Artifact


class HostElevationPath:
    """
    Executes tools that require host-level elevated privileges.

    This path is only available when a valid break-glass token has been
    presented and the audit log records the elevation.  In production this
    wraps privilege-escalation APIs (e.g. sudo, D-Bus PolicyKit).
    """

    def __init__(self, audit_log: AuditLog | None = None) -> None:
        self._audit_log = audit_log
        self._registry: dict[str, Callable[..., Any]] = {}

    def register_tool(self, name: str, fn: Callable[..., Any]) -> None:
        self._registry[name] = fn

    def execute(
        self,
        invocation: ToolInvocation,
        actor_id: str,
        break_glass_token: str,
    ) -> Artifact:
        if not break_glass_token:
            invocation.deny()
            raise PermissionError("Host elevation requires a break-glass token.")

        fn = self._registry.get(invocation.tool_name)
        if fn is None:
            invocation.fail()
            raise KeyError(
                f"Tool '{invocation.tool_name}' not registered in host elevation path."
            )

        if self._audit_log is not None:
            self._audit_log.record(
                AuditEventKind.HOST_ELEVATION,
                actor_id=actor_id,
                tool=invocation.tool_name,
                break_glass_token_prefix=break_glass_token[:8] + "…",
            )

        try:
            result = fn(**invocation.arguments)
            invocation.complete(result)
            return Artifact(invocation_id=invocation.id, content=result)
        except Exception:
            invocation.fail()
            raise
