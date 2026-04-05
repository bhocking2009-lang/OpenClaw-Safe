"""Tests for ToolBroker, SandboxWorker, and HostElevationPath."""

from __future__ import annotations

import pytest

from openclaw_safe.kernel.sandbox_worker import SandboxWorker
from openclaw_safe.kernel.host_elevation import HostElevationPath
from openclaw_safe.kernel.tool_broker import ToolBroker
from openclaw_safe.kernel.policy_engine import PolicyEngine, PolicyDecision, PolicyEvaluation
from openclaw_safe.kernel.capability_manifest import RiskLevel
from openclaw_safe.kernel.audit_log import AuditLog, AuditEventKind
from openclaw_safe.models.tool_invocation import ToolInvocation, InvocationStatus
from openclaw_safe.models.approval_request import ApprovalRequest, ApprovalStatus


def _make_evaluation(decision: PolicyDecision, tool: str = "my_tool") -> PolicyEvaluation:
    return PolicyEvaluation(
        decision=decision,
        tool_name=tool,
        risk_level=RiskLevel.LOW,
        reason="test",
    )


class TestSandboxWorker:
    def setup_method(self):
        self.audit = AuditLog()
        self.sandbox = SandboxWorker(audit_log=self.audit)
        self.sandbox.register_tool("add", lambda a, b: a + b)

    def test_successful_execution(self):
        inv = ToolInvocation(tool_name="add", arguments={"a": 1, "b": 2})
        artifact = self.sandbox.execute(inv, actor_id="s1")
        assert artifact.content == 3
        assert inv.status == InvocationStatus.COMPLETED

    def test_unregistered_tool_raises(self):
        inv = ToolInvocation(tool_name="nonexistent")
        with pytest.raises(KeyError):
            self.sandbox.execute(inv, actor_id="s1")
        assert inv.status == InvocationStatus.FAILED

    def test_audit_records_execution(self):
        inv = ToolInvocation(tool_name="add", arguments={"a": 5, "b": 5})
        self.sandbox.execute(inv, actor_id="s1")
        events = self.audit.events_by_kind(AuditEventKind.SANDBOX_EXECUTION)
        assert len(events) == 1
        assert events[0].details["success"] is True

    def test_failed_tool_audit(self):
        def boom(**_):
            raise RuntimeError("kaboom")

        self.sandbox.register_tool("boom", boom)
        inv = ToolInvocation(tool_name="boom")
        with pytest.raises(RuntimeError):
            self.sandbox.execute(inv, actor_id="s1")
        events = self.audit.events_by_kind(AuditEventKind.SANDBOX_EXECUTION)
        assert events[0].details["success"] is False


class TestHostElevationPath:
    def setup_method(self):
        self.audit = AuditLog()
        self.elev = HostElevationPath(audit_log=self.audit)
        self.elev.register_tool("privileged_op", lambda: "elevated_result")

    def test_requires_break_glass_token(self):
        inv = ToolInvocation(tool_name="privileged_op")
        with pytest.raises(PermissionError):
            self.elev.execute(inv, actor_id="s1", break_glass_token="")

    def test_executes_with_valid_token(self):
        inv = ToolInvocation(tool_name="privileged_op")
        artifact = self.elev.execute(inv, actor_id="s1", break_glass_token="secret-token")
        assert artifact.content == "elevated_result"
        events = self.audit.events_by_kind(AuditEventKind.HOST_ELEVATION)
        assert len(events) == 1

    def test_unregistered_tool_raises(self):
        inv = ToolInvocation(tool_name="nope")
        with pytest.raises(KeyError):
            self.elev.execute(inv, actor_id="s1", break_glass_token="token")


class TestToolBroker:
    def setup_method(self):
        self.audit = AuditLog()
        self.sandbox = SandboxWorker()
        self.sandbox.register_tool("safe_op", lambda: "safe_result")
        self.elev = HostElevationPath()
        self.elev.register_tool("privileged_op", lambda: "elevated_result")
        self.broker = ToolBroker(
            sandbox=self.sandbox,
            host_elevation=self.elev,
            audit_log=self.audit,
        )

    def test_allow_dispatches_to_sandbox(self):
        inv = ToolInvocation(tool_name="safe_op")
        evaluation = _make_evaluation(PolicyDecision.ALLOW, "safe_op")
        artifact = self.broker.dispatch(inv, evaluation, actor_id="s1")
        assert artifact.content == "safe_result"

    def test_deny_raises_permission_error(self):
        inv = ToolInvocation(tool_name="blocked")
        evaluation = _make_evaluation(PolicyDecision.DENY, "blocked")
        with pytest.raises(PermissionError):
            self.broker.dispatch(inv, evaluation, actor_id="s1")
        assert inv.status == InvocationStatus.DENIED

    def test_require_approval_without_approval_raises(self):
        inv = ToolInvocation(tool_name="safe_op")
        evaluation = _make_evaluation(PolicyDecision.REQUIRE_APPROVAL, "safe_op")
        with pytest.raises(PermissionError):
            self.broker.dispatch(inv, evaluation, actor_id="s1", approval=None)

    def test_require_approval_with_approved_approval(self):
        inv = ToolInvocation(tool_name="safe_op")
        evaluation = _make_evaluation(PolicyDecision.REQUIRE_APPROVAL, "safe_op")
        approval = ApprovalRequest(invocation_id=inv.id, reason="needs approval")
        approval.approve()
        artifact = self.broker.dispatch(inv, evaluation, actor_id="s1", approval=approval)
        assert artifact.content == "safe_result"

    def test_require_approval_with_denied_approval_raises(self):
        inv = ToolInvocation(tool_name="safe_op")
        evaluation = _make_evaluation(PolicyDecision.REQUIRE_APPROVAL, "safe_op")
        approval = ApprovalRequest(invocation_id=inv.id, reason="needs approval")
        approval.deny()
        with pytest.raises(PermissionError):
            self.broker.dispatch(inv, evaluation, actor_id="s1", approval=approval)

    def test_break_glass_routes_to_host_elevation(self):
        inv = ToolInvocation(tool_name="privileged_op")
        evaluation = _make_evaluation(PolicyDecision.ALLOW, "privileged_op")
        artifact = self.broker.dispatch(
            inv, evaluation, actor_id="s1", break_glass_token="secret"
        )
        assert artifact.content == "elevated_result"
