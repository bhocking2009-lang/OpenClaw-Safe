# Toolbox Catalog

> **Phase 0 artifact.** This table is the canonical reference for every
> benchmark tool the system knows about. It is generated from
> `app/core/tool_registry.py` and must be kept in sync with that file.

---

## Legend

| Symbol | Meaning |
|--------|---------|
| ✅ | Yes / true |
| ❌ | No / false |
| ⚠️ | Conditional — see Notes |
| — | Not applicable |

---

## CPU Domain

| Domain | Tool | Role | Primary / Fallback | Installed? | Required? | Metrics Produced | Headless? | Offscreen? | GUI Toggle? | Notes |
|--------|------|------|--------------------|------------|-----------|-----------------|-----------|------------|-------------|-------|
| CPU | sysbench CPU | Integer prime workload | Primary | Runtime | ✅ | `events_per_second`, `latency_avg_ms`, `latency_95p_ms` | ✅ | ✅ | ✅ | `apt install sysbench` |
| CPU | stress-ng CPU | Broad stress / thermal | Fallback for sysbench CPU | Runtime | ❌ | `bogo_ops`, `bogo_ops_per_sec`, `wall_clock_s` | ✅ | ✅ | ✅ | Wider stressor set; less cross-system comparable |
| CPU | Geekbench 6 | Global score reference | Fallback for sysbench CPU | Runtime | ❌ | `single_core_score`, `multi_core_score` | ✅ | ✅ | ✅ | Proprietary binary; not in apt |

---

## GPU Domain

| Domain | Tool | Role | Primary / Fallback | Installed? | Required? | Metrics Produced | Headless? | Offscreen? | GUI Toggle? | Notes |
|--------|------|------|--------------------|------------|-----------|-----------------|-----------|------------|-------------|-------|
| GPU | glmark2 | OpenGL 2.0 benchmark | Primary | Runtime | ✅ | `score`, `fps_per_scene` | ❌ | ✅ | ✅ | `--offscreen` flag for CI |
| GPU | glxgears | Driver smoke test | Fallback for glmark2 | Runtime | ❌ | `fps` | ❌ | ✅ | ✅ | Low credibility; use only as sanity check |
| GPU | vkmark | Vulkan benchmark | Fallback for glmark2 | Runtime | ❌ | `score`, `fps_per_scene` | ❌ | ✅ | ✅ | Preferred when system is Vulkan-first |

---

## Memory Domain

| Domain | Tool | Role | Primary / Fallback | Installed? | Required? | Metrics Produced | Headless? | Offscreen? | GUI Toggle? | Notes |
|--------|------|------|--------------------|------------|-----------|-----------------|-----------|------------|-------------|-------|
| Memory | sysbench Memory | Sequential throughput | Primary | Runtime | ✅ | `throughput_mib_s`, `latency_avg_ms` | ✅ | ✅ | ✅ | Shares binary with CPU domain |
| Memory | memtester | Fault detection | Fallback for sysbench Memory | Runtime | ❌ | `pass`, `fail_count` | ✅ | ✅ | ✅ | Diagnostic, not throughput |
| Memory | STREAM | Sustainable bandwidth | Fallback for sysbench Memory | Runtime | ❌ | `copy_mb_s`, `scale_mb_s`, `add_mb_s`, `triad_mb_s` | ✅ | ✅ | ✅ | Must be compiled from source |

---

## Disk / Storage Domain

| Domain | Tool | Role | Primary / Fallback | Installed? | Required? | Metrics Produced | Headless? | Offscreen? | GUI Toggle? | Notes |
|--------|------|------|--------------------|------------|-----------|-----------------|-----------|------------|-------------|-------|
| Disk | fio | Flexible I/O tester | Primary | Runtime | ✅ | `read_iops`, `write_iops`, `read_bw_mib_s`, `write_bw_mib_s`, `lat_avg_us`, `lat_99p_us` | ✅ | ✅ | ✅ | `apt install fio` |
| Disk | IOzone | Filesystem matrix | Fallback for fio | Runtime | ❌ | `write_kb_s`, `rewrite_kb_s`, `read_kb_s`, `reread_kb_s` | ✅ | ✅ | ✅ | `apt install iozone3` |
| Disk | hdparm | Quick read probe | Fallback for fio | Runtime | ❌ | `buffered_read_mb_s`, `disk_read_mb_s` | ✅ | ✅ | ✅ | Requires root for direct-read mode |

---

## Network Domain

| Domain | Tool | Role | Primary / Fallback | Installed? | Required? | Metrics Produced | Headless? | Offscreen? | GUI Toggle? | Notes |
|--------|------|------|--------------------|------------|-----------|-----------------|-----------|------------|-------------|-------|
| Network | iperf3 | LAN/WAN throughput | Primary | Runtime | ✅ | `throughput_mbits_s`, `retransmits`, `jitter_ms`, `packet_loss_pct` | ✅ | ✅ | ✅ | Requires cooperating server |
| Network | Speedtest CLI | ISP internet speed | Fallback for iperf3 | Runtime | ❌ | `download_mbits_s`, `upload_mbits_s`, `latency_ms` | ✅ | ✅ | ✅ | Requires internet; variable results |
| Network | netperf | Latency profiling | Fallback for iperf3 | Runtime | ❌ | `throughput_mbits_s`, `mean_latency_us` | ✅ | ✅ | ✅ | Requires netserver on remote |

---

## General / Cross-domain

| Domain | Tool | Role | Primary / Fallback | Installed? | Required? | Metrics Produced | Headless? | Offscreen? | GUI Toggle? | Notes |
|--------|------|------|--------------------|------------|-----------|-----------------|-----------|------------|-------------|-------|
| General | Phoronix Test Suite | Multi-domain suite runner | Primary | Runtime | ❌ | `composite_score`, `per_suite_score` | ✅ | ✅ | ✅ | Downloads suites on first run |
| General | wrk HTTP | HTTP load generator | Fallback for PTS | Runtime | ❌ | `requests_per_sec`, `latency_avg_ms`, `latency_99p_ms`, `transfer_mb_s` | ✅ | ✅ | ✅ | Must be compiled from source |
| General | Apache Bench (ab) | HTTP smoke test | Fallback for wrk | Runtime | ❌ | `requests_per_sec`, `time_per_request_ms`, `failed_requests` | ✅ | ✅ | ✅ | Single-threaded; `apt install apache2-utils` |

---

## Installed? column runtime values

The **Installed?** column above shows `Runtime` because installation state
is detected at run-time by `capability_scanner.scan_all()`. The GUI renders
this column with live values populated from the scan results before the run
starts.

Possible GUI values:

| Value | Meaning |
|-------|---------|
| ✅ Installed | `shutil.which()` / dpkg found the binary |
| ❌ Missing | Binary not found |
| ⚠️ Error | Detection raised an exception (shown with tooltip) |
