# OpenClaw Safe — Trust and Verification

This document explains how trust is established in OpenClaw Safe, how every
operation can be verified after the fact, and how operators can validate that
the system is behaving as intended without reading source code.

---

## 1. How Trust is Established

### 1.1 Principal registration

Trust begins with a registered `Principal`. Every operation is attributed to
a principal. There is no anonymous execution path.

A principal is created via `POST /v1/auth/principals` with:
- `type`: `operator` | `user` | `child_agent` | `system`
- `trustLevel`: `high` | `medium` | `low`
- `policyGroup`: the policy group that governs this principal

Trust level is set once at creation. It can only be changed by re-registering
the principal (no in-session escalation mechanism exists).

### 1.2 Session binding

A session binds a principal to an agent. The session carries:
- The principal's `trustLevel` (inherited from the registered principal)
- A token `budget` (decremented per model call)
- An `elevationState` (false by default; must be explicitly granted)
- A `mode` (`interactive`, `task`, `review`, `readonly`)

The session is the authorisation container. Chat history is not the source
of truth for trust — the policy engine evaluates the principal and session
on every tool call.

### 1.3 Task capability leases

Every task has a `capabilitySet`: an explicit list of tool names the task is
permitted to invoke. A tool not in this set is denied at the broker level
before policy evaluation even runs.

Child tasks inherit a strict subset of the parent's `capabilitySet`. Widening
is rejected at delegation time.

### 1.4 Policy rules

`PolicyEngine.evaluate()` is the mandatory gate for every tool call. It is
a pure function that takes a `PolicyContext` (principal, session, tool, risk
class, runtime target, approval state) and returns a `PolicyDecision` with
a mode (`allow`, `deny`, `allow_with_approval`, `sandbox_only`,
`host_elevated_only`).

The default ruleset enforces:
- System principals bypass trust-level checks.
- Readonly sessions and low-trust principals are restricted to Class A.
- Class F always requires host elevation and approval.
- Class D/E require approval for non-high-trust principals.
- Class B/C require sandbox execution.

Operators may add, modify, or import policy rules via the policy API. The
full rule set can be exported via `GET /v1/policy/rules/export` and imported
via `POST /v1/policy/rules/import`.

---

## 2. How Behavior is Verified

### 2.1 The audit log

Every significant operation writes a structured record to the append-only
SQLite audit log. Records include:

- `sessionId`, `taskId`, `principalId` — who did what
- `eventType` — what happened (see §3 for the full list)
- `toolName`, `params` — which tool with which arguments
- `policyDecision` — the policy decision that allowed or denied
- `startedAt`, `finishedAt` — when it happened
- `stdout`, `stderr`, `fileDiffs` — what changed
- `budgetConsumed`, `budgetRemaining` — resource impact
- `artifacts` — references to outputs produced

Audit records can be queried via `GET /v1/audit?sessionId=<id>`.

### 2.2 Replay packs

A replay pack is a self-contained, ordered export of everything that happened
in a session:

```
GET /v1/sessions/:id/replay-export
```

The pack contains:
- A `manifest` with counts, principals, tools invoked, and duration
- All `auditRecords` for the session in chronological order
- All `artifacts` produced during the session

The pack is self-describing. It can be replayed, diffed, or archived without
the live system.

### 2.3 Export bundles

An export bundle extends the replay pack with additional operator context:

```
GET /v1/sessions/:id/export-bundle
```

Export bundles are validated by `validateExportBundle()`, which checks:
1. `manifest.recordCount === auditRecords.length`
2. `manifest.artifactCount === artifacts.length`
3. All artifact `provenanceId` values appear as `taskId` in audit records

Any violation returns `valid: false` with a list of typed violations
(`record_count_mismatch`, `artifact_count_mismatch`, `dangling_provenance`).

### 2.4 Integrity checks

The audit integrity check for a session is available at:

```
GET /v1/sessions/:id/audit-integrity
```

This returns an integrity report that can be used to verify that the audit
trail for a session is internally consistent.

### 2.5 Replay summaries and diffs

Human-readable summaries are available:

```
GET /v1/sessions/:id/replay-summary
```

Two sessions can be diffed to identify behavioral differences:

```
POST /v1/sessions/diff
Body: { "sessionA": "<id>", "sessionB": "<id>" }
```

### 2.6 Policy explanation

The policy decision for any hypothetical context can be explained in full:

```
POST /v1/policy/explain
Body: { principal, session, toolName, toolRiskClass, runtimeTarget, approvalState, ... }
```

The response includes `matchedRuleId` and a full `evaluationTrace` showing
every rule that was evaluated, whether it matched, and why. This is the
operator's primary tool for validating policy behaviour without writing code.

