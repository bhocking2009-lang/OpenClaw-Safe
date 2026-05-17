# GUI Information Architecture

> **Phase 0 artifact.** Defines every screen, panel, and drawer in the
> benchmark GUI. This document drives component scaffolding before any
> pixel is designed.
>
> This revision is governed by the **Mandatory GUI Design Constraints** below.
> Every screen decision must be traced back to those constraints.

---

## 0. Mandatory GUI Design Constraints

These rules are non-negotiable and take precedence over any convenience
or density preference.

| # | Constraint |
|---|-----------|
| 1 | Do not overload any single screen with all available data. |
| 2 | Use **progressive disclosure**: summaries first, details on expansion or navigation. |
| 3 | Use **structured navigation**: sidebar + tabs + panels — not flat mega-pages. |
| 4 | Default views must be comprehensible in **under 5 seconds**. |
| 5 | Advanced data (logs, diagnostics, raw JSON) must be **hidden behind expandable sections**. |
| 6 | **No single-page-everything** layouts. |
| 7 | Avoid dense tables unless they are scoped, paginated, and readable at a glance. |
| 8 | Prioritise **clarity over compactness**. When in doubt, use more space. |
| 9 | If a screen feels crowded, it **must be redesigned** — not compressed further. |
| 10 | The UI should feel like a **professional system tool**, not a developer debug panel. |

Every screen description below carries a **Constraint compliance note**
summarising how the design upholds these rules.

---

## 1. Navigation Structure

```
┌──────────────────────────────────────────────────────────────────────┐
│ App Shell                                                            │
│                                                                      │
│  ┌─────────────────┐  ┌────────────────────────────────────────────┐ │
│  │  Sidebar        │  │  Main Content Area                         │ │
│  │  (always shown) │  │                                            │ │
│  │                 │  │  One primary view at a time.               │ │
│  │  ◉ Dashboard    │  │  Tabs appear inside views where a second   │ │
│  │  ○ Run          │  │  layer of organisation is needed.          │ │
│  │  ○ History      │  │  Panels stack vertically with clear        │ │
│  │  ○ Compare      │  │  headings and breathing room.              │ │
│  │  ○ Settings     │  │                                            │ │
│  │                 │  │  Routes:                                   │ │
│  │  ─────────────  │  │    /              → Dashboard              │ │
│  │  System status  │  │    /run/scan      → Capability Scan        │ │
│  │  mini-badge row │  │    /run/configure → Run Configuration      │ │
│  │                 │  │    /run/confirm   → Run Confirmation        │ │
│  │                 │  │    /run/progress  → Run Progress           │ │
│  │                 │  │    /run/results   → Run Results            │ │
│  │                 │  │    /history       → Run History            │ │
│  │                 │  │    /history/:id   → Result Detail          │ │
│  │                 │  │    /compare       → Compare Runs           │ │
│  │                 │  │    /settings      → Settings               │ │
│  └─────────────────┘  └────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────┘
```

**Sidebar mini-badge row** — one icon per domain (CPU / GPU / Memory / Disk /
Network / General), coloured green / amber / red. Visible at all times so the
operator never loses awareness of tool availability without navigating away.
Clicking a badge opens a focused Tool Detail drawer (see §5).

---

## 2. Screens in Detail

### 2.1 Dashboard (`/`)

**Purpose**: Answer "is the system ready to run?" in under 5 seconds.

**Constraint compliance**: Constraint 1 (no overload), 4 (5-second default),
6 (not a mega-page), 8 (clarity over compactness), 10 (professional feel).

#### Layout

