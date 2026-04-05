"""WhatsApp channel adapter (Meta Cloud API)."""

from __future__ import annotations

from typing import Any

from .base import BaseChannel


class WhatsAppChannel(BaseChannel):
    """Adapter for the WhatsApp Business Cloud API."""

    channel_name = "whatsapp"

    def __init__(self, access_token: str, phone_number_id: str) -> None:
        self._access_token = access_token
        self._phone_number_id = phone_number_id

    def send_message(self, recipient_id: str, text: str, **kwargs: Any) -> None:
        # In production: POST to graph.facebook.com/v18.0/{phone-id}/messages
        raise NotImplementedError(
            "WhatsAppChannel.send_message requires a live access token and HTTP client."
        )

    def receive_message(self, payload: dict[str, Any]) -> dict[str, Any]:
        entry = payload.get("entry", [{}])[0]
        changes = entry.get("changes", [{}])[0]
        value = changes.get("value", {})
        messages = value.get("messages", [{}])
        msg = messages[0] if messages else {}
        return {
            "sender_id": msg.get("from", ""),
            "text": msg.get("text", {}).get("body", ""),
            "channel": self.channel_name,
            "raw": payload,
        }
