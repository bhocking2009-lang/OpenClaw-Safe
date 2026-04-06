# OpenClaw Safe

A local-first agent operating system with a policy broker, sandbox-first execution, durable tasks, and verifiable tool use.

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

546 tests across 21 suites. All passing.

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
| `src/core/session.ts` | Session/task management + budget enforcement |
| `src/core/approval.ts` | Approval inbox and resolution |
| `src/core/memory.ts` | Layered memory service |
| `src/core/agent.ts` | Agent runtime (policy-filtered tool visibility, agentic loop) |
| `src/core/artifacts.ts` | Artifact store (content-addressed, session-scoped) |
| `src/core/replay.ts` | Replay pack export, manifest, display, and export-bundle integrity |
| `src/core/display.ts` | Pure formatting layer (replay summary, diff, policy explanation, integrity report) |
| `src/core/gateway.ts` | Gateway kernel (HTTP + WebSocket API, loopback-only by default) |
| `src/channels/adapter.ts` | Channel adapter interface and stubs |
| `src/plugins/registry.ts` | Plugin manifest validation and registry |
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

## Getting Started

```bash
npm install
npm run build
npm start          # or: node dist/index.js
openclaw start     # start gateway daemon
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
POST /v1/auth/principals
GET  /v1/auth/principals/:id
POST /v1/agents
POST /v1/sessions
GET  /v1/sessions/:id
PATCH /v1/sessions/:id
GET  /v1/sessions/:id/export-bundle
POST /v1/tasks
GET  /v1/tasks/:id
PATCH /v1/tasks/:id/state
GET  /v1/approvals
POST /v1/approvals
POST /v1/approvals/:id/resolve
GET  /v1/audit
POST /v1/memory
GET  /v1/memory
POST /v1/plugins
GET  /v1/plugins
POST /v1/channels/ingest
POST /v1/browser/doc-fetch
```

WebSocket event stream: `ws://127.0.0.1:4242?token=<secret>`

## Running Tests

```bash
npm test
```

## Architecture and Security

- [ARCHITECTURE.md](./ARCHITECTURE.md) — authoritative system architecture and execution flow
- [SECURITY_MODEL.md](./SECURITY_MODEL.md) — threat model, trust assumptions, and security invariants
- [CONTRIBUTING_GUARDRAILS.md](./CONTRIBUTING_GUARDRAILS.md) — non-negotiable rules for contributors and coding agents
