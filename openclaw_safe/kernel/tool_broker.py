"""ToolBroker – dispatches approved tool invocations to sandbox or host elevation."""

from __future__ import annotations

from typing import Any

from .policy_engine import PolicyDecision, PolicyEvaluation
from .sandbox_worker import SandboxWorker
from .host_elevation import HostElevationPath
from .audit_log import AuditLog, AuditEventKind
from ..models.tool_invocation import ToolInvocation
from ..models.artifact import Artifact
from ..models.approval_request import ApprovalRequest, ApprovalStatus


class ToolBroker:
    """
    Routes tool invocations based on policy evaluation (diagram 4):

        PolicyEngine decision
            → allow low risk   → SandboxWorker   → AuditLog
            → approved         → SandboxWorker   → AuditLog
            → break-glass only → HostElevationPath → AuditLog
            → deny             → raise PermissionError
    """

    def __init__(
        self,
        sandbox: SandboxWorker,
        host_elevation: HostElevationPath,
        audit_log: AuditLog | None = None,
    ) -> None:
        self._sandbox = sandbox
        self._host_elevation = host_elevation
        self._audit_log = audit_log

    def dispatch(
        self,
        invocation: ToolInvocation,
        evaluation: PolicyEvaluation,
        actor_id: str,
        approval: ApprovalRequest | None = None,
        break_glass_token: str = "",
    ) -> Artifact:
        """
        Dispatch *invocation* based on its policy *evaluation*.

        Parameters
        ----------
        invocation:
            The tool call to execute.
        evaluation:
            The outcome of PolicyEngine.evaluate().
        actor_id:
            The session/principal ID for audit purposes.
        approval:
            A resolved ApprovalRequest, required when the evaluation is
            REQUIRE_APPROVAL.
        break_glass_token:
            Non-empty token required to reach the HostElevationPath.
        """
        if evaluation.is_denied:
            invocation.deny()
            raise PermissionError(evaluation.reason)

        if evaluation.needs_approval:
            if approval is None or approval.status != ApprovalStatus.APPROVED:
                invocation.deny()
                raise PermissionError(
                    f"Tool '{invocation.tool_name}' requires an approved "
                    "ApprovalRequest before execution."
                )

        if break_glass_token:
            return self._host_elevation.execute(
                invocation, actor_id=actor_id, break_glass_token=break_glass_token
            )

        return self._sandbox.execute(invocation, actor_id=actor_id)
