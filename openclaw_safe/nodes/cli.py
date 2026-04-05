"""CLINode – command-line interface node."""

from __future__ import annotations

from typing import Any

from .base import BaseNode
from ..kernel.gateway import Gateway
from ..models.session import Session


class CLINode(BaseNode):
    """
    Connects a command-line interface to the kernel gateway.
    """

    node_type = "cli"

    def __init__(self, gateway: Gateway, session: Session) -> None:
        self._gateway = gateway
        self._session = session

    def dispatch(self, message: str, context: dict[str, Any] | None = None) -> Any:
        task = self._gateway.create_task(self._session, goal=message)
        return task

    def run_interactive(self) -> None:
        """Start a blocking interactive REPL loop."""
        print("OpenClaw CLI – type 'exit' to quit.")
        while True:
            try:
                line = input(">>> ").strip()
            except (EOFError, KeyboardInterrupt):
                print()
                break
            if line.lower() in {"exit", "quit"}:
                break
            if not line:
                continue
            result = self.dispatch(line)
            print(f"Task created: {result}")
