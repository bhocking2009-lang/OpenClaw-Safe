"""PolicyEngine – evaluates tool invocations and routes them appropriately."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any

from .capability_manifest import CapabilityManifest, RiskLevel
from .audit_log import AuditLog, AuditEventKind


class PolicyDecision(str, Enum):
    ALLOW = "allow"
    REQUIRE_APPROVAL = "require_approval"
    DENY = "deny"


@dataclass
class PolicyRule:
    """A rule that maps a risk level to a policy decision."""

    risk_level: RiskLevel
    decision: PolicyDecision


# Default risk-to-decision mapping (can be customised)
_DEFAULT_RULES: list[PolicyRule] = [
    PolicyRule(RiskLevel.LOW, PolicyDecision.ALLOW),
    PolicyRule(RiskLevel.MEDIUM, PolicyDecision.REQUIRE_APPROVAL),
    PolicyRule(RiskLevel.HIGH, PolicyDecision.REQUIRE_APPROVAL),
    PolicyRule(RiskLevel.CRITICAL, PolicyDecision.DENY),
]


@dataclass
class PolicyEvaluation:
    """The outcome of evaluating a tool invocation against policy."""

    decision: PolicyDecision
    tool_name: str
    risk_level: RiskLevel
    reason: str
    details: dict[str, Any] = field(default_factory=dict)

    @property
    def is_allowed(self) -> bool:
        return self.decision == PolicyDecision.ALLOW

    @property
    def needs_approval(self) -> bool:
        return self.decision == PolicyDecision.REQUIRE_APPROVAL

    @property
    def is_denied(self) -> bool:
        return self.decision == PolicyDecision.DENY


class PolicyEngine:
    """
    Evaluates proposed tool actions against declared capabilities and configured rules.

    Flow (from diagram 4):
        Model proposes action
            → PolicyEngine
                → deny          (blocked immediately)
                → allow low risk → ToolBroker
                → require approval → UserApproval → ToolBroker
    """

    def __init__(
        self,
        rules: list[PolicyRule] | None = None,
        audit_log: AuditLog | None = None,
    ) -> None:
        self._rules: dict[RiskLevel, PolicyDecision] = {
            r.risk_level: r.decision for r in (rules or _DEFAULT_RULES)
        }
        self._audit_log = audit_log

    def _get_risk_level(
        self, tool_name: str, manifest: CapabilityManifest | None
    ) -> RiskLevel:
        if manifest is None:
            return RiskLevel.HIGH
        cap = manifest.get_capability(tool_name)
        if cap is None:
            # Tool not declared in manifest – treat as high risk
            return RiskLevel.HIGH
        return cap.risk_level

    def evaluate(
        self,
        tool_name: str,
        actor_id: str,
        manifest: CapabilityManifest | None = None,
    ) -> PolicyEvaluation:
        risk = self._get_risk_level(tool_name, manifest)
        decision = self._rules.get(risk, PolicyDecision.DENY)

        reason_map = {
            PolicyDecision.ALLOW: f"Tool '{tool_name}' is low-risk and auto-approved.",
            PolicyDecision.REQUIRE_APPROVAL: (
                f"Tool '{tool_name}' requires human approval (risk={risk.value})."
            ),
            PolicyDecision.DENY: (
                f"Tool '{tool_name}' is denied by policy (risk={risk.value})."
            ),
        }

        evaluation = PolicyEvaluation(
            decision=decision,
            tool_name=tool_name,
            risk_level=risk,
            reason=reason_map[decision],
        )

        if self._audit_log is not None:
            kind_map = {
                PolicyDecision.ALLOW: AuditEventKind.TOOL_ALLOWED,
                PolicyDecision.REQUIRE_APPROVAL: AuditEventKind.APPROVAL_REQUESTED,
                PolicyDecision.DENY: AuditEventKind.TOOL_DENIED,
            }
            self._audit_log.record(
                kind_map[decision],
                actor_id=actor_id,
                tool=tool_name,
                risk=risk.value,
                reason=evaluation.reason,
            )

        return evaluation
