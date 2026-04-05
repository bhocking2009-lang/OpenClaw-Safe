"""Telegram channel adapter."""

from __future__ import annotations

from typing import Any

from .base import BaseChannel


class TelegramChannel(BaseChannel):
    """Adapter for the Telegram Bot API."""

    channel_name = "telegram"

    def __init__(self, bot_token: str) -> None:
        self._bot_token = bot_token

    def send_message(self, recipient_id: str, text: str, **kwargs: Any) -> None:
        # In production: POST to https://api.telegram.org/bot<token>/sendMessage
        raise NotImplementedError(
            "TelegramChannel.send_message requires a live bot token and HTTP client."
        )

    def receive_message(self, payload: dict[str, Any]) -> dict[str, Any]:
        update = payload.get("message", payload)
        return {
            "sender_id": str(update.get("from", {}).get("id", "")),
            "text": update.get("text", ""),
            "channel": self.channel_name,
            "raw": payload,
        }
