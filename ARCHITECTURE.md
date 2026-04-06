# OpenClaw Safe — Architecture

This document is the authoritative description of the system architecture.
It must be kept in sync with the code. Any deviation between this document
and the implementation is a defect.

---

## 1. Core Execution Flow

Every tool invocation **must** follow this exact path:

```
Agent Runtime
    │
    ▼
Tool Broker          ← single mandatory entry point for all tool calls
    │
    ├─ Registry check  (tool must be registered)
    ├─ Capability check (tool must be in task.capabilitySet)
    │
    ▼
Policy Engine        ← pure function, no side effects, no DB, no HTTP
    │
    ├─ Rule evaluation (first matching rule wins)
    ├─ Trust / session / risk-class guards
    │
    ▼
Approval Gate        ← only when policy mode == allow_with_approval
    │
    ▼
Worker (runtime)     ← sandbox | browser_worker | host_elevated | plugin_worker
    │
    ▼
Audit Log            ← append-only, mandatory, never skipped for classes B–F
```

There is **no shortcut** across this flow. An agent that calls a worker
directly is a defect. A gateway route that calls a worker without going
through the broker is a defect.

---

## 2. Package Map

```
src/
├── core/
│   ├── types.ts          All domain contracts (no business logic, no imports)
│   ├── policy.ts         Policy engine — pure evaluation, imports only types
│   ├── policy-store.ts   Operator-managed policy rule persistence (SQLite)
│   ├── broker.ts         Tool broker — orchestrates the execution flow
│   ├── audit.ts          Append-only SQLite audit log
│   ├── session.ts        Session and task persistence, delegation tree
│   ├── approval.ts       Approval inbox and resolution
│   ├── memory.ts         Layered memory store
│   ├── agent.ts          Agent runtime (model invocation, agentic loop)
│   ├── artifacts.ts      Content-addressed artifact store
│   ├── replay.ts         Replay pack export, manifest, diff, bundle validation
│   ├── display.ts        Pure formatting layer (no side effects)
│   ├── lifecycle.ts      Session recovery, pruning, archiving, migrations
│   ├── plugin-store.ts   Plugin manifest and lifecycle persistence (SQLite)
│   └── gateway.ts        HTTP + WebSocket control plane
├── channels/
│   └── adapter.ts        Channel adapter interface (ingest only, no direct tool calls)
├── plugins/
│   └── registry.ts       Plugin manifest schema validation and registry
├── workers/
│   ├── sandbox.ts        SandboxWorker + StubWorker
│   └── browser.ts        Browser doc-fetch worker (allowlist, IP guard, typed events)
└── cli/
    └── index.ts           CLI commands
```

### Import boundaries (enforced in CI)

| Package | May import | Must NOT import |
|---|---|---|
| `core/types.ts` | nothing | anything |
| `core/policy.ts` | `core/types.ts` | `core/gateway.ts`, `core/session.ts`, `core/audit.ts`, `core/broker.ts`, `core/agent.ts`, `workers/*`, `plugins/*`, `core/policy-store.ts`, `core/artifacts.ts`, `core/replay.ts`, `core/memory.ts`, `core/approval.ts` |
| `channels/*` | `core/types.ts` | `workers/*`, `core/broker.ts` directly |
| `workers/*` | `core/types.ts` | `core/gateway.ts`, `core/session.ts`, `core/audit.ts`, `core/policy.ts` |
| `plugins/*` | `core/types.ts` | `core/broker.ts`, `core/agent.ts`, `core/gateway.ts`, `core/audit.ts`, `core/session.ts` |

These boundaries are verified on every push via `npm run check:boundaries`.

---

## 3. Principal Model

Every operation is attributed to a **Principal**. Principals are never
anonymous. There is no "unauthenticated" execution path.

| `principalType` | Description |
|---|---|
| `operator` | Human operator with elevated trust |
| `user` | End user, trust level varies |
| `child_agent` | Sub-agent spawned by parent agent; inherits narrowed capabilities only |
| `system` | Internal system operations; bypasses trust-level checks |

Trust levels: `high` → `medium` → `low`

A principal's `trustLevel` is set at creation and enforced by the policy engine.

---

## 4. Tool Risk Classes

| Class | Scope | Default runtime | Approval required |
|---|---|---|---|
| A | Read-only: file list/read, memory lookup, status | sandbox | Never |
| B | Workspace write, artifact creation | sandbox | Never (high/medium trust) |
| C | Sandbox process execution, tests, git | sandbox | Never (sandbox-only enforced) |
| D | Browser / network (domain allowlist required) | browser_worker | medium/low trust |
| E | External side effects: channel send, webhooks | sandbox | medium/low trust |
| F | Secrets, host elevation, device-sensitive | host_elevated | Always (elevation required) |

Low-trust principals (`trustLevel: 'low'`) are restricted to Class A only.
Readonly sessions are restricted to Class A only.

---

## 5. Session and Task Model

**Session** — the conversational container.
- Bound to one principal and one agent.
- Has a `mode` (`interactive`, `task`, `review`, `readonly`).
- Has a token budget that is decremented on each model call.
- Has an `elevationState` (false by default). Host elevation must be explicitly granted.

**Task** — the operational container.
- Belongs to one session.
- Has a `capabilitySet` listing the exact tool names the task may invoke.
- Has a `sandboxClass` identifying the sandbox profile to use.
- Has dependency edges and a `retryCount`.

Sessions and tasks are separate entities. Chat history is **not** the source
of truth for authorisation; the policy engine is.

---

## 6. Approval Flow

When a policy decision is `allow_with_approval`:

