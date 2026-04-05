"""Gateway – the single entry point connecting all channels/nodes to the kernel."""

from __future__ import annotations

from typing import Any

from .plugin_manager import PluginManager
from .policy_engine import PolicyEngine
from .tool_broker import ToolBroker
from .audit_log import AuditLog, AuditEventKind
from ..models.principal import Principal
from ..models.agent_profile import AgentProfile
from ..models.session import Session
from ..models.task import Task, TaskStep
from ..models.memory_item import MemoryItem
from ..models.tool_invocation import ToolInvocation
from ..models.approval_request import ApprovalRequest, ApprovalStatus
from ..kernel.capability_manifest import CapabilityManifest


class Gateway:
    """
    OpenClaw Secure Gateway Kernel entry point (diagram 1 & 2).

    Operators, family members, and trusted team members connect through any
    supported channel (Telegram, Slack, Desktop Node, Mobile Node, Web UI / CLI)
    and all requests flow through this single secure gateway.
    """

    def __init__(
        self,
        policy_engine: PolicyEngine,
        plugin_manager: PluginManager,
        tool_broker: ToolBroker,
        audit_log: AuditLog,
    ) -> None:
        self._policy_engine = policy_engine
        self._plugin_manager = plugin_manager
        self._tool_broker = tool_broker
        self._audit_log = audit_log
        self._sessions: dict[str, Session] = {}

    # ------------------------------------------------------------------
    # Session management
    # ------------------------------------------------------------------

    def open_session(
        self, principal: Principal, agent_profile: AgentProfile
    ) -> Session:
        session = Session(principal=principal, agent_profile=agent_profile)
        self._sessions[session.id] = session
        self._audit_log.record(
            AuditEventKind.SESSION_CREATED,
            actor_id=principal.id,
            session_id=session.id,
            agent=agent_profile.name,
        )
        return session

    def close_session(self, session: Session) -> None:
        session.close()
        self._sessions.pop(session.id, None)
        self._audit_log.record(
            AuditEventKind.SESSION_CLOSED,
            actor_id=session.principal.id,
            session_id=session.id,
        )

    # ------------------------------------------------------------------
    # Task management
    # ------------------------------------------------------------------

    def create_task(self, session: Session, goal: str) -> Task:
        task = Task(goal=goal)
        session.add_task(task)
        self._audit_log.record(
            AuditEventKind.TASK_CREATED,
            actor_id=session.principal.id,
            session_id=session.id,
            task_id=task.id,
            goal=goal,
        )
        return task

    # ------------------------------------------------------------------
    # Tool invocation pipeline (diagram 4)
    # ------------------------------------------------------------------

    def invoke_tool(
        self,
        session: Session,
        task_step: TaskStep,
        tool_name: str,
        arguments: dict[str, Any] | None = None,
        manifest: CapabilityManifest | None = None,
        approval: ApprovalRequest | None = None,
        break_glass_token: str = "",
    ) -> Any:
        """
        Full pipeline: propose → policy evaluate → broker dispatch → audit.
        """
        invocation = ToolInvocation(
            tool_name=tool_name, arguments=arguments or {}
        )
        task_step.add_invocation(invocation)

        self._audit_log.record(
            AuditEventKind.TOOL_INVOKED,
            actor_id=session.principal.id,
            session_id=session.id,
            tool=tool_name,
            invocation_id=invocation.id,
        )

        evaluation = self._policy_engine.evaluate(
            tool_name=tool_name,
            actor_id=session.id,
            manifest=manifest,
        )

        artifact = self._tool_broker.dispatch(
            invocation=invocation,
            evaluation=evaluation,
            actor_id=session.id,
            approval=approval,
            break_glass_token=break_glass_token,
        )
        return artifact

    # ------------------------------------------------------------------
    # Plugin registration
    # ------------------------------------------------------------------

    def register_plugin(
        self, manifest: CapabilityManifest, session: Session
    ) -> Any:
        return self._plugin_manager.register(manifest, session_id=session.id)

    # ------------------------------------------------------------------
    # Memory helpers
    # ------------------------------------------------------------------

    def remember(self, session: Session, key: str, value: Any) -> MemoryItem:
        item = MemoryItem(key=key, value=value)
        session.add_memory(item)
        return item

    @property
    def audit_log(self) -> AuditLog:
        return self._audit_log
