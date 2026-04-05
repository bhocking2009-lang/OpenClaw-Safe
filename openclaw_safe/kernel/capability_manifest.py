"""CapabilityManifest – declares what capabilities a plugin requires."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum


class RiskLevel(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


@dataclass
class Capability:
    """A single declared capability with its associated risk level."""

    name: str
    description: str
    risk_level: RiskLevel = RiskLevel.LOW

    def __str__(self) -> str:
        return f"Capability({self.name!r}, risk={self.risk_level.value})"


@dataclass
class CapabilityManifest:
    """The full set of capabilities declared by a plugin."""

    plugin_name: str
    version: str
    capabilities: list[Capability] = field(default_factory=list)

    def add_capability(self, capability: Capability) -> None:
        self.capabilities.append(capability)

    def get_capability(self, name: str) -> Capability | None:
        for cap in self.capabilities:
            if cap.name == name:
                return cap
        return None

    def max_risk_level(self) -> RiskLevel:
        if not self.capabilities:
            return RiskLevel.LOW
        order = [RiskLevel.LOW, RiskLevel.MEDIUM, RiskLevel.HIGH, RiskLevel.CRITICAL]
        max_idx = max(order.index(c.risk_level) for c in self.capabilities)
        return order[max_idx]

    def __str__(self) -> str:
        return (
            f"CapabilityManifest(plugin={self.plugin_name!r}, "
            f"version={self.version!r}, capabilities={len(self.capabilities)})"
        )
