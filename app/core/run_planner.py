"""
run_planner.py — Build a RunPlan from capability scan results.

The planner applies the following rules in order:

1. For each domain, collect all tools in registry order (primary first,
   then fallbacks in preference order).
2. Select the first installed tool for the domain.
   a. If it is the primary tool, use Role.PRIMARY.
   b. If it is a fallback, use Role.FALLBACK.
3. If no tool is installed for a domain:
   a. If any tool in the domain is Tier.REQUIRED, add the primary to
      ``missing_required`` and emit a warning.
   b. Add a PlannedTool with skip_reason set.
4. Honour ``gui_toggle`` — if the operator has disabled a tool in the GUI
   preferences, treat it as if it were not installed.

Public API
----------
build_plan(
    scan_results: dict[str, CapabilityScanResult],
    disabled_tool_ids: set[str] | None = None,
) -> RunPlan
"""

from __future__ import annotations

from collections import defaultdict

from app.core.schemas import (
    CapabilityScanResult,
    Domain,
    PlannedTool,
    Role,
    RunPlan,
    Tier,
)
from app.core.tool_registry import TOOL_REGISTRY


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _group_by_domain() -> dict[Domain, list]:
    """
    Return a dict mapping each Domain to its registry entries in order.
    Primary tools come before fallbacks because TOOL_REGISTRY is ordered
    that way within each domain block.
    """
    groups: dict[Domain, list] = defaultdict(list)
    for entry in TOOL_REGISTRY:
        groups[entry.domain].append(entry)
    return dict(groups)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def build_plan(
    scan_results: dict[str, CapabilityScanResult],
    disabled_tool_ids: set[str] | None = None,
) -> RunPlan:
    """
    Produce an executable RunPlan from the output of capability_scanner.scan_all().

    Parameters
    ----------
    scan_results:
        Output of ``capability_scanner.scan_all()``.
    disabled_tool_ids:
        Tool ids the operator has toggled off in the GUI.  Treated the same
        as "not installed" for planning purposes.
    """
    disabled = disabled_tool_ids or set()

    domain_entries = _group_by_domain()
    planned: list[PlannedTool] = []
    missing_required: list[str] = []
    warnings: list[str] = []

    for domain, entries in domain_entries.items():
        selected: PlannedTool | None = None

        for entry in entries:
            # Respect GUI toggle
            if not entry.gui_toggle and entry.id not in disabled:
                # Tool has no toggle — never skip it due to toggle state
                pass
            if entry.id in disabled:
                continue

            scan = scan_results.get(entry.id)
            if scan is None or not scan.installed:
                continue

            # This entry is installed and enabled — select it
            role = Role.PRIMARY if entry.role == Role.PRIMARY else Role.FALLBACK

            # Intersect available modes with what scan detected
            modes = scan.modes_available or list(entry.supported_modes)

            selected = PlannedTool(
                domain=domain,
                selected_tool_id=entry.id,
                role=role,
                modes=modes,
                skip_reason=None,
                output_file=f"results/{domain.value}/{entry.id}.json",
            )

            # Emit a warning if we fell back instead of using the primary
            if role == Role.FALLBACK:
                primary_candidates = [e for e in entries if e.role == Role.PRIMARY]
                if primary_candidates:
                    primary_id = primary_candidates[0].id
                    warnings.append(
                        f"[{domain.value}] Primary tool '{primary_id}' is not available; "
                        f"using fallback '{entry.id}'."
                    )

            # Carry over env warnings from the scan
            for warn in scan.env_warnings:
                warnings.append(f"[{domain.value}/{entry.id}] {warn}")

            break  # Stop after first usable tool

        if selected is None:
            # No tool available for this domain
            required_entries = [e for e in entries if e.tier == Tier.REQUIRED]
            if required_entries:
                primary_id = required_entries[0].id
                missing_required.append(primary_id)
                warnings.append(
                    f"[{domain.value}] Required tool '{primary_id}' is missing. "
                    f"Install it before running benchmarks."
                )

            # Add a placeholder so the GUI can still show the domain
            placeholder_id = entries[0].id if entries else "unknown"
            planned.append(
                PlannedTool(
                    domain=domain,
                    selected_tool_id=placeholder_id,
                    role=Role.PRIMARY,
                    modes=[],
                    skip_reason="No installed tool found for this domain.",
                    output_file=None,
                )
            )
        else:
            planned.append(selected)

    return RunPlan(
        planned=planned,
        missing_required=missing_required,
        warnings=warnings,
        metadata={
            "total_domains": len(domain_entries),
            "runnable_domains": sum(1 for p in planned if p.skip_reason is None),
            "skipped_domains": sum(1 for p in planned if p.skip_reason is not None),
        },
    )
