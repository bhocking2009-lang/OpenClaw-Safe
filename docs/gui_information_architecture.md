# GUI Information Architecture

> **Phase 0 artifact.** Defines every screen, panel, and drawer in the
> benchmark GUI. This document drives component scaffolding before any
> pixel is designed.

---

## 1. Screen Map

```
┌─────────────────────────────────────────────────────────────────┐
│ App Shell (persistent navigation sidebar + header bar)          │
│                                                                 │
│  ┌──────────────┐  ┌──────────────────────────────────────────┐ │
│  │  Sidebar Nav │  │  Main Content Area                       │ │
│  │              │  │                                          │ │
│  │ • Dashboard  │  │  Routes:                                 │ │
│  │ • Run        │  │    /               → Dashboard           │ │
│  │ • History    │  │    /run/setup      → Run Setup           │ │
│  │ • Compare    │  │    /run/progress   → Run Progress        │ │
│  │ • Settings   │  │    /run/results    → Run Results         │ │
│  │              │  │    /history        → Run History         │ │
│  │              │  │    /history/:id    → Historical Detail   │ │
│  │              │  │    /compare        → Side-by-side Compare│ │
│  │              │  │    /settings       → Settings            │ │
│  └──────────────┘  └──────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. Screens in Detail

### 2.1 Dashboard (`/`)

**Purpose**: At-a-glance system health, tool availability, and last run summary.

#### Panels

| Panel | Position | Content |
|-------|----------|---------|
| System Info | Top-left card | Hostname, OS, kernel, CPU model, RAM, primary GPU |
| Tool Status | Top-right card | Compact badge grid — one badge per domain, coloured by availability (green/amber/red) |
| Last Run Summary | Centre card | Date, duration, overall pass/fail, composite score trend sparkline |
| Quick Actions | Bottom bar | `▶ New Run` button · `📋 View Last Report` link · `⚙ Open Settings` link |

#### Status Indicators (Tool Status panel)

Each badge shows:
- Domain icon
- Domain name
- Colour: **green** = primary installed · **amber** = primary missing, fallback present · **red** = no tool available · **grey** = domain disabled

Clicking a badge opens a tooltip with: binary path, version, fallback chain, any env warnings.

---

### 2.2 Run Setup (`/run/setup`)

**Purpose**: Let the operator configure and launch a benchmark run.

This is a multi-step wizard:

```
Step 1 → Capability Scan   (auto, shown on page load)
Step 2 → Tool Selection    (operator can toggle tools on/off)
Step 3 → Run Configuration (per-tool parameters)
Step 4 → Confirm & Launch
```

#### Step 1 — Capability Scan

- Spinner while `capability_scanner.scan_all()` runs.
- Results appear in a scrollable list: tool id, installed badge, version, binary path, warnings.
- Error rows are highlighted in amber with an expandable error detail.

#### Step 2 — Tool Selection

- Table mirrors `docs/toolbox_catalog.md`.
- Each row has a toggle switch (respects `gui_toggle: true` from registry).
- Toggling a primary off auto-promotes its first available fallback.
- Disabling all tools in a required domain shows a blocking warning banner.
- Read-only rows for tools with `gui_toggle: false`.

#### Step 3 — Run Configuration

Collapsible sections per domain. Common options:

| Option | CPU | GPU | Memory | Disk | Network | General |
|--------|-----|-----|--------|------|---------|---------|
| Duration (s) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Thread count | ✅ | — | ✅ | ✅ | ✅ | — |
| Block size | — | — | — | ✅ | — | — |
| Test modes | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Output path | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Remote target | — | — | — | — | ✅ | ⚠️ |

Advanced options are hidden behind an **"Advanced"** expander. Dashboard-visible configuration surfaces only: Duration, Thread count, and Test modes.

#### Step 4 — Confirm & Launch

- Shows the `RunPlan` (from `run_planner.build_plan()`):
  - Runnable domains with selected tool and role
  - Skipped domains with reason
  - Missing required tools (blocking error if any)
- **`▶ Start Run`** button is disabled if `missing_required` is non-empty.
- **`◀ Back`** returns to Step 2.

---

### 2.3 Run Progress (`/run/progress`)

**Purpose**: Real-time view while benchmarks execute.

#### Panels

| Panel | Content |
|-------|---------|
| Progress Bar | Overall % complete across all planned tools |
| Current Tool | Domain icon · tool name · mode · elapsed time |
| Live Output | Scrolling tail of stdout/stderr (last 200 lines) |
| Domain Status | Status grid (queued / running / done / failed) per domain |
| Cancel | `■ Cancel Run` button (stops after current tool completes) |

**Before run starts**: All domain tiles show `queued`.
**During run**: Active domain tile pulses; completed tiles show score/status badge.
**After run**: Auto-redirect to `/run/results`.

---

### 2.4 Run Results (`/run/results`)

**Purpose**: Full report for the most recent run.

#### Panels

| Panel | Content |
|-------|---------|
| Run Metadata | Date, duration, tool versions, hostname, OS |
| Summary Card | Composite score (if applicable) · pass/degraded/fail counts |
| Domain Sections | One collapsible section per domain with metrics table + charts |
| Raw JSON | Expandable code block showing result JSON |
| Export | `⬇ Download JSON` · `⬇ Download CSV` · `⬇ Download PDF` |
| Compare | `⊕ Add to comparison` button |

#### Domain Section layout

```
┌─ CPU ─────────────────────────────────────────────────────────┐
│  Tool: sysbench CPU 1.0.20   Mode: multi-thread   Status: ✅  │
│                                                               │
│  events_per_second   ████████████████░░░░  12 450  (↑ 3%)    │
│  latency_avg_ms      ██░░░░░░░░░░░░░░░░░░   0.81              │
│  latency_95p_ms      ████░░░░░░░░░░░░░░░░   1.20              │
│                                                               │
│  [▼ Raw JSON]                                                 │
└───────────────────────────────────────────────────────────────┘
```

Status badge: **pass** (green) / **degraded** (amber) / **fail** (red) / **skip** (grey).

---

### 2.5 Run History (`/history`)

**Purpose**: Browse past runs.

- Paginated table: date, hostname, OS, composite score, pass/degraded/fail counts.
- Filter bar: date range, hostname, domain, status.
- Click a row → `/history/:id` (Historical Detail, same layout as Run Results).
- Checkbox select → enables `⊕ Compare selected` button.

---

### 2.6 Side-by-side Compare (`/compare`)

**Purpose**: Overlay two or more runs for regression detection.

- Up to 4 runs side-by-side.
- Delta column shows `+X%` / `-X%` relative to the baseline (leftmost).
- Regressions > 5% are highlighted amber; > 15% are highlighted red.

---

### 2.7 Settings (`/settings`)

Sections:

| Section | Options |
|---------|---------|
| Tool Defaults | Default duration, threads, modes per domain |
| Paths | Output directory, log directory |
| GUI | Theme (light/dark), result retention period, auto-export format |
| Advanced | Custom env vars, extra CLI flags per tool (free-text, expert only) |
| About | Version, license, links to docs |

---

## 3. What the Operator Sees — Timeline

### Before a Run

1. **Dashboard** — system info, tool availability badges, last run summary.
2. **Run Setup Step 1** — capability scan results (auto-run on entry).
3. **Run Setup Step 2** — toggle tools; promoted fallbacks highlighted.
4. **Run Setup Step 3** — tweak parameters (optional).
5. **Run Setup Step 4** — review RunPlan; blocked if required tools missing.

### During a Run

6. **Run Progress** — real-time domain tiles, live output tail, cancel button.

### After a Run

7. **Run Results** — full report, per-domain metrics, export options.
8. **Dashboard** — updated with new last-run summary and trend sparkline.

---

## 4. Drawer Contents

| Drawer | Trigger | Contents |
|--------|---------|---------|
| Tool Detail | Click tool badge on Dashboard | Name, binary path, version, supported modes, env warnings, fallback chain, apt install command |
| Env Warning | Click ⚠️ on any tool row | Full warning text, suggested remediation |
| Export Options | Click `⬇ Export` | Format selector (JSON/CSV/PDF), include-raw toggle, open-after-export checkbox |
| Advanced Config | Click `Advanced ▾` in Run Setup Step 3 | Per-tool raw CLI flags, env var overrides |
