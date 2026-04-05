"""Tests for PolicyEngine."""

from __future__ import annotations

import pytest

from openclaw_safe.kernel.policy_engine import (
    PolicyEngine,
    PolicyDecision,
    PolicyRule,
)
from openclaw_safe.kernel.capability_manifest import (
    CapabilityManifest,
    Capability,
    RiskLevel,
)
from openclaw_safe.kernel.audit_log import AuditLog, AuditEventKind


def _make_manifest(*caps: tuple[str, RiskLevel]) -> CapabilityManifest:
    m = CapabilityManifest(plugin_name="test_plugin", version="1.0")
    for name, risk in caps:
        m.add_capability(Capability(name=name, description="", risk_level=risk))
    return m


class TestPolicyEngine:
    def setup_method(self):
        self.audit = AuditLog()
        self.engine = PolicyEngine(audit_log=self.audit)

    def test_low_risk_allowed(self):
        manifest = _make_manifest(("read_file", RiskLevel.LOW))
        result = self.engine.evaluate("read_file", actor_id="session-1", manifest=manifest)
        assert result.decision == PolicyDecision.ALLOW
        assert result.is_allowed

    def test_medium_risk_requires_approval(self):
        manifest = _make_manifest(("write_file", RiskLevel.MEDIUM))
        result = self.engine.evaluate("write_file", actor_id="session-1", manifest=manifest)
        assert result.decision == PolicyDecision.REQUIRE_APPROVAL
        assert result.needs_approval

    def test_high_risk_requires_approval(self):
        manifest = _make_manifest(("exec_shell", RiskLevel.HIGH))
        result = self.engine.evaluate("exec_shell", actor_id="session-1", manifest=manifest)
        assert result.decision == PolicyDecision.REQUIRE_APPROVAL

    def test_critical_risk_denied(self):
        manifest = _make_manifest(("delete_system", RiskLevel.CRITICAL))
        result = self.engine.evaluate("delete_system", actor_id="session-1", manifest=manifest)
        assert result.decision == PolicyDecision.DENY
        assert result.is_denied

    def test_undeclared_tool_treated_as_high(self):
        manifest = _make_manifest(("known_tool", RiskLevel.LOW))
        result = self.engine.evaluate("unknown_tool", actor_id="s1", manifest=manifest)
        assert result.risk_level == RiskLevel.HIGH
        assert result.needs_approval

    def test_no_manifest_treated_as_high(self):
        result = self.engine.evaluate("any_tool", actor_id="s1", manifest=None)
        assert result.risk_level == RiskLevel.HIGH

    def test_audit_log_populated(self):
        manifest = _make_manifest(("read_file", RiskLevel.LOW))
        self.engine.evaluate("read_file", actor_id="s1", manifest=manifest)
        assert len(self.audit) == 1
        assert self.audit.events[0].kind == AuditEventKind.TOOL_ALLOWED

    def test_custom_rules(self):
        custom_rules = [
            PolicyRule(RiskLevel.LOW, PolicyDecision.REQUIRE_APPROVAL),
            PolicyRule(RiskLevel.MEDIUM, PolicyDecision.DENY),
            PolicyRule(RiskLevel.HIGH, PolicyDecision.DENY),
            PolicyRule(RiskLevel.CRITICAL, PolicyDecision.DENY),
        ]
        engine = PolicyEngine(rules=custom_rules)
        manifest = _make_manifest(("read_file", RiskLevel.LOW))
        result = engine.evaluate("read_file", actor_id="s1", manifest=manifest)
        assert result.decision == PolicyDecision.REQUIRE_APPROVAL
