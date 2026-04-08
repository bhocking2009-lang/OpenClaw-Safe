"""
capability_scanner.py — Runtime detection of installed benchmark tools.

The scanner iterates over TOOL_REGISTRY and produces a CapabilityScanResult
for each entry.  It never runs any benchmark; it only probes for presence,
path, and version.

Public API
----------
scan_all()  -> dict[str, CapabilityScanResult]
scan_one(tool_id: str) -> CapabilityScanResult
"""

from __future__ import annotations

import importlib
import shutil
import subprocess
import re
from typing import Callable

from app.core.schemas import (
    CapabilityScanResult,
    DetectionMethod,
    ToolEntry,
)
from app.core.tool_registry import TOOL_REGISTRY, TOOL_REGISTRY_BY_ID


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _parse_version(raw: str) -> tuple[int, ...] | None:
    """
    Extract the first dotted numeric sequence from a version string.

    >>> _parse_version("sysbench 1.0.20 (using bundled LuaJIT 2.1.0-beta3)")
    (1, 0, 20)
    >>> _parse_version("fio-3.35") is not None
    True
    """
    match = re.search(r"(\d+)(?:\.(\d+))?(?:\.(\d+))?", raw)
    if not match:
        return None
    return tuple(int(g) for g in match.groups() if g is not None)


def _run_version_command(binary: str, flag: str) -> str | None:
    """
    Run ``<binary> <flag>`` and return merged stdout+stderr, or None on error.
    """
    if not flag:
        return None
    try:
        result = subprocess.run(
            [binary, flag],
            capture_output=True,
            text=True,
            timeout=5,
        )
        return (result.stdout + result.stderr).strip() or None
    except (FileNotFoundError, subprocess.TimeoutExpired, OSError):
        return None


def _detect_which(entry: ToolEntry) -> CapabilityScanResult:
    path = shutil.which(entry.binary)
    if not path:
        return CapabilityScanResult(
            tool_id=entry.id,
            installed=False,
            binary_path=None,
            version_string=None,
            version_tuple=None,
            modes_available=[],
            env_warnings=[],
            error=None,
        )

    raw_version = _run_version_command(path, entry.version_flag)
    parsed = _parse_version(raw_version) if raw_version else None

    return CapabilityScanResult(
        tool_id=entry.id,
        installed=True,
        binary_path=path,
        version_string=raw_version,
        version_tuple=parsed,
        modes_available=list(entry.supported_modes),
        env_warnings=[],
        error=None,
    )


def _detect_dpkg(entry: ToolEntry) -> CapabilityScanResult:
    """Check whether the apt package is installed via ``dpkg -l``."""
    pkg = entry.apt_package
    if not pkg:
        return CapabilityScanResult(
            tool_id=entry.id,
            installed=False,
            binary_path=None,
            version_string=None,
            version_tuple=None,
            modes_available=[],
            env_warnings=["no apt_package defined; cannot use dpkg detection"],
            error=None,
        )

    try:
        result = subprocess.run(
            ["dpkg", "-l", pkg],
            capture_output=True,
            text=True,
            timeout=5,
        )
        installed = result.returncode == 0 and "ii" in result.stdout
    except (FileNotFoundError, subprocess.TimeoutExpired, OSError) as exc:
        return CapabilityScanResult(
            tool_id=entry.id,
            installed=False,
            binary_path=None,
            version_string=None,
            version_tuple=None,
            modes_available=[],
            env_warnings=[],
            error=str(exc),
        )

    path = shutil.which(entry.binary) if installed else None
    raw_version = _run_version_command(path, entry.version_flag) if path else None
    parsed = _parse_version(raw_version) if raw_version else None

    return CapabilityScanResult(
        tool_id=entry.id,
        installed=installed,
        binary_path=path,
        version_string=raw_version,
        version_tuple=parsed,
        modes_available=list(entry.supported_modes) if installed else [],
        env_warnings=[],
        error=None,
    )


def _detect_python_import(entry: ToolEntry) -> CapabilityScanResult:
    """Check whether the Python package is importable."""
    module = entry.pip_package or entry.binary
    try:
        mod = importlib.import_module(module)
        version_string = getattr(mod, "__version__", None)
        parsed = _parse_version(version_string) if version_string else None
        return CapabilityScanResult(
            tool_id=entry.id,
            installed=True,
            binary_path=None,
            version_string=version_string,
            version_tuple=parsed,
            modes_available=list(entry.supported_modes),
            env_warnings=[],
            error=None,
        )
    except ImportError as exc:
        return CapabilityScanResult(
            tool_id=entry.id,
            installed=False,
            binary_path=None,
            version_string=None,
            version_tuple=None,
            modes_available=[],
            env_warnings=[],
            error=str(exc),
        )


# Registry of detection strategy implementations
_DETECTORS: dict[DetectionMethod, Callable[[ToolEntry], CapabilityScanResult]] = {
    DetectionMethod.WHICH: _detect_which,
    DetectionMethod.DPKG: _detect_dpkg,
    DetectionMethod.PYTHON_IMPORT: _detect_python_import,
}


def _scan_entry(entry: ToolEntry) -> CapabilityScanResult:
    detector = _DETECTORS.get(entry.detection_method)
    if detector is None:
        # CUSTOM or unknown — fall back to which-based probe
        detector = _detect_which

    try:
        result = detector(entry)
    except Exception as exc:  # noqa: BLE001  (broad catch is intentional)
        result = CapabilityScanResult(
            tool_id=entry.id,
            installed=False,
            binary_path=None,
            version_string=None,
            version_tuple=None,
            modes_available=[],
            env_warnings=[],
            error=f"Unhandled detection error: {exc}",
        )

    # Append environment constraint warnings that the tool itself declared
    if result.installed and entry.env_constraints:
        result.env_warnings.extend(
            f"[declared constraint] {c}" for c in entry.env_constraints
        )

    return result


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def scan_one(tool_id: str) -> CapabilityScanResult:
    """
    Probe a single tool by id and return its CapabilityScanResult.

    Raises KeyError if tool_id is not in the registry.
    """
    entry = TOOL_REGISTRY_BY_ID[tool_id]
    return _scan_entry(entry)


def scan_all() -> dict[str, CapabilityScanResult]:
    """
    Probe every tool in TOOL_REGISTRY and return a dict keyed by tool id.

    This is the primary entry point called by the GUI before the run-plan
    screen is shown.
    """
    return {entry.id: _scan_entry(entry) for entry in TOOL_REGISTRY}
