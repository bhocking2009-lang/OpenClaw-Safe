"""Task and TaskStep – units of work within a Session."""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .tool_invocation import ToolInvocation


class TaskStatus(str, Enum):
    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    FAILED = "failed"


@dataclass
class TaskStep:
    """A single step within a Task, producing zero or more ToolInvocations."""

    description: str
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    invocations: list["ToolInvocation"] = field(default_factory=list)

    def add_invocation(self, invocation: "ToolInvocation") -> None:
        self.invocations.append(invocation)

    def __str__(self) -> str:
        return f"TaskStep({self.description!r})"


@dataclass
class Task:
    """A goal-oriented unit of work composed of ordered TaskSteps."""

    goal: str
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    status: TaskStatus = TaskStatus.PENDING
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    steps: list[TaskStep] = field(default_factory=list)

    def add_step(self, step: TaskStep) -> None:
        self.steps.append(step)

    def start(self) -> None:
        self.status = TaskStatus.IN_PROGRESS

    def complete(self) -> None:
        self.status = TaskStatus.COMPLETED

    def fail(self) -> None:
        self.status = TaskStatus.FAILED

    def __str__(self) -> str:
        return f"Task({self.goal!r}, status={self.status.value})"
