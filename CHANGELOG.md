# OpenClaw Safe — Changelog

This document summarises the evolution of OpenClaw Safe phase by phase.
Each phase is self-contained: it adds new capabilities without removing
or weakening existing guarantees.

---

## Phase 12 — Plugin / Extension Platform

**Objective**: Allow controlled extensibility without weakening system guarantees.

**Added:**

- `PluginState` type (`installed | enabled | disabled`) added to `PluginManifest`.
- `riskClass: ToolRiskClass` (A–F) added as a required manifest field.
- `src/core/plugin-store.ts` — new SQLite-backed `PluginStore` for persistent
  plugin manifest and lifecycle state. Isolated from `AuditLog`, `ToolBroker`,
  and all runtime workers.
- `PluginRegistry` updated with `enable`, `disable`, `remove` methods and
  major-version compatibility check.
- Gateway plugin routes:
  - `POST /plugins` — manifest validation (Zod), emits `plugin.installed`
  - `PATCH /plugins/:id/state` — enable/disable with version check, emits `plugin.enabled` / `plugin.disabled`
  - `DELETE /plugins/:id` — safe removal, emits `plugin.removed`
  - `POST /plugins/:id/invoke` — policy-mediated invocation with capability check; emits `plugin.action`, `plugin.capability.denied`, or `plugin.action.denied`
- All plugin actions are audited, replayable, and visible in export bundles.
- Import boundary: `plugins/*` must not import `core/broker`, `core/audit`, `core/session`.
- 61 new tests in `tests/phase12.test.ts`.

**Security invariants added**: §3.11, §3.12 in SECURITY_MODEL.md.

---

## Phase 11 — Delegation Maturity

**Objective**: Full delegation tree reconstruction, strict capability inheritance,
budget partitioning, recursive cancellation, and delegation safety guards.

**Added:**

- `SessionStore` methods: `listChildTasks`, `countChildTasks`, `getDelegationTree`
  (returns `DelegationTreeNode` recursive structure).
- `DelegationTreeNode` interface exported from `session.ts`.
- `MAX_DELEGATION_DEPTH = 5` — hard cap on delegation depth.
- `MAX_CHILDREN_PER_TASK = 20` — hard cap on direct children per task.
- Delegate route (`POST /tasks/:id/delegate`) now enforces:
  - Depth cap → `delegation.depth.exceeded` audit event on violation
  - Child count cap → `delegation.children.exceeded` on violation
  - Capability narrowing → `delegation.capability.restricted` on narrowing
  - Budget partition → `delegation.budget.exceeded` or `delegation.budget.allocated`
  - Loop detection → `delegation.loop.detected` on violation
- `POST /tasks/:id/cancel` — recursively cancels subtree, emits `task.cancelled` per task.
- `GET /tasks/:id/tree` — returns full `DelegationTreeNode` hierarchy.
- 103 new tests in `tests/phase11.test.ts`.

**Security invariants added**: §3.13, §3.14 in SECURITY_MODEL.md.

---

## Phase 10 — Persistence, Recovery, and Lifecycle Management

**Objective**: Session recovery on restart, safe data pruning, and schema migration.

**Added:**

- `src/core/lifecycle.ts` — `LifecycleManager` with:
  - `recoverSessions()` — classifies and reclassifies interrupted tasks (`resumable` / `failed` / `abandoned`)
  - `classifyInterruptedTasks()` — classification without mutation
  - `pruneAuditRecords(retentionDays)` — removes old audit records
  - `pruneArtifacts(retentionClass, olderThan)` — removes artifacts by retention class
  - `pruneSessions(olderThan)` — removes closed sessions and tasks
  - `validateArchive(pack)` — validates replay pack schema consistency
  - `runMigrations(db)` — forward-only schema migrations
  - `getCurrentSchemaVersion(db)` — schema version query
- `AuditLog.deleteBySessionOlderThan` — batch delete for pruning.
- `ArtifactStore.deleteByRetentionClassOlderThan` — batch delete for pruning.
- `SessionStore.deleteTask` — single task deletion for lifecycle management.
- Schema version tracking: `CURRENT_SCHEMA_VERSION = 1`.

---

## Phase 9 — Channels, Export Bundle, Policy Import/Export, Event Bus

**Objective**: Channel ingestion, operator export, policy portability, and event streaming.

**Added:**

- `POST /v1/channels/ingest` — inbound channel message ingestion, emits `channel.ingest`.
- `GET /v1/sessions/:id/export-bundle` — full operator export bundle with validation.
- `GET /v1/policy/rules/export` / `POST /v1/policy/rules/import` — policy bundle portability.
- `PUT /v1/policy/rules/reset` — restore default ruleset.
- Event bus integration in `GatewayDependencies` (`eventBus?`).
- `approvalInbox?` added to `GatewayDependencies`.
- `GET /v1/sessions/:id/replay-summary` — human-readable text summary.
- `POST /v1/sessions/diff` — session comparison.

---

## Phase 8 — Browser Hardening

**Objective**: Typed failure events, URL/IP guards, export bundle integrity,
budget concurrency safety.

**Added:**

- Private IP / IP literal rejection before allowlist check → `browser.url.denied`.
- Typed browser failure events: `browser.timeout`, `browser.body.too_large`,
  `browser.network.error`, `browser.content_type.denied`, `browser.url.denied`.
- All browser denials counted in `browserDenialCount` in replay manifest.
- `validateExportBundle()` in `replay.ts` — checks record count, artifact count,
  and provenance integrity.
- Budget concurrency safety in `ToolBroker` — `decrementBudget` is atomic.
- `tokensUsed = responseBody.length` always set on browser results.

---