1. The broker calls the registered `ApprovalResolver`.
2. The resolver creates an `ApprovalRequest` in the `ApprovalStore`.
3. A human (or automated rule) resolves it with `approved | denied | expired`.
4. If `approved`, the broker re-evaluates policy with `approvalState: 'approved'`
   and proceeds to execution.
5. If `denied` or `expired`, the broker returns `denied: true` and writes a
   `policy.denied` audit record.

Approval scopes: `once` | `session` | `task` | `policy_rule`.

There is no mechanism to skip approval because a principal is "trusted enough".
If the policy requires approval, approval must be obtained.

---

## 7. Audit Log

The audit log is append-only. Records are written to SQLite.

Events that must always be emitted (when `auditRequired = true`):

| Event type | When |
|---|---|
| `tool.started` | Before worker execution begins |
| `tool.finished` | After worker execution completes successfully |
| `tool.error` | After worker execution fails |
| `tool.denied` | When broker denies due to capability or policy |
| `policy.denied` | When policy engine returns deny or host_elevated_only |
| `approval.requested` | When approval request is created |
| `approval.resolved` | When approval request is resolved |

Class A tools (`auditRequired: false`) skip the write path for performance.
All other classes always write.

---

## 8. Gateway

The gateway is the control plane. It:
- Binds to loopback (`127.0.0.1`) by default.
- Routes HTTP requests and WebSocket event streams.
- Resolves principal identity from the bearer token.
- Delegates all tool execution to the broker.

The gateway does **not** directly execute tools. It does not have ambient host
authority. It does not call worker executors.

---

## 9. Sandbox-First Principle

The sandbox (`SandboxWorker`) is the default execution target for all tools.

- The sandbox has no network by default.
- The sandbox uses a per-invocation temporary workspace.
- The sandbox has a wall-clock timeout.
- Host execution (`host_elevated`) requires:
  1. Policy mode `host_elevated_only` (Class F tools).
  2. `session.elevationState === true` (explicit grant).
  3. An explicit approval (Class F policy requires approval).

There is no silent fallback from sandbox to host. If sandbox execution
is unavailable, the broker returns a `tool.error` record and no fallback
is attempted.

---

## 11. Delegation Model

Tasks may spawn child tasks via `POST /tasks/:id/delegate`. The following constraints are enforced atomically at delegation time:

- **Depth cap**: `delegationDepth` may not exceed `MAX_DELEGATION_DEPTH` (5). Violation emits `delegation.depth.exceeded`.
- **Child count cap**: a parent may have at most `MAX_CHILDREN_PER_TASK` (20) direct children. Violation emits `delegation.children.exceeded`.
- **Capability narrowing**: the child's `capabilitySet` must be a subset of the parent's. Capabilities not present in the parent are silently dropped. If narrowing occurred, `delegation.capability.restricted` is emitted.
- **Budget partition**: the child's `budgetCap` must not exceed the parent's remaining budget. Violation emits `delegation.budget.exceeded`. On success, `delegation.budget.allocated` is emitted.
- **Loop detection**: the ancestry chain is walked; if the prospective parent appears as a descendant, the request is rejected with `delegation.loop.detected`.

The full delegation subtree is available via `GET /tasks/:id/tree`, which returns a recursive `DelegationTreeNode` structure. `POST /tasks/:id/cancel` cancels the task and all non-terminal descendants, emitting `task.cancelled` for each.

---

## 12. Lifecycle Management

`LifecycleManager` (`src/core/lifecycle.ts`) handles maintenance operations:

- **`recoverSessions()`** — classifies interrupted tasks on startup into `resumable`, `failed`, or `abandoned` states and updates their `TaskState`.
- **`pruneAuditRecords(retentionDays)`** — removes audit records older than the retention window.
- **`pruneArtifacts(retentionClass, olderThan)`** — removes artifacts by retention class and age.
- **`pruneSessions(olderThan)`** — removes closed sessions and their dependent tasks.
- **`validateArchive(pack)`** — validates a replay pack for schema consistency.
- **`runMigrations(db)`** — applies forward-only schema migrations (currently `CURRENT_SCHEMA_VERSION = 1`).

---

## 13. Plugin Platform

Plugins extend the system through the gateway, not around it. The plugin lifecycle is:

```
install (POST /plugins)          → state: installed
  │
  ├─ validate manifest schema (Zod)
  ├─ emit plugin.installed audit event
  │
enable (PATCH /plugins/:id/state)  → state: enabled
  │
  ├─ version compatibility check (major version must match)
  ├─ emit plugin.enabled audit event
  │
invoke (POST /plugins/:id/invoke)
  │
  ├─ state guard (plugin must be enabled)
  ├─ capability check (capability must be in plugin.capabilities)
  ├─ PolicyEngine.evaluate() with plugin.riskClass
  ├─ emit plugin.action or plugin.capability.denied / plugin.action.denied
  │
disable (PATCH /plugins/:id/state) → state: disabled
  │
  └─ emit plugin.disabled audit event
  
remove (DELETE /plugins/:id)       → removed from store
  └─ emit plugin.removed audit event
```

The `PluginStore` persists plugin manifests and state in SQLite. It has **no access** to `AuditLog`, `ToolBroker`, or any runtime worker. All audit writing is done by the gateway route, not the store.

A plugin manifest must declare:
- `capabilities`: tool names the plugin provides (used for capability check at invocation).
- `riskClass`: A–F, used to build the `PolicyContext` for policy evaluation.
- `allowedNetworkDomains`: outbound network allowlist.
- `declaredSecretNeeds`: secret names the plugin may access.
- `packageHash`: SHA-256 of the plugin package.
- `executionMode`: `isolated_process` | `container` | `in_process_trusted`.
