"""Base class for node interfaces."""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any


class BaseNode(ABC):
    """Common interface for all client-facing node types."""

    node_type: str = "base"

    @abstractmethod
    def dispatch(self, message: str, context: dict[str, Any] | None = None) -> Any:
        """
        Send a message or command through this node to the kernel gateway.

        Parameters
        ----------
        message:
            The user-facing text input or command.
        context:
            Optional node-specific context (e.g., authenticated principal info).
        """
