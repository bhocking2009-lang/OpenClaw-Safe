"""Base class for channel adapters."""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any


class BaseChannel(ABC):
    """Common interface for all inbound message channels."""

    channel_name: str = "base"

    @abstractmethod
    def send_message(self, recipient_id: str, text: str, **kwargs: Any) -> None:
        """Send a text message to a recipient on this channel."""

    @abstractmethod
    def receive_message(self, payload: dict[str, Any]) -> dict[str, Any]:
        """
        Parse an incoming webhook/event payload into a normalised message dict.

        The returned dict must include at least:
            ``sender_id``   – channel-specific user identifier
            ``text``        – message body
            ``channel``     – value of ``self.channel_name``
        """
