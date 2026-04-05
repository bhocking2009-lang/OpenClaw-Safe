"""Discord channel adapter."""

from __future__ import annotations

from typing import Any

from .base import BaseChannel


class DiscordChannel(BaseChannel):
    """Adapter for the Discord Bot API / Interactions."""

    channel_name = "discord"

    def __init__(self, bot_token: str, application_id: str) -> None:
        self._bot_token = bot_token
        self._application_id = application_id

    def send_message(self, recipient_id: str, text: str, **kwargs: Any) -> None:
        # In production: POST to Discord REST API channels/{id}/messages
        raise NotImplementedError(
            "DiscordChannel.send_message requires a live bot token and HTTP client."
        )

    def receive_message(self, payload: dict[str, Any]) -> dict[str, Any]:
        return {
            "sender_id": str(payload.get("author", {}).get("id", "")),
            "text": payload.get("content", ""),
            "channel": self.channel_name,
            "raw": payload,
        }
