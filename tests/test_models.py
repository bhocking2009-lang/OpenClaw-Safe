"""Tests for data models."""

from __future__ import annotations

import pytest

from openclaw_safe.models import (
    Principal,
    AgentProfile,
    Session,
    Task,
    TaskStep,
    MemoryItem,
    ToolInvocation,
    Artifact,
    ApprovalRequest,
    ApprovalStatus,
)
from openclaw_safe.models.principal import PrincipalRole
from openclaw_safe.models.task import TaskStatus
from openclaw_safe.models.tool_invocation import InvocationStatus


class TestPrincipal:
    def test_creation(self):
        p = Principal(name="Alice", role=PrincipalRole.OPERATOR)
        assert p.name == "Alice"
        assert p.role == PrincipalRole.OPERATOR
        assert p.id  # auto-generated UUID

    def test_unique_ids(self):
        p1 = Principal(name="A", role=PrincipalRole.FAMILY)
        p2 = Principal(name="B", role=PrincipalRole.FAMILY)
        assert p1.id != p2.id


class TestAgentProfile:
    def test_has_capability(self):
        profile = AgentProfile(name="bot", model="gpt-4", declared_capabilities=["read_file"])
        assert profile.has_capability("read_file")
        assert not profile.has_capability("write_file")


class TestSession:
    def test_session_lifecycle(self):
        principal = Principal(name="Bob", role=PrincipalRole.TRUSTED_MEMBER)
        agent = AgentProfile(name="helper", model="claude-3")
        session = Session(principal=principal, agent_profile=agent)
        assert session.active
        session.close()
        assert not session.active

    def test_add_task_and_memory(self):
        principal = Principal(name="Carol", role=PrincipalRole.OPERATOR)
        agent = AgentProfile(name="agent", model="model-x")
        session = Session(principal=principal, agent_profile=agent)
        task = Task(goal="do something")
        memory = MemoryItem(key="user_pref", value="dark_mode")
        session.add_task(task)
        session.add_memory(memory)
        assert task in session.tasks
        assert memory in session.memory


class TestTask:
    def test_task_status_transitions(self):
        task = Task(goal="write a report")
        assert task.status == TaskStatus.PENDING
        task.start()
        assert task.status == TaskStatus.IN_PROGRESS
        task.complete()
        assert task.status == TaskStatus.COMPLETED

    def test_task_fail(self):
        task = Task(goal="broken task")
        task.fail()
        assert task.status == TaskStatus.FAILED

    def test_add_step(self):
        task = Task(goal="multi-step")
        step = TaskStep(description="step 1")
        task.add_step(step)
        assert step in task.steps


class TestToolInvocation:
    def test_status_transitions(self):
        inv = ToolInvocation(tool_name="read_file", arguments={"path": "/tmp/x"})
        assert inv.status == InvocationStatus.PENDING
        inv.approve()
        assert inv.status == InvocationStatus.APPROVED
        inv.complete(result="hello")
        assert inv.status == InvocationStatus.COMPLETED
        assert inv.result == "hello"

    def test_deny(self):
        inv = ToolInvocation(tool_name="rm_rf")
        inv.deny()
        assert inv.status == InvocationStatus.DENIED


class TestApprovalRequest:
    def test_approve(self):
        req = ApprovalRequest(invocation_id="abc", reason="high risk")
        assert req.status == ApprovalStatus.PENDING
        assert not req.is_resolved
        req.approve()
        assert req.status == ApprovalStatus.APPROVED
        assert req.is_resolved
        assert req.resolved_at is not None

    def test_deny(self):
        req = ApprovalRequest(invocation_id="abc", reason="too risky")
        req.deny()
        assert req.status == ApprovalStatus.DENIED
