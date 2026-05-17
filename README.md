# OpenClaw Safe

A local-first agent operating system with a policy broker, sandbox-first execution, durable tasks, and verifiable tool use.

## Getting Started

### Windows Installer (Recommended for end users)

1. Download `OpenClaw-Safe-Setup.exe` from the [Releases](../../releases) page.
2. Run the installer — it installs to `Program Files\OpenClaw Safe\`.
3. Launch from the Start Menu or Desktop shortcut.
4. The app starts a local gateway and opens your browser to `http://127.0.0.1:4242`.

**No Node.js installation required.**

Runtime data is stored in `%APPDATA%\OpenClaw-Safe\` (never inside Program Files).

### Developer Mode

```bash
npm install
npm run build
npm start
# or
npx openclaw start
```

Gateway starts at `http://127.0.0.1:4242`. BeeOS operator UI at `http://127.0.0.1:4242/ui`.

## Implementation Status

| Phase | Scope | Status |
|---|---|---|
| 1 | Core types, policy engine, tool broker, audit log | ✅ Complete |
| 2 | Session/task management, approval inbox, memory, agent runtime | ✅ Complete |
| 3 | Gateway kernel (HTTP + WebSocket), CLI, plugin registry | ✅ Complete |
| 4 | Display layer, replay pack, verifiability test suite | ✅ Complete |
| 5 | Artifacts, policy-store, architecture protection tests | ✅ Complete |
| 6 | Budget enforcement (session budget guard + decrement) | ✅ Complete |
| 7 | Browser workflow (`browser_doc_fetch`, Class D, narrow operator surface) | ✅ Complete |
| 8 | Browser hardening — typed failure events, IP/URL input guards, export bundle integrity, budget concurrency safety | ✅ Complete |
| 9 | Channels ingress, operator export bundle, policy import/export, event-bus | ✅ Complete |
| 10 | Persistence, recovery, lifecycle management (prune/archive/migrate) | ✅ Complete |
| 11 | Delegation maturity — tree reconstruction, budget partitioning, recursive cancellation, depth/child/loop guards | ✅ Complete |
| 12 | Plugin / extension platform — manifest validation, lifecycle, broker-mediated invocation, audit visibility | ✅ Complete |

Current test suite status is validated in CI via `npm test`.

## Design Goals

- **Policy-brokered execution**: The model proposes actions, the policy engine decides, the sandbox executes, and the user audits.
- **Sandbox-first**: The sandbox worker is the default executor. Host execution requires explicit elevation.
- **Tool broker**: Every tool call goes through a typed broker with risk class enforcement (A–F).
- **Full audit trail**: Every operation produces a structured, append-only audit record suitable for forensic review and replay.
- **Approval inbox**: Human-in-the-loop approval for sensitive actions (class D, E, F) before execution.
- **Durable tasks**: Task graph with state, dependencies, capability sets, and retry management.
- **Layered memory**: Seven memory kinds (transcript, task, factual, preference, episodic, document, summary) with source references and confidence scores.
- **Plugin isolation**: Plugins run in isolated processes by default and must declare capabilities, network domains, and secret needs via a validated manifest.

## Core Modules

| Module | Purpose |
|---|---|
| `src/core/types.ts` | All domain types and contracts |
| `src/core/policy.ts` | Policy engine with rule-based decisions and evaluation trace |
| `src/core/policy-store.ts` | Persistent operator-managed policy rule store (SQLite) |
| `src/core/broker.ts` | Tool broker (policy check → approval → execution → audit → budget) |
| `src/core/audit.ts` | Append-only audit log (SQLite-backed) |
| `src/core/session.ts` | Session/task management, delegation tree, budget enforcement |
| `src/core/approval.ts` | Approval inbox and resolution |
| `src/core/memory.ts` | Layered memory service |
| `src/core/agent.ts` | Agent runtime (policy-filtered tool visibility, agentic loop) |
| `src/core/artifacts.ts` | Artifact store (content-addressed, session-scoped) |
| `src/core/replay.ts` | Replay pack export, manifest, display, and export-bundle integrity |
| `src/core/display.ts` | Pure formatting layer (replay summary, diff, policy explanation, integrity report) |
| `src/core/lifecycle.ts` | Session recovery, pruning, archiving, schema migration |
| `src/core/plugin-store.ts` | Persistent plugin manifest and lifecycle state (SQLite) |
| `src/core/gateway.ts` | Gateway kernel (HTTP + WebSocket API, loopback-only by default) |
| `src/channels/adapter.ts` | Channel adapter interface and stubs |
| `src/plugins/registry.ts` | Plugin manifest schema validation and registry |
| `src/workers/sandbox.ts` | Sandbox and stub workers |
| `src/workers/browser.ts` | Browser doc-fetch worker (allowlist, private-IP guard, typed failure events) |
| `src/cli/index.ts` | CLI commands |

## Tool Risk Classes