---

## 3. Audit Event Reference

| Event type | When emitted |
|---|---|
| `tool.started` | Before worker execution begins |
| `tool.finished` | After worker execution completes successfully |
| `tool.error` | After worker execution fails |
| `tool.denied` | When broker denies due to missing capability |
| `policy.denied` | When policy engine returns deny mode |
| `approval.requested` | When an `ApprovalRequest` is created |
| `approval.resolved` | When an `ApprovalRequest` is resolved |
| `budget.exhausted` | When session budget reaches zero |
| `delegation.depth.exceeded` | Delegation depth cap violated |
| `delegation.children.exceeded` | Child task count cap violated |
| `delegation.loop.detected` | Circular delegation attempted |
| `delegation.budget.exceeded` | Child budget would exceed parent |
| `delegation.budget.allocated` | Budget cap successfully assigned to child |
| `delegation.capability.restricted` | Child capabilities were narrowed |
| `task.cancelled` | Task was cancelled (one per task in subtree) |
| `plugin.installed` | Plugin manifest installed |
| `plugin.enabled` | Plugin enabled for invocation |
| `plugin.disabled` | Plugin disabled |
| `plugin.removed` | Plugin removed from store |
| `plugin.action` | Plugin capability successfully invoked |
| `plugin.capability.denied` | Plugin capability not in manifest |
| `plugin.action.denied` | Plugin invocation denied by policy |
| `channel.ingest` | Inbound channel message received |
| `browser.allowlist.denied` | Browser URL not on allowlist |
| `browser.protocol.denied` | Browser protocol not allowed |
| `browser.redirect.denied` | Browser redirect detected |
| `browser.timeout` | Browser request timed out |
| `browser.body.too_large` | Browser response body exceeded limit |
| `browser.network.error` | Browser network error |
| `browser.content_type.denied` | Browser content-type not allowed |
| `browser.url.denied` | Browser URL rejected (private IP, etc.) |

---

## 4. How to Validate System Behavior

### 4.1 Validate that a tool call was policy-evaluated

Query the audit log for the session:

```
GET /v1/audit?sessionId=<id>
```

For every `tool.started` event, there must be a preceding or accompanying
`policyDecision` field on the audit record, or a `policy.denied` event if
the call was denied.

### 4.2 Validate that no capability was exercised outside declared scope

Export the replay pack:

```
GET /v1/sessions/:id/replay-export
```

Cross-reference `auditRecords[].toolName` against the task's `capabilitySet`
(available via `GET /v1/tasks/:id`). Every tool name must appear in the
task's `capabilitySet`.

### 4.3 Validate that approval was obtained before sensitive execution

For any `tool.started` event for a Class D, E, or F tool, there must be
an `approval.requested` + `approval.resolved` pair with `outcome: 'approved'`
at an earlier timestamp in the same session's audit log.

### 4.4 Validate that budget was not exceeded

The audit log includes `budgetConsumed` and `budgetRemaining` on relevant
records. The sum of all `budgetConsumed` values must not exceed the session's
initial budget. A `budget.exhausted` event indicates the budget was reached.

### 4.5 Validate delegation constraints

For any `delegation.budget.allocated` event, verify that the `budgetCap`
in `params` does not exceed the parent session's remaining budget at that
point in time.

For capability inheritance, verify that no child task's `capabilitySet`
(from `GET /v1/tasks/:childId`) contains a tool name not present in the
parent task's `capabilitySet`.

### 4.6 Validate plugin behavior

All plugin lifecycle and invocation events appear in the session audit log
with `pluginId` and `capability` in the `params` field. Cross-reference
against the plugin manifest (`GET /v1/plugins/:id`) to verify that only
declared capabilities were invoked.

---

## 5. What the System Cannot Do

The following are explicit non-capabilities:

- **The system cannot guarantee model output is correct.** The model is
  untrusted; the policy engine enforces constraints on what the model
  can cause to happen.

- **The system cannot prevent a sufficiently privileged operator from
  weakening policy.** An operator with access to the policy API can modify
  rules. The audit trail records every policy import/export, but does not
  prevent operator-level changes.

- **The system does not provide OS-level sandbox isolation by default.**
  The `SandboxWorker` uses per-invocation temporary directories but does
  not use cgroups, seccomp, or containers. Production deployments should
  add OS-level isolation.

- **The system does not encrypt the audit log at rest.** The SQLite database
  should be protected by filesystem-level access controls appropriate to
  the deployment environment.

- **The system does not guarantee replay equivalence.** Replay packs are
  read-only records of what happened; re-executing them may produce
  different results due to non-deterministic model outputs or external
  state changes.
