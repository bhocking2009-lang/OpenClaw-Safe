"""PluginSDKAPI – the restricted API surface exposed to plugin processes."""

from __future__ import annotations

from typing import Any, Callable, TYPE_CHECKING

if TYPE_CHECKING:
    from openclaw_safe.kernel.scoped_token import ScopedCapabilityToken


class PluginSDKAPI:
    """
    Provides the approved API surface for a plugin to interact with the kernel.

    Only capabilities listed in the associated ScopedCapabilityToken are
    accessible.  All calls are gated and any out-of-scope call raises
    PermissionError.
    """

    def __init__(self, token: "ScopedCapabilityToken") -> None:
        self._token = token
        self._handlers: dict[str, Callable[..., Any]] = {}

    def register_handler(self, capability: str, fn: Callable[..., Any]) -> None:
        self._handlers[capability] = fn

    def call(self, capability: str, **kwargs: Any) -> Any:
        if not self._token.allows(capability):
            raise PermissionError(
                f"Capability '{capability}' is not granted by the current token "
                f"(plugin={self._token.plugin_name!r})."
            )
        fn = self._handlers.get(capability)
        if fn is None:
            raise NotImplementedError(
                f"No handler registered for capability '{capability}'."
            )
        return fn(**kwargs)

    @property
    def granted_capabilities(self) -> list[str]:
        return list(self._token.granted_capabilities)

    def __str__(self) -> str:
        return (
            f"PluginSDKAPI(plugin={self._token.plugin_name!r}, "
            f"caps={self.granted_capabilities})"
        )