```
┌─ Dashboard ─────────────────────────────────────────────────────────┐
│                                                                     │
│  System        macbook-pro  ·  Ubuntu 24.04  ·  Intel i9  ·  32 GB │
│                                                           [Details ›]│
│                                                                     │
│  ─────────────────────────────────────────────────────────────────  │
│                                                                     │
│  Tools ready   CPU ●  GPU ●  Memory ●  Disk ●  Network ◑  General ● │
│                                             ↑ amber = fallback only │
│                                                                     │
│  ─────────────────────────────────────────────────────────────────  │
│                                                                     │
│  Last run      Apr 7 · 4 min 12 s · ✅ 5 passed · ⚠️ 1 degraded    │
│                                                       [View report ›]│
│                                                                     │
│  ─────────────────────────────────────────────────────────────────  │
│                                                                     │
│  [  ▶  Start New Run  ]                                             │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

#### Design rules for Dashboard

- **Three information zones only**: system identity, tool readiness, last run.
  Nothing else lives here.
- System identity shows hostname + OS + CPU + RAM — four facts, one line.
  `[Details ›]` opens a read-only drawer with full hardware info; it does not
  expand inline.
- Tool readiness is a single icon row. Colour carries the full message.
  No tables, no columns, no version strings on this screen.
- Last run is one line. Score trend sparkline is deferred to the History screen.
- `▶ Start New Run` is the single primary action. There is no secondary action
  cluttering the button row.

---

### 2.2 Capability Scan (`/run/scan`)

**Purpose**: Show the operator which tools are installed before asking them
to configure anything.

**Constraint compliance**: Constraint 2 (summary first), 5 (errors hidden
behind expander), 7 (scoped list, not a dense table).

#### Layout

```
┌─ Step 1 of 3: Checking tools ──────────────────────────────────────┐
│                                                                    │
│  Scanning…  ████████████████░░░░░░░░  (12 / 18 tools)             │
│                                                                    │
│  ─────────────────────────────────────────────────────────────    │
│                                                                    │
│  CPU        ✅  sysbench 1.0.20            ready                   │
│  GPU        ✅  glmark2 2021.02            ready                   │
│  Memory     ✅  sysbench 1.0.20            ready                   │
│  Disk       ✅  fio 3.35                   ready                   │
│  Network    ⚠️  iperf3 → netperf (fallback) [Details ▾]           │
│  General    ❌  No tool found              [Install help ▾]        │
│                                                                    │
│  ─────────────────────────────────────────────────────────────    │
│                                                                    │
│  [  Continue →  ]        [  ◀ Back  ]                             │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

#### Design rules

- **One row per domain** — not one row per tool. The tool name shown is the
  one that will be used. Fallback promotion is announced inline.
- Version string is shown, but nothing else (no binary path, no mode list).
  Those live in the `[Details ▾]` expander.
- `[Details ▾]` expands in-place to show: binary path, all detected modes,
  env warnings, fallback chain. It does not navigate to a new screen.
- `[Install help ▾]` expands to show the `apt install` / `pip install` command
  for the missing tool. One command. No manual.
- Scan errors are shown as amber rows; the expander reveals the raw error.
  They are never shown inline in collapsed state.
- `Continue →` is disabled until the scan finishes. If any required domain is
  red, a brief blocking notice appears above the button — not a full error
  page.

---

### 2.3 Run Configuration (`/run/configure`)

**Purpose**: Let the operator set the most important parameters for the run.
Advanced tuning is hidden unless explicitly requested.

**Constraint compliance**: Constraint 2 (default options first, advanced
hidden), 5 (advanced behind expander), 6 (not one mega-form), 8 (clarity),
9 (redesigned if crowded).

#### Layout

