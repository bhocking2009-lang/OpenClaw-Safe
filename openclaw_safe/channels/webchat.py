"""WebChat channel adapter – generic HTTP/WebSocket-based chat interface."""

from __future__ import annotations

from typing import Any

from .base import BaseChannel


class WebChatChannel(BaseChannel):
    """Adapter for a browser-based WebChat widget."""

    channel_name = "webchat"

    def send_message(self, recipient_id: str, text: str, **kwargs: Any) -> None:
        # In production: push message to client via WebSocket or SSE
        raise NotImplementedError(
            "WebChatChannel.send_message requires a live WebSocket/SSE connection."
        )

    def receive_message(self, payload: dict[str, Any]) -> dict[str, Any]:
        return {
            "sender_id": payload.get("user_id", ""),
            "text": payload.get("message", ""),
            "channel": self.channel_name,
            "raw": payload,
        }
