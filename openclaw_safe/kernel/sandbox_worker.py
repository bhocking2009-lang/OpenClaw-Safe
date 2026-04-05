"""SandboxWorker – executes tool functions in an isolated context."""

from __future__ import annotations

from typing import Any, Callable

from .audit_log import AuditLog, AuditEventKind
from ..models.tool_invocation import ToolInvocation
from ..models.artifact import Artifact


class SandboxWorker:
    """
    Executes tool callables in a restricted sandbox environment.

    In a production deployment this would run inside an OS-level sandbox
    (e.g. seccomp, gVisor, Firecracker).  This implementation wraps the
    callable and captures its output as an Artifact.
    """

    def __init__(self, audit_log: AuditLog | None = None) -> None:
        self._audit_log = audit_log
        self._registry: dict[str, Callable[..., Any]] = {}

    def register_tool(self, name: str, fn: Callable[..., Any]) -> None:
        self._registry[name] = fn

    def execute(self, invocation: ToolInvocation, actor_id: str) -> Artifact:
        fn = self._registry.get(invocation.tool_name)
        if fn is None:
            invocation.fail()
            raise KeyError(f"Tool '{invocation.tool_name}' not registered in sandbox.")

        try:
            result = fn(**invocation.arguments)
            invocation.complete(result)
            artifact = Artifact(
                invocation_id=invocation.id,
                content=result,
            )
        except Exception as exc:
            invocation.fail()
            if self._audit_log is not None:
                self._audit_log.record(
                    AuditEventKind.SANDBOX_EXECUTION,
                    actor_id=actor_id,
                    tool=invocation.tool_name,
                    success=False,
                    error=str(exc),
                )
            raise

        if self._audit_log is not None:
            self._audit_log.record(
                AuditEventKind.SANDBOX_EXECUTION,
                actor_id=actor_id,
                tool=invocation.tool_name,
                success=True,
                artifact_id=artifact.id,
            )

        return artifact
