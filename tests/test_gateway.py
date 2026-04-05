"""Tests for the Gateway – the end-to-end kernel entry point."""

from __future__ import annotations

import pytest

from openclaw_safe.kernel.gateway import Gateway
from openclaw_safe.kernel.policy_engine import PolicyEngine
from openclaw_safe.kernel.plugin_manager import PluginManager
from openclaw_safe.kernel.tool_broker import ToolBroker
from openclaw_safe.kernel.sandbox_worker import SandboxWorker
from openclaw_safe.kernel.host_elevation import HostElevationPath
from openclaw_safe.kernel.audit_log import AuditLog, AuditEventKind
from openclaw_safe.kernel.capability_manifest import (
    CapabilityManifest,
    Capability,
    RiskLevel,
)
from openclaw_safe.models.principal import Principal, PrincipalRole
from openclaw_safe.models.agent_profile import AgentProfile
from openclaw_safe.models.task import TaskStep
from openclaw_safe.models.approval_request import ApprovalRequest


def _build_gateway() -> tuple[Gateway, SandboxWorker, AuditLog]:
    audit = AuditLog()
    policy = PolicyEngine(audit_log=audit)
    sandbox = SandboxWorker(audit_log=audit)
    elev = HostElevationPath(audit_log=audit)
    broker = ToolBroker(sandbox=sandbox, host_elevation=elev, audit_log=audit)
    manager = PluginManager(policy_engine=policy, audit_log=audit)
    gw = Gateway(
        policy_engine=policy,
        plugin_manager=manager,
        tool_broker=broker,
        audit_log=audit,
    )
    return gw, sandbox, audit


class TestGateway:
    def setup_method(self):
        self.gw, self.sandbox, self.audit = _build_gateway()
        self.principal = Principal(name="Alice", role=PrincipalRole.OPERATOR)
        self.agent = AgentProfile(name="helper", model="gpt-4")

    def test_open_and_close_session(self):
        session = self.gw.open_session(self.principal, self.agent)
        assert session.active
        events = self.audit.events_by_kind(AuditEventKind.SESSION_CREATED)
        assert len(events) == 1

        self.gw.close_session(session)
        assert not session.active
        events = self.audit.events_by_kind(AuditEventKind.SESSION_CLOSED)
        assert len(events) == 1

    def test_create_task(self):
        session = self.gw.open_session(self.principal, self.agent)
        task = self.gw.create_task(session, goal="summarise report")
        assert task in session.tasks
        events = self.audit.events_by_kind(AuditEventKind.TASK_CREATED)
        assert len(events) == 1

    def test_invoke_low_risk_tool(self):
        self.sandbox.register_tool("echo", lambda msg: msg)
        manifest = CapabilityManifest(plugin_name="test", version="1.0")
        manifest.add_capability(Capability("echo", "echo tool", RiskLevel.LOW))

        session = self.gw.open_session(self.principal, self.agent)
        task = self.gw.create_task(session, goal="echo something")
        step = TaskStep(description="do echo")
        task.add_step(step)

        artifact = self.gw.invoke_tool(
            session=session,
            task_step=step,
            tool_name="echo",
            arguments={"msg": "hello"},
            manifest=manifest,
        )
        assert artifact.content == "hello"

    def test_invoke_denied_tool_raises(self):
        manifest = CapabilityManifest(plugin_name="test", version="1.0")
        manifest.add_capability(
            Capability("nuke", "delete everything", RiskLevel.CRITICAL)
        )
        session = self.gw.open_session(self.principal, self.agent)
        step = TaskStep(description="nuke")
        with pytest.raises(PermissionError):
            self.gw.invoke_tool(
                session=session,
                task_step=step,
                tool_name="nuke",
                manifest=manifest,
            )

    def test_invoke_approval_required_without_approval_raises(self):
        manifest = CapabilityManifest(plugin_name="test", version="1.0")
        manifest.add_capability(
            Capability("risky_op", "risky", RiskLevel.MEDIUM)
        )
        session = self.gw.open_session(self.principal, self.agent)
        step = TaskStep(description="risky step")
        with pytest.raises(PermissionError):
            self.gw.invoke_tool(
                session=session,
                task_step=step,
                tool_name="risky_op",
                manifest=manifest,
            )

    def test_invoke_approval_required_with_approval(self):
        self.sandbox.register_tool("risky_op", lambda: "done")
        manifest = CapabilityManifest(plugin_name="test", version="1.0")
        manifest.add_capability(
            Capability("risky_op", "risky", RiskLevel.MEDIUM)
        )
        session = self.gw.open_session(self.principal, self.agent)
        step = TaskStep(description="risky step")

        approval = ApprovalRequest(invocation_id="pre-created", reason="test approval")
        approval.approve()

        artifact = self.gw.invoke_tool(
            session=session,
            task_step=step,
            tool_name="risky_op",
            manifest=manifest,
            approval=approval,
        )
        assert artifact.content == "done"

    def test_remember(self):
        session = self.gw.open_session(self.principal, self.agent)
        item = self.gw.remember(session, key="theme", value="dark")
        assert item in session.memory
        assert item.key == "theme"

    def test_register_plugin(self):
        session = self.gw.open_session(self.principal, self.agent)
        manifest = CapabilityManifest(plugin_name="my_plugin", version="2.0")
        manifest.add_capability(Capability("read_file", "read a file", RiskLevel.LOW))
        token = self.gw.register_plugin(manifest, session)
        assert "read_file" in token.granted_capabilities
        assert token.is_valid
