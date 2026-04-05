"""DesktopNode – native desktop application node."""

from __future__ import annotations

from typing import Any

from .base import BaseNode
from ..kernel.gateway import Gateway
from ..models.session import Session


class DesktopNode(BaseNode):
    """
    Connects a desktop application (e.g. Electron / Qt) to the kernel gateway.
    """

    node_type = "desktop"

    def __init__(self, gateway: Gateway, session: Session) -> None:
        self._gateway = gateway
        self._session = session

    def dispatch(self, message: str, context: dict[str, Any] | None = None) -> Any:
        task = self._gateway.create_task(self._session, goal=message)
        return task