```
┌─ Step 2 of 3: Configure run ───────────────────────────────────────┐
│                                                                    │
│  Duration per domain       [  30  ] seconds                        │
│                                                                    │
│  Thread count              [  Auto (8)  ▾]                         │
│                                                                    │
│  ─────────────────────────────────────────────────────────────    │
│                                                                    │
│  Domains to run                                                    │
│  ☑  CPU     ☑  GPU     ☑  Memory     ☑  Disk     ☑  Network      │
│  ☐  General  (no tool available)                                  │
│                                                                    │
│  ─────────────────────────────────────────────────────────────    │
│                                                                    │
│  [▸  Advanced options]        ← collapsed by default              │
│                                                                    │
│  [  Continue →  ]        [  ◀ Back  ]                             │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

#### Advanced options expander (collapsed by default)

When expanded, reveals **one tab per domain**. Each tab shows only the
options relevant to that domain. No cross-domain tables.

```
Advanced options  [CPU] [GPU] [Memory] [Disk] [Network] [General]
─────────────────────────────────────────────────────────────────
  CPU tab (shown):

  Mode                  [  multi-thread  ▾]
  Custom flags          [                ]   (expert only)
  Output file           results/cpu/sysbench-cpu.json   [Change…]
```

#### Design rules

- **Two global controls at the top**: duration and thread count. These
  handle 90 % of what operators want to change.
- Domain toggles are checkboxes, not a table. Labels only.
- Advanced options are a single collapsible section containing tabs.
  The tab bar means only one domain's options are visible at a time —
  never a grid of six domain columns side-by-side.
- Per-tool CLI flags (raw strings) are the last item in each Advanced tab,
  visually de-emphasised, labelled "expert only".
- Network domain tab also shows a `Remote host` field when iperf3 is selected.

---

### 2.4 Run Confirmation (`/run/confirm`)

**Purpose**: Show the exact plan before committing to the run. Last checkpoint.

**Constraint compliance**: Constraint 2 (summary), 4 (5-second read),
7 (short scoped list), 10 (professional feel).

#### Layout

```
┌─ Step 3 of 3: Confirm run ─────────────────────────────────────────┐
│                                                                    │
│  Ready to run:                                                     │
│                                                                    │
│   CPU      sysbench CPU     multi-thread    30 s    primary        │
│   GPU      glmark2          offscreen       30 s    primary        │
│   Memory   sysbench Memory  write           30 s    primary        │
│   Disk     fio              seq-read/write  30 s    primary        │
│   Network  netperf          TCP_STREAM      30 s    ⚠️ fallback    │
│                                                                    │
│  ⚠️  Network: iperf3 not found; using netperf as fallback.        │
│  ℹ️  General: no tool available — domain will be skipped.          │
│                                                                    │
│  Estimated duration: ~3 min                                        │
│                                                                    │
│  [  ▶  Start Run  ]        [  ◀ Back  ]                           │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

#### Design rules

- The plan table has **five columns** (domain, tool, mode, duration, role).
  No further columns. Each row is one domain — never one row per tool.
- Warnings appear below the table as short plain-language sentences.
  They do not use technical identifiers (no `tool_id` strings).
- If `missing_required` is non-empty, the `▶ Start Run` button is replaced
  with a red notice: "Install missing required tools to continue."
  The operator is not left guessing why the button is absent.
- Estimated duration is calculated from the configured durations. It is a
  human-friendly estimate, not a precise guarantee.

---

### 2.5 Run Progress (`/run/progress`)

**Purpose**: Let the operator know what is happening right now. Nothing more.

**Constraint compliance**: Constraint 1 (no overload), 4 (5-second read),
5 (log output hidden by default), 10 (professional feel).

#### Layout

