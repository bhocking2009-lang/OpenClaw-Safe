"""Slack channel adapter."""

from __future__ import annotations

from typing import Any

from .base import BaseChannel


class SlackChannel(BaseChannel):
    """Adapter for the Slack Events / Web API."""

    channel_name = "slack"

    def __init__(self, bot_token: str, signing_secret: str) -> None:
        self._bot_token = bot_token
        self._signing_secret = signing_secret

    def send_message(self, recipient_id: str, text: str, **kwargs: Any) -> None:
        # In production: POST to https://slack.com/api/chat.postMessage
        raise NotImplementedError(
            "SlackChannel.send_message requires a live bot token and HTTP client."
        )

    def receive_message(self, payload: dict[str, Any]) -> dict[str, Any]:
        event = payload.get("event", payload)
        return {
            "sender_id": event.get("user", ""),
            "text": event.get("text", ""),
            "channel": self.channel_name,
            "raw": payload,
        }