| Class | Scope |
|---|---|
| A | Read-only local file/list/search, low-risk memory lookup |
| B | Workspace write/edit/patch, artifact creation |
| C | Process execution in sandbox, tests/build/lint, controlled git actions |
| D | Browser/network actions (domain allowlist required) |
| E | Channel send/reply, webhooks, external side effects |
| F | Secrets, host elevation, device-sensitive actions |

## Security Defaults

- Loopback bind by default
- Sandbox-first execution
- No network by default in sandbox
- No host shell by default
- No secrets in model context by default
- Typed tool visibility only (policy-filtered)
- Append-only audit log
- Plugin isolation by default
- Per-task capability leases
- Low-trust principals restricted to Class A tools

## Local Run Commands

```bash
npm install
npm run build
npm start            # or: node dist/index.js
npx openclaw start   # start gateway daemon via local CLI
```

### CLI Commands

```
openclaw start                          # Start gateway on 127.0.0.1:4242
openclaw sessions --principal <id>      # List sessions
openclaw tasks --session <id>           # List tasks
openclaw approvals                      # List pending approvals
openclaw approve <id> --approver <id>   # Approve a request
openclaw deny <id> --approver <id>      # Deny a request
openclaw audit --session <id>           # Query audit log
openclaw replay-export --session <id>   # Export replay pack
```

### Gateway API

```
GET  /health

# Auth & Identity
POST   /v1/auth/principals
GET    /v1/auth/principals
GET    /v1/auth/principals/:id

# Agents
POST   /v1/agents
GET    /v1/agents
GET    /v1/agents/:id

# Sessions
POST   /v1/sessions
GET    /v1/sessions
GET    /v1/sessions/:id
PATCH  /v1/sessions/:id
GET    /v1/sessions/:id/replay-export
GET    /v1/sessions/:id/replay-summary
GET    /v1/sessions/:id/audit-integrity
GET    /v1/sessions/:id/export-bundle
POST   /v1/sessions/diff

# Tasks & Delegation
POST   /v1/tasks
GET    /v1/tasks/:id
PATCH  /v1/tasks/:id/state
POST   /v1/tasks/:id/delegate
POST   /v1/tasks/:id/cancel
GET    /v1/tasks/:id/tree

# Approvals
GET    /v1/approvals
POST   /v1/approvals
POST   /v1/approvals/:id/resolve

# Artifacts
GET    /v1/artifacts
GET    /v1/artifacts/:id

# Audit
GET    /v1/audit
GET    /v1/audit/:id

# Memory
POST   /v1/memory
GET    /v1/memory
DELETE /v1/memory/:id

# Policy
GET    /v1/policy/rules
POST   /v1/policy/rules
DELETE /v1/policy/rules/:id
PUT    /v1/policy/rules/reset
GET    /v1/policy/rules/export
POST   /v1/policy/rules/import
POST   /v1/policy/explain

# Plugins
POST   /v1/plugins
GET    /v1/plugins
GET    /v1/plugins/:id
PATCH  /v1/plugins/:id/state
DELETE /v1/plugins/:id
POST   /v1/plugins/:id/invoke

# Channels
POST   /v1/channels/ingest

# Browser
POST   /v1/browser/doc-fetch
```

WebSocket event stream: `ws://127.0.0.1:4242?token=<secret>`

See [OPERATOR_DOCS.md](./OPERATOR_DOCS.md) for full endpoint reference.

## Running Tests

```bash
npm test
```

## Key Guarantees

1. **Every tool call goes through the broker** — no shortcut exists to bypass policy evaluation.
2. **Every non-Class-A execution is audited** — the audit log is append-only; deletes require explicit lifecycle pruning.
3. **Plugins cannot exceed declared capabilities** — plugin invocation is mediated through the same broker/policy stack as built-in tools.
4. **Delegation enforces inheritance** — child tasks cannot widen parent capabilities, budget, or depth (max depth: 5, max children: 20).
5. **Replay packs are self-describing** — every session can be exported as a self-contained, verifiable bundle.
6. **Low-trust principals are Class A only** — this is a hard policy rule, not a configuration option.

## Documentation

| Document | Purpose |
|---|---|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Authoritative system architecture and execution flow |
| [SECURITY_MODEL.md](./SECURITY_MODEL.md) | Threat model, trust assumptions, and security invariants |
| [TRUST_AND_VERIFICATION.md](./TRUST_AND_VERIFICATION.md) | How trust is established and behavior is verified |
| [OPERATOR_DOCS.md](./OPERATOR_DOCS.md) | Full API endpoint reference |
| [REPLAY_SPEC.md](./REPLAY_SPEC.md) | Replay pack structure, audit schema, and integrity rules |
| [CONTRIBUTING_GUARDRAILS.md](./CONTRIBUTING_GUARDRAILS.md) | Non-negotiable rules for contributors and coding agents |
| [CHANGELOG.md](./CHANGELOG.md) | Phase-by-phase evolution summary |
