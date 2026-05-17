# Backend Capability Matrix

> **Phase 0 artifact.** Cross-maps every benchmark category to its tool(s),
> dependencies, fallback path, expected output JSON file, result status rules,
> and failure/degraded conditions.

---

## How to read this document

- **Primary** — the preferred tool for the category.
- **Fallback 1 / 2** — used in order if the primary is absent.
- **Output JSON** — path written relative to the run output directory.
- **Result status** — which condition maps to `pass`, `degraded`, or `fail`.
- **Failure / degraded** — concrete conditions that trigger a non-pass status.

All paths use `{run_id}` as a placeholder for the run's unique identifier.

---

## CPU

| Field | Value |
|-------|-------|
| **Category** | CPU |
| **Primary** | sysbench CPU |
| **Primary binary** | `sysbench` |
| **Primary apt** | `sysbench` |
| **Fallback 1** | stress-ng CPU |
| **Fallback 1 binary** | `stress-ng` |
| **Fallback 1 apt** | `stress-ng` |
| **Fallback 2** | Geekbench 6 |
| **Fallback 2 binary** | `geekbench6` |
| **Fallback 2 source** | https://www.geekbench.com/ (proprietary) |
| **Output JSON** | `results/{run_id}/cpu/sysbench-cpu.json` |
| **Key metrics** | `events_per_second`, `latency_avg_ms`, `latency_95p_ms` |
| **Result: pass** | `events_per_second` ≥ baseline threshold (configurable) |
| **Result: degraded** | 10–25 % below baseline |
| **Result: fail** | > 25 % below baseline, or tool exit-code ≠ 0 |
| **Failure conditions** | Tool not installed · timeout · segfault · thread count mismatch |
| **Degraded conditions** | Thermal throttling detected (via `stress-ng --metrics`), high system load during test |

---

## GPU

| Field | Value |
|-------|-------|
| **Category** | GPU |
| **Primary** | glmark2 |
| **Primary binary** | `glmark2` |
| **Primary apt** | `glmark2` |
| **Fallback 1** | vkmark |
| **Fallback 1 binary** | `vkmark` |
| **Fallback 1 apt** | `vkmark` |
| **Fallback 2** | glxgears (smoke test only) |
| **Fallback 2 binary** | `glxgears` |
| **Fallback 2 apt** | `mesa-utils` |
| **Output JSON** | `results/{run_id}/gpu/glmark2.json` |
| **Key metrics** | `score`, `fps_per_scene` |
| **Result: pass** | `score` ≥ baseline threshold |
| **Result: degraded** | 10–25 % below baseline |
| **Result: fail** | > 25 % below baseline, or OpenGL/Vulkan context creation failure |
| **Failure conditions** | No display / no offscreen context · driver crash · missing OpenGL ≥ 2.0 |
| **Degraded conditions** | Running under Xvfb (software renderer) · GPU in power-save mode |
| **Headless note** | Run with `glmark2 --offscreen`; requires Mesa EGL offscreen support |

---

## Memory

| Field | Value |
|-------|-------|
| **Category** | Memory |
| **Primary** | sysbench Memory |
| **Primary binary** | `sysbench` |
| **Primary apt** | `sysbench` |
| **Fallback 1** | memtester |
| **Fallback 1 binary** | `memtester` |
| **Fallback 1 apt** | `memtester` |
| **Fallback 2** | STREAM |
| **Fallback 2 binary** | `stream_c` (compiled from source) |
| **Fallback 2 source** | http://www.cs.virginia.edu/stream/ |
| **Output JSON** | `results/{run_id}/memory/sysbench-memory.json` |
| **Key metrics** | `throughput_mib_s`, `latency_avg_ms` |
| **Result: pass** | `throughput_mib_s` ≥ baseline threshold |
| **Result: degraded** | 10–20 % below baseline |
| **Result: fail** | > 20 % below baseline, or memtester reports `fail_count > 0` |
| **Failure conditions** | OOM during test · allocation failure · tool exit-code ≠ 0 |
| **Degraded conditions** | Large swap usage · NUMA interleaving disabled · ECC scrubbing active |

---

## Disk / Storage

| Field | Value |
|-------|-------|
| **Category** | Disk |
| **Primary** | fio |
| **Primary binary** | `fio` |
| **Primary apt** | `fio` |
| **Fallback 1** | IOzone |
| **Fallback 1 binary** | `iozone` |
| **Fallback 1 apt** | `iozone3` |
| **Fallback 2** | hdparm |
| **Fallback 2 binary** | `hdparm` |
| **Fallback 2 apt** | `hdparm` |
| **Output JSON** | `results/{run_id}/disk/fio.json` |
| **Key metrics** | `read_iops`, `write_iops`, `read_bw_mib_s`, `write_bw_mib_s`, `lat_99p_us` |
| **Result: pass** | IOPS and bandwidth ≥ baseline; `lat_99p_us` ≤ baseline |
| **Result: degraded** | 10–30 % IOPS regression, or latency 2×–5× baseline |
| **Result: fail** | > 30 % IOPS regression, or latency > 5× baseline, or I/O errors reported |
| **Failure conditions** | Target device full · permission denied · device not found · I/O errors |
| **Degraded conditions** | Background compaction (NVMe/SSD) · filesystem fragmentation · HDD instead of SSD detected |
| **Safety note** | Never run against system root without explicit `--filename` pointing to a test file |

