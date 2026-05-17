"""
schemas.py — Canonical data models for the benchmark capability registry.

All fields that appear in tool_registry, capability_scanner, run_planner,
and the documentation tables are rooted here.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any


# ---------------------------------------------------------------------------
# Enumerations
# ---------------------------------------------------------------------------


class Domain(str, Enum):
    CPU = "cpu"
    GPU = "gpu"
    MEMORY = "memory"
    DISK = "disk"
    NETWORK = "network"
    GENERAL = "general"


class Role(str, Enum):
    PRIMARY = "primary"
    FALLBACK = "fallback"


class Tier(str, Enum):
    REQUIRED = "required"
    OPTIONAL = "optional"


class DetectionMethod(str, Enum):
    WHICH = "which"          # shutil.which()
    DPKG = "dpkg"            # dpkg -l <pkg>
    PYTHON_IMPORT = "python_import"
    CUSTOM = "custom"        # arbitrary callable


class CredibilityLevel(str, Enum):
    HIGH = "high"       # well-known, reproducible, widely cited
    MEDIUM = "medium"   # useful but noisy or less rigorous
    LOW = "low"         # synthetic, micro, or toy


class ResultStatus(str, Enum):
    PASS = "pass"
    DEGRADED = "degraded"
    FAIL = "fail"
    SKIP = "skip"


# ---------------------------------------------------------------------------
# Core registry entry
# ---------------------------------------------------------------------------


@dataclass
class ToolEntry:
    """
    A single entry in the static tool registry.

    Every benchmark tool or backend is described by one ToolEntry.
    This is the single source of truth consumed by capability_scanner,
    run_planner, and all documentation generators.
    """

    # Identity
    id: str                          # machine-readable slug, e.g. "sysbench-cpu"
    display_name: str                # human label shown in GUI
    domain: Domain
    purpose: str                     # one-sentence description

    # Classification
    role: Role
    tier: Tier

    # Installation / detection
    binary: str                      # command name queried by which/dpkg
    detection_method: DetectionMethod
    version_flag: str                # flag that prints the version, e.g. "--version"

    # Capabilities
    supported_modes: list[str]       # e.g. ["threads", "memory", "fileio"]
    safe_headless: bool              # safe to run with no display
    safe_offscreen: bool             # safe with DISPLAY=:99 / Xvfb

    # Output
    output_metrics: list[str]        # metric keys written to result JSON
    credibility: CredibilityLevel

    # Linux packaging
    apt_package: str | None = None   # apt install <pkg>
    pip_package: str | None = None   # pip install <pkg>
    snap_package: str | None = None  # snap install <pkg>
    flatpak_ref: str | None = None   # flatpak install <ref>

    # Environment constraints
    env_constraints: list[str] = field(default_factory=list)
    # e.g. ["requires root for raw disk access", "needs OpenGL >= 3.3"]

    # GUI
    gui_toggle: bool = True          # expose an on/off toggle in the GUI

    # Fallback chain (id of the tool to use if this one is missing)
    fallback_for: str | None = None  # this tool is the fallback FOR tool <id>

    # Diagnostic fields captured in scan output
    diagnostic_fields: list[str] = field(default_factory=list)
    # e.g. ["version", "installed", "binary_path", "mode_support"]

    # Arbitrary notes
    notes: str = ""


# ---------------------------------------------------------------------------
# Capability scan result (one per tool, produced at runtime)
# ---------------------------------------------------------------------------


@dataclass
class CapabilityScanResult:
    """Runtime snapshot of a single tool's availability and version."""

    tool_id: str
    installed: bool
    binary_path: str | None          # absolute path returned by shutil.which
    version_string: str | None       # raw output of <binary> <version_flag>
    version_tuple: tuple[int, ...] | None  # parsed (major, minor, patch)
    modes_available: list[str]       # subset of ToolEntry.supported_modes
    env_warnings: list[str]          # non-fatal environment issues detected
    error: str | None                # set if detection raised an exception


# ---------------------------------------------------------------------------
# Run plan
# ---------------------------------------------------------------------------


@dataclass
class PlannedTool:
    """
    One slot in a RunPlan — a concrete decision about whether and how to
    run a single benchmark domain.
    """

    domain: Domain
    selected_tool_id: str
    role: Role                        # primary or fallback
    modes: list[str]                  # modes that will be invoked
    skip_reason: str | None = None    # set when the tool is being skipped
    output_file: str | None = None    # relative path to expected result JSON


@dataclass
class RunPlan:
    """
    Complete, executable plan produced by run_planner based on a scan.

    The GUI renders this before the run starts so the operator can see
    exactly which tools will run, which are being skipped, and why.
    """

    planned: list[PlannedTool]
    missing_required: list[str]       # tool IDs that are required but absent
    warnings: list[str]               # non-fatal issues the operator should see
    metadata: dict[str, Any] = field(default_factory=dict)