```
┌─ Run in progress ───────────────────────────────────────────────────┐
│                                                                     │
│  Overall progress     ██████████░░░░░░░░░░  3 / 5 domains          │
│                                                                     │
│  ─────────────────────────────────────────────────────────────     │
│                                                                     │
│  Now running:  Disk  ·  fio  ·  seq-read/write  ·  0:18 elapsed    │
│                                                                     │
│  ─────────────────────────────────────────────────────────────     │
│                                                                     │
│  CPU      ✅ done   12 450 events/s                                 │
│  GPU      ✅ done   4 830 score                                     │
│  Memory   ✅ done   18.4 GiB/s                                      │
│  Disk     ⏵ running                                                │
│  Network  ○ queued                                                  │
│                                                                     │
│  [▸  Live output]   ← collapsed by default                          │
│                                                                     │
│  [  ■ Cancel  ]                                                     │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

#### Design rules

- The default view shows: progress bar, current tool (one line), domain
  status tiles. **That is all**.
- Completed domain tiles show a single headline metric. They are not links;
  the full report appears after the run ends.
- `[▸ Live output]` expands to a scrolling terminal panel (last 100 lines,
  monospace font). It is **collapsed by default** — operators who do not need
  it are not distracted by raw log output.
- `■ Cancel` terminates gracefully after the current domain finishes.
  A confirmation prompt appears ("Cancel after current domain?") — not an
  immediate hard stop.
- Auto-redirects to `/run/results` when all domains complete.

---

### 2.6 Run Results (`/run/results`)

**Purpose**: Present the outcome of a run clearly. Details available on demand.

**Constraint compliance**: Constraint 2 (summary → domain → raw),
5 (raw JSON hidden), 7 (metrics shown in bars, not dense tables), 8 (clarity),
10 (professional tool feel).

#### Layout — three-layer progressive disclosure

**Layer 1 — Summary bar (always visible)**

```
Run: Apr 8 2026  ·  4 min 12 s  ·  ✅ 4 passed  ·  ⚠️ 1 degraded  ·  ○ 1 skipped
[⬇ Export]   [⊕ Compare]
```

**Layer 2 — Domain cards (visible on load, collapsed by default)**

```
  ┌─ CPU ──────────────────────────────────── ✅ Pass ─┐  [▸ Expand]
  │  sysbench CPU · multi-thread · 12 450 events/s      │
  └──────────────────────────────────────────────────────┘

  ┌─ GPU ──────────────────────────────────── ✅ Pass ─┐  [▸ Expand]
  │  glmark2 · offscreen · 4 830 score                  │
  └──────────────────────────────────────────────────────┘

  ┌─ Memory ───────────────────────────────── ✅ Pass ─┐  [▸ Expand]
  │  sysbench Memory · write · 18.4 GiB/s               │
  └──────────────────────────────────────────────────────┘

  ┌─ Disk ─────────────────────────────────── ✅ Pass ─┐  [▸ Expand]
  │  fio · seq-read/write · 3 200 IOPS                   │
  └──────────────────────────────────────────────────────┘

  ┌─ Network ──────────────────────────────── ⚠️ Degraded ┐  [▸ Expand]
  │  netperf (fallback) · TCP_STREAM · 420 Mbit/s         │
  └────────────────────────────────────────────────────────┘

  ┌─ General ──────────────────────────────── ○ Skipped ─┐
  │  No tool available                                     │
  └────────────────────────────────────────────────────────┘
```

**Layer 3 — Expanded domain card (on click)**

```
  ┌─ Network ─────────────────────────────── ⚠️ Degraded ────── [▾ Collapse]
  │
  │  Tool        netperf 2.7.0 (fallback — iperf3 not found)
  │  Mode        TCP_STREAM
  │  Duration    30 s
  │
  │  throughput_mbits_s   ████████████░░░░░░░░   420   baseline: 940
  │  mean_latency_us      ██░░░░░░░░░░░░░░░░░░   1.2   ✅
  │
  │  ⚠️  Throughput is 55 % below baseline. Primary tool (iperf3) was
  │      not available. Consider installing iperf3 for accurate results.
  │
  │  [▸ Diagnostics]   [▸ Raw JSON]
  │
  └──────────────────────────────────────────────────────────────────────