---

## Network

| Field | Value |
|-------|-------|
| **Category** | Network |
| **Primary** | iperf3 |
| **Primary binary** | `iperf3` |
| **Primary apt** | `iperf3` |
| **Fallback 1** | netperf |
| **Fallback 1 binary** | `netperf` |
| **Fallback 1 apt** | `netperf` |
| **Fallback 2** | Speedtest CLI |
| **Fallback 2 binary** | `speedtest` |
| **Fallback 2 pip** | `speedtest-cli` |
| **Output JSON** | `results/{run_id}/network/iperf3.json` |
| **Key metrics** | `throughput_mbits_s`, `retransmits`, `jitter_ms`, `packet_loss_pct` |
| **Result: pass** | `throughput_mbits_s` ≥ link-speed threshold · `packet_loss_pct` < 0.1 % |
| **Result: degraded** | Throughput 20–50 % below link speed · `packet_loss_pct` 0.1–1 % |
| **Result: fail** | Cannot reach server · throughput < 50 % of link speed · `packet_loss_pct` > 1 % |
| **Failure conditions** | No reachable iperf3/netserver endpoint · firewall blocking port 5201 |
| **Degraded conditions** | Half-duplex link · Wi-Fi interference · VPN overhead |

---

## General / Cross-domain

| Field | Value |
|-------|-------|
| **Category** | General |
| **Primary** | Phoronix Test Suite |
| **Primary binary** | `phoronix-test-suite` |
| **Primary apt** | `phoronix-test-suite` |
| **Fallback 1** | wrk (HTTP) |
| **Fallback 1 binary** | `wrk` |
| **Fallback 1 source** | https://github.com/wg/wrk (compile from source) |
| **Fallback 2** | Apache Bench |
| **Fallback 2 binary** | `ab` |
| **Fallback 2 apt** | `apache2-utils` |
| **Output JSON** | `results/{run_id}/general/phoronix-test-suite.json` |
| **Key metrics** | `composite_score` (PTS) · `requests_per_sec`, `latency_99p_ms` (wrk/ab) |
| **Result: pass** | Score ≥ baseline |
| **Result: degraded** | 5–15 % regression |
| **Result: fail** | > 15 % regression, or sub-suite failure, or tool exit-code ≠ 0 |
| **Failure conditions** | Network unavailable (PTS downloads suites) · no HTTP target (wrk/ab) |
| **Degraded conditions** | System under load from other processes · PTS test suite version change |

---

## Result Status Decision Table

| Condition | Status |
|-----------|--------|
| Tool not installed, not required | `skip` |
| Tool not installed, required | `fail` |
| Tool installed, run succeeded, all metrics within threshold | `pass` |
| Tool installed, run succeeded, metrics within degraded band | `degraded` |
| Tool installed, run succeeded, metrics outside degraded band | `fail` |
| Tool installed, run failed (non-zero exit / exception) | `fail` |
| Tool installed, run timed out | `fail` |
| Primary missing, fallback used, fallback passed | `pass` (with warning) |
| Primary missing, fallback used, fallback degraded | `degraded` (with warning) |
| All tools in domain disabled by operator | `skip` |

---

## Fallback Promotion Rules

```
For each domain:
  1. Try primary tool (if installed and not disabled).
  2. If primary absent → try Fallback 1 (if installed and not disabled).
  3. If Fallback 1 absent → try Fallback 2.
  4. If no tool available:
       - domain.tier == REQUIRED  → add to missing_required list; RunPlan blocks.
       - domain.tier == OPTIONAL  → mark domain as skipped; RunPlan continues.
```

Fallback promotion is **never silent**: every promotion emits a warning in the
`RunPlan.warnings` list and is displayed to the operator on the Run Setup
confirmation screen.

---

## Output JSON Schema (per tool)

Each tool writes a result file conforming to this minimal schema:

```json
{
  "tool_id": "sysbench-cpu",
  "display_name": "sysbench CPU",
  "domain": "cpu",
  "role": "primary",
  "status": "pass",
  "version": "1.0.20",
  "started_at": "2026-04-08T04:35:00Z",
  "finished_at": "2026-04-08T04:35:30Z",
  "duration_s": 30,
  "modes_run": ["multi-thread"],
  "metrics": {
    "events_per_second": 12450.3,
    "latency_avg_ms": 0.81,
    "latency_95p_ms": 1.20
  },
  "env_warnings": [],
  "raw_output": "..."
}
```

Fields `tool_id`, `domain`, `role`, `status`, `started_at`, `finished_at`,
`duration_s`, and `metrics` are mandatory. All other fields are optional.
