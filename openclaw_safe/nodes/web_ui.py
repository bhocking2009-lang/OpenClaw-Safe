"""WebUINode – browser-based web interface node."""

from __future__ import annotations

from typing import Any

from .base import BaseNode
from ..kernel.gateway import Gateway
from ..models.session import Session


class WebUINode(BaseNode):
    """
    Connects a browser-based web UI (React / Vue / etc.) to the kernel gateway.
    """

    node_type = "web_ui"

    def __init__(self, gateway: Gateway, session: Session) -> None:
        self._gateway = gateway
        self._session = session

    def dispatch(self, message: str, context: dict[str, Any] | None = None) -> Any:
        task = self._gateway.create_task(self._session, goal=message)
        return task