```

#### Design rules for Run Results

- **Layer 1** is always visible and always conveys pass/degraded/fail counts.
  Operators can read the overall outcome in under 3 seconds.
- **Layer 2** cards show one headline metric per domain — enough to confirm or
  catch a problem without reading every number.
- **Layer 3** reveals metrics as horizontal bar charts with a baseline
  watermark. Bars are labelled with values. There is no dense numeric table.
- `[▸ Diagnostics]` expands to show env warnings, mode list, binary path, and
  tool version details — the information operators need when investigating.
- `[▸ Raw JSON]` expands to a scrollable code block with a `Copy` button.
  It is the last item in the expanded card, not a top-level element.
- Export and Compare buttons live in the summary bar, not inside domain cards.

---

### 2.7 Run History (`/history`)

**Purpose**: Browse and navigate past runs.

**Constraint compliance**: Constraint 7 (scoped, paginated table), 8 (clarity).

#### Layout

```
┌─ History ───────────────────────────────────────────────────────────┐
│                                                                     │
│  Filter:  [Date range ▾]  [Status ▾]  [Domain ▾]    [Clear filters]│
│                                                                     │
│  Date              Status          Duration   Score    Actions      │
│  ─────────────────────────────────────────────────────────────     │
│  Apr 8  04:35      ✅ All pass     4m 12s     —        [View] [⊕]  │
│  Apr 7  22:10      ⚠️ 1 degraded  3m 58s     —        [View] [⊕]  │
│  Apr 6  11:00      ✅ All pass     4m 05s     —        [View] [⊕]  │
│  ...                                                                │
│                                                                     │
│  ← Prev   Page 1 of 3   Next →                                      │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

#### Design rules

- The table has **five columns only**: date, status, duration, composite score
  (shown if available, `—` otherwise), and actions.
- Hostname and OS are not shown in the list — they live in the detail view.
  This keeps the table scannable.
- `[⊕]` adds a run to the Compare basket (max 4). A persistent "Compare basket
  (N)" chip appears at the bottom of the screen when ≥ 2 runs are selected.
- Pagination is mandatory. Default page size: 20 rows.
- Filter bar uses dropdowns, not free-text search, to keep the filter surface
  small and predictable.

---

### 2.8 Result Detail (`/history/:id`)

**Purpose**: Full report for a historical run. Identical layout to Run Results
(§2.6) with the addition of a `← Back to History` breadcrumb.

No additional design rules needed; the Run Results constraints apply fully.

---

### 2.9 Compare Runs (`/compare`)

**Purpose**: Detect regressions between two runs side by side.

**Constraint compliance**: Constraint 1 (max 2 runs at a time, not 4),
7 (scoped comparison, only selected domains), 8 (clarity).

#### Layout

