"""Channel adapters – inbound/outbound messaging integrations."""

from .base import BaseChannel
from .telegram import TelegramChannel
from .slack import SlackChannel
from .discord import DiscordChannel
from .whatsapp import WhatsAppChannel
from .webchat import WebChatChannel

__all__ = [
    "BaseChannel",
    "TelegramChannel",
    "SlackChannel",
    "DiscordChannel",
    "WhatsAppChannel",
    "WebChatChannel",
]
