"""PluginProcess – a running instance of a plugin with its scoped token."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable

from .scoped_token import ScopedCapabilityToken
from .audit_log import AuditLog, AuditEventKind
from ..sdk.plugin_sdk_api import PluginSDKAPI


class PluginState(str, Enum):
    READY = "ready"
    RUNNING = "running"
    STOPPED = "stopped"
    ERROR = "error"


@dataclass
class PluginProcess:
    """
    Represents a running plugin with a scoped token constraining its API access.

    Each PluginProcess receives a PluginSDKAPI instance whose permissions are
    limited to the capabilities granted in the ScopedCapabilityToken.
    """

    plugin_name: str
    token: ScopedCapabilityToken
    sdk: PluginSDKAPI
    state: PluginState = PluginState.READY

    def run(self, task: Callable[..., Any], **kwargs: Any) -> Any:
        if self.token.is_expired:
            self.state = PluginState.ERROR
            raise PermissionError(
                f"Plugin '{self.plugin_name}': capability token has expired."
            )
        self.state = PluginState.RUNNING
        try:
            result = task(sdk=self.sdk, **kwargs)
            self.state = PluginState.READY
            return result
        except Exception:
            self.state = PluginState.ERROR
            raise

    def stop(self) -> None:
        self.state = PluginState.STOPPED

    def __str__(self) -> str:
        return f"PluginProcess({self.plugin_name!r}, state={self.state.value})"