```
┌─ Compare ───────────────────────────────────────────────────────────┐
│                                                                     │
│  Baseline     Apr 7 · 22:10   [Change ▾]                           │
│  Comparison   Apr 8 · 04:35   [Change ▾]                           │
│                                                                     │
│  Domain filter   [All ▾]                                            │
│                                                                     │
│  ─────────────────────────────────────────────────────────────     │
│                                                                     │
│  CPU     events/s    12 100   →   12 450   +2.9 %  ✅              │
│  GPU     score        4 720   →    4 830   +2.3 %  ✅              │
│  Memory  GiB/s         17.9   →     18.4   +2.8 %  ✅              │
│  Disk    IOPS          3 180   →    3 200   +0.6 %  ✅              │
│  Network Mbit/s          430   →      420   −2.3 %  ⚠️             │
│                                                                     │
│  ─────────────────────────────────────────────────────────────     │
│                                                                     │
│  ⚠️  Network degraded: netperf used in comparison run vs           │
│      iperf3 in baseline. Tool mismatch may affect comparability.   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

#### Design rules

- **Two runs at a time**. The previous limit of 4 runs side-by-side was
  removed: comparing 4 runs in columns produces an unreadable table.
  For multi-run trends, use the History screen with the filter.
- Each domain shows **one headline metric** with its baseline, comparison,
  and delta. The operator can expand a domain to see secondary metrics.
- Delta colours: green for improvement, neutral for < ±5 %, amber for
  ±5–15 % regression, red for > 15 % regression.
- Tool-mismatch warnings appear below the table as plain sentences. They flag
  when the two runs used different tools for the same domain.

---

### 2.10 Settings (`/settings`)

**Purpose**: Adjust defaults and preferences. Infrequently visited.

**Constraint compliance**: Constraint 3 (tabs within screen), 5 (advanced
behind its own tab), 6 (not a mega-form), 8 (clarity).

#### Tab structure

```
Settings   [General]  [Domains]  [Paths]  [Appearance]  [Advanced]
```

| Tab | Contents |
|-----|---------|
| General | Default duration, default thread count, auto-scan on app start (toggle) |
| Domains | Per-domain default mode, per-domain enable/disable (persistent default) |
| Paths | Output directory, log directory. Single-line text fields with `Browse…` buttons. |
| Appearance | Theme (Light / Dark / System), result retention period |
| Advanced | Per-tool raw CLI flags (expert only), custom env vars, debug logging toggle. Labelled with a warning banner: "These settings can break benchmark execution." |

#### Design rules

- Each tab contains at most **6 controls**. If more controls are needed,
  a new tab is created.
- The Advanced tab carries a visible caution banner; its controls are styled
  subdued to signal they are not for routine use.
- There is no "Save" button. Settings are persisted on change (auto-save with
  a brief "Saved ✓" confirmation indicator).

---

## 3. Operator Journey — Phase-by-Phase

### Before a run

| Step | Screen | What the operator learns in ≤ 5 s |
|------|--------|----------------------------------|
| 1 | Dashboard | Is the system ready? (tool colour row) |
| 2 | Capability Scan | Which tools are present, which are fallbacks? (one row per domain) |
| 3 | Run Configuration | Duration and thread count only; Advanced hidden |
| 4 | Run Confirmation | Exact plan, estimated time, any warnings |

### During a run

| Step | Screen | What the operator learns in ≤ 5 s |
|------|--------|----------------------------------|
| 5 | Run Progress | What is running now, how many domains are done |

### After a run

| Step | Screen | What the operator learns in ≤ 5 s |
|------|--------|----------------------------------|
| 6 | Run Results | Pass / degraded / fail counts (summary bar) |
| 7 | Run Results (expanded) | Which domain degraded and by how much |
| 8 | Dashboard | Updated readiness badges and last-run line |

---

## 4. Drawer Catalogue

Drawers slide in from the right. They never take more than 50 % of the
viewport width. They always have a visible close control.

| Drawer | Trigger | Contents | Max depth |
|--------|---------|---------|-----------|
| Tool Detail | Click domain badge (sidebar or Dashboard) | Display name · binary path · version · supported modes · env warnings · fallback chain · install command | 1 level — no nested expanders |
| Hardware Info | `[Details ›]` on Dashboard | Full CPU spec, RAM, disk model, GPU model, kernel version | 1 level |
| Install Help | `[Install help ▾]` on Scan screen | Single install command (`apt` / `pip` / source URL) · link to tool docs | 1 level |
| Env Warning | Click ⚠️ on any tool row | Full warning text · suggested remediation step | 1 level |
| Export Options | `[⬇ Export]` on Run Results / History | Format selector (JSON / CSV / PDF) · include-raw-output toggle · open-after-export toggle | 1 level |

---

## 5. What is Explicitly Out of Scope for the Default View

The following information exists in the system but **must not appear on any
default screen view**. It is available only through expanders, drawers, or
the Advanced tab.

| Information | Access path |
|-------------|-------------|
| Binary paths | Tool Detail drawer |
| Full hardware spec | Hardware Info drawer |
| Raw CLI flags used | `[▸ Diagnostics]` expander in Run Results |
| Raw JSON output | `[▸ Raw JSON]` expander in Run Results |
| Live log output | `[▸ Live output]` expander in Run Progress |
| Per-tool CLI overrides | Settings → Advanced tab |
| Environment variable overrides | Settings → Advanced tab |
| Fallback chain detail | Tool Detail drawer |
| Debug log toggle | Settings → Advanced tab |
