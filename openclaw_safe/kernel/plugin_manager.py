"""PluginManager – registers, validates, and manages plugin lifecycle."""

from __future__ import annotations

from dataclasses import dataclass, field

from .capability_manifest import CapabilityManifest
from .policy_engine import PolicyEngine
from .scoped_token import ScopedCapabilityToken
from .plugin_process import PluginProcess
from .audit_log import AuditLog, AuditEventKind
from ..sdk.plugin_sdk_api import PluginSDKAPI


@dataclass
class PluginRegistration:
    manifest: CapabilityManifest
    session_id: str


class PluginManager:
    """
    Manages the full plugin lifecycle (diagram 2):

        Gateway → PluginManager → CapabilityManifest → PolicyEngine
            → ScopedCapabilityToken → PluginProcess
    """

    def __init__(
        self,
        policy_engine: PolicyEngine,
        audit_log: AuditLog | None = None,
    ) -> None:
        self._policy_engine = policy_engine
        self._audit_log = audit_log
        self._registrations: dict[str, PluginRegistration] = {}

    def register(
        self, manifest: CapabilityManifest, session_id: str
    ) -> ScopedCapabilityToken:
        """
        Register a plugin: validate its manifest against policy and return a
        ScopedCapabilityToken that limits its API surface.
        """
        granted: list[str] = []
        denied: list[str] = []

        for cap in manifest.capabilities:
            evaluation = self._policy_engine.evaluate(
                tool_name=cap.name,
                actor_id=session_id,
                manifest=manifest,
            )
            if evaluation.is_allowed:
                granted.append(cap.name)
            else:
                denied.append(cap.name)

        token = ScopedCapabilityToken(
            plugin_name=manifest.plugin_name,
            granted_capabilities=granted,
            session_id=session_id,
        )

        self._registrations[manifest.plugin_name] = PluginRegistration(
            manifest=manifest, session_id=session_id
        )

        if self._audit_log is not None:
            self._audit_log.record(
                AuditEventKind.PLUGIN_REGISTERED,
                actor_id=session_id,
                plugin=manifest.plugin_name,
                granted=granted,
                denied=denied,
            )
            self._audit_log.record(
                AuditEventKind.CAPABILITY_TOKEN_ISSUED,
                actor_id=session_id,
                plugin=manifest.plugin_name,
                token_id=token.id,
            )

        return token

    def unregister(self, plugin_name: str, session_id: str) -> None:
        if plugin_name not in self._registrations:
            raise KeyError(f"Plugin '{plugin_name}' is not registered.")
        del self._registrations[plugin_name]
        if self._audit_log is not None:
            self._audit_log.record(
                AuditEventKind.PLUGIN_UNREGISTERED,
                actor_id=session_id,
                plugin=plugin_name,
            )

    def spawn_process(self, token: ScopedCapabilityToken) -> PluginProcess:
        sdk = PluginSDKAPI(token)
        return PluginProcess(
            plugin_name=token.plugin_name,
            token=token,
            sdk=sdk,
        )

    @property
    def registered_plugins(self) -> list[str]:
        return list(self._registrations.keys())