## Phase 7 — Browser Workflow

**Objective**: Controlled document fetch from operator-allowlisted URLs.

**Added:**

- `browser_doc_fetch` tool — Risk Class D, `browser_worker` runtime.
- `BrowserWorker` with typed error events:
  - `browser.allowlist.denied` — URL not on allowlist
  - `browser.protocol.denied` — non-http/https protocol
  - `browser.redirect.denied` — redirect to non-allowlisted URL
- `BrowserWorkerError.auditEventType` carries the specific denial event type.
- `BROWSER_DOC_FETCH_SCHEMA` exported from `gateway.ts`.
- `POST /v1/browser/doc-fetch` operator endpoint.
- `browserWorker?` in `GatewayDependencies` auto-registers tool and worker.

---

## Phase 6 — Budget Enforcement

**Objective**: Session-level token budget guard and post-execution decrement.

**Added:**

- Session `budget` field tracked in `SessionStore`.
- `ToolBroker` accepts optional `SessionStore` (5th constructor param).
- Budget guard fires **before** capability check: if `session.budget <= 0`,
  emits `budget.exhausted` and denies with `matchedRuleId: 'budget-exhausted'`.
- Post-execution: `receipt.tokensUsed` triggers `sessionStore.decrementBudget()`.
- `GET /v1/sessions/:id` returns current `budget`.
- `PATCH /v1/sessions/:id` accepts `budget` update.

---

## Phase 5 — Artifacts, Policy Store, Architecture Protection

**Objective**: Content-addressed artifact store, operator-managed policy persistence,
and automated import boundary enforcement.

**Added:**

- `src/core/artifacts.ts` — content-addressed `ArtifactStore` (SQLite).
- `src/core/policy-store.ts` — `PolicyRuleStore` for persistent, operator-managed rules.
- Policy CRUD API: `GET/POST /v1/policy/rules`, `DELETE /v1/policy/rules/:id`.
- `POST /v1/policy/explain` — full evaluation trace.
- `scripts/check-import-boundaries.mjs` — automated import boundary check (`npm run check:boundaries`).
- Architecture protection tests in `tests/architecture-protection.test.ts`.

---

## Phase 4 — Display Layer, Replay Pack, Verifiability

**Objective**: Human-readable output, session replay, and export integrity.

**Added:**

- `src/core/display.ts` — pure formatting layer:
  - `formatReplaySummary` — human-readable session summary
  - `formatReplayDiff` — diff between two packs
  - `formatPolicyExplanation` — readable policy trace
  - `formatIntegrityReport` — integrity report rendering
- `src/core/replay.ts` — `ReplayPack` export, `ReplayPackManifest` generation,
  `validateExportBundle()`.
- `GET /v1/sessions/:id/replay-export` — replay pack export endpoint.
- `GET /v1/sessions/:id/audit-integrity` — audit integrity check endpoint.
- `PolicyDecision` extended with `matchedRuleId` (always present) and
  `evaluationTrace` (only from `explain()`).
- `PolicyEngine.explain(ctx)` for operator debug; `evaluate(ctx)` for normal flow.

---

## Phase 3 — Gateway, CLI, Plugin Registry

**Objective**: HTTP + WebSocket control plane, CLI tooling, and plugin manifest validation.

**Added:**

- `src/core/gateway.ts` — `Gateway` class with Express HTTP router and WebSocket
  event stream. Binds to `127.0.0.1:4242` by default.
- All session, task, approval, memory, agent, and principal CRUD endpoints.
- `src/cli/index.ts` — CLI commands (`start`, `sessions`, `tasks`, `approvals`,
  `approve`, `deny`, `audit`, `replay-export`).
- `src/plugins/registry.ts` — `PluginRegistry` with Zod manifest validation.
- `GatewayDependencies` interface for injecting optional capabilities.

---

## Phase 2 — Session/Task Management, Approval Inbox, Memory, Agent Runtime

**Objective**: Durable operational containers, human-in-the-loop approval,
layered memory, and agentic execution loop.

**Added:**

- `src/core/session.ts` — `SessionStore` with SQLite persistence for sessions
  and tasks. `TaskState` machine, `SessionMode`, retry/deadline fields.
- `src/core/approval.ts` — `ApprovalStore`, `ApprovalRequest`, resolution logic.
- `src/core/memory.ts` — `MemoryStore` with seven memory kinds (transcript, task,
  factual, preference, episodic, document, summary), confidence scores,
  redact classes.
- `src/core/agent.ts` — `AgentRuntime` with policy-filtered tool visibility and
  agentic loop.
- Task `capabilitySet` — explicit per-task tool allowlist.
- Approval scopes: `once`, `session`, `task`, `policy_rule`.

---

## Phase 1 — Core Types, Policy Engine, Tool Broker, Audit Log

**Objective**: Foundational trust infrastructure.

**Added:**

- `src/core/types.ts` — all domain types and contracts. Zero imports.
- `src/core/policy.ts` — `PolicyEngine` with rule-based evaluation. Pure function,
  no side effects, no DB access. Imports only `types.ts`.
- `src/core/broker.ts` — `ToolBroker` orchestrating the full execution flow:
  registry check → capability check → policy evaluation → approval gate →
  worker dispatch → audit write.
- `src/core/audit.ts` — `AuditLog` with append-only SQLite persistence.
  `deleteBySessionOlderThan` for lifecycle management.
- Tool risk classes A–F defined and enforced.
- Principal types: `operator`, `user`, `child_agent`, `system`.
- Trust levels: `high`, `medium`, `low`.
- Default policy ruleset (12 rules, evaluated in order).
- `WorkerExecutor` interface — the only interface through which workers may
  be called.
