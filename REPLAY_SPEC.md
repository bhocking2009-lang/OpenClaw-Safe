# OpenClaw Safe — Replay Specification

This document defines the structure of replay packs, audit records, the
diff semantics between sessions, and the integrity rules that validate
exported bundles.

---

## 1. Replay Pack Structure

A replay pack is the canonical export of a session's full execution history.
It is produced by `GET /v1/sessions/:id/replay-export`.

```typescript
interface ReplayPack {
  manifest: ReplayPackManifest;
  auditRecords: AuditRecord[];
  artifacts: Artifact[];
}
```

### 1.1 ReplayPackManifest

```typescript
interface ReplayPackManifest {
  version: '1';                     // Always '1'. Must be validated on import.
  sessionId: string;                // Session this pack covers.
  exportedAt: string;               // ISO-8601 timestamp of export.
  recordCount: number;              // Must equal auditRecords.length.
  artifactCount: number;            // Must equal artifacts.length.
  toolsInvoked: string[];           // Unique tool names that appeared in records.
  principalsInvolved: string[];     // Unique principal IDs that appeared in records.
  denialCount: number;              // Count of records with eventType ending in '.denied'.
  executionCount: number;           // Count of 'tool.started' records.
  approvalCount: number;            // Count of 'approval.requested' records.
  durationMs: number | null;        // Wall-clock duration from first to last record (null if < 2 records).
  budgetExhaustedCount: number;     // Count of 'budget.exhausted' records.
  browserFetchCount: number;        // Count of successful browser doc-fetch operations.
  browserDenialCount: number;       // Count of browser.*denied records.
  lastKnownBudgetRemaining?: number; // budgetRemaining from the last record that has it.
}
```

**Manifest invariant**: `recordCount` and `artifactCount` must match the
actual array lengths. `validateExportBundle()` checks this.

### 1.2 AuditRecord

```typescript
interface AuditRecord {
  id: string;                       // UUID of this record.
  sessionId: string;                // Session this record belongs to.
  taskId?: string;                  // Task this record belongs to (if any).
  principalId: string;              // Who initiated this operation.
  eventType: string;                // One of the event types in §3.
  toolName?: string;                // Tool name (for tool.* events).
  params?: Record<string, unknown>; // Tool arguments or event-specific params.
  policyDecision?: PolicyDecision;  // The policy decision that governs this execution.
  approvalPath?: string;            // Human-readable approval scope description.
  runtimeTarget?: RuntimeTarget;    // Which runtime was used.
  startedAt: string;                // ISO-8601.
  finishedAt?: string;              // ISO-8601 (absent for denied/pending events).
  stdout?: string;                  // Worker stdout.
  stderr?: string;                  // Worker stderr.
  fileDiffs?: string[];             // File diff summaries from sandbox.
  networkTraceSummary?: string;     // Network trace summary (domain, status).
  artifacts?: ArtifactRef[];        // References to artifacts produced.
  sessionDelta?: Record<string, unknown>; // Changes to session state.
  error?: string;                   // Error message (for tool.error records).
  budgetConsumed?: number;          // Tokens consumed by this operation.
  budgetRemaining?: number;         // Session budget remaining after this operation.
}
```

### 1.3 Artifact

```typescript
interface Artifact {
  id: string;                 // UUID.
  sessionId: string;          // Session that produced this artifact.
  invocationId: string;       // Audit record that produced this artifact.
  provenanceId: string;       // Task ID that produced this artifact.
  type: string;               // Artifact type (e.g., 'structured_data', 'file_patch').
  contentHash: string;        // SHA-256 of content.
  content: string;            // Artifact content (text or base64).
  retentionClass: string;     // Retention class ('standard', 'long_term', etc.).
  createdAt: string;          // ISO-8601.
}
```

---

## 2. Export Bundle

An export bundle wraps a replay pack with a validation result:

```typescript
interface ExportBundle {
  pack: ReplayPack;
  validation: ExportBundleValidationResult;
}

interface ExportBundleValidationResult {
  valid: boolean;
  violations: ExportBundleViolation[];
}

interface ExportBundleViolation {
  kind: 'record_count_mismatch' | 'artifact_count_mismatch' | 'dangling_provenance';
  detail: string;
}
```

---

## 3. Integrity Rules

`validateExportBundle(pack)` enforces three integrity rules:

### Rule 1: Record count consistency

```
pack.manifest.recordCount === pack.auditRecords.length
```

If violated: violation `{ kind: 'record_count_mismatch', detail: '...' }`.

The manifest is generated at export time. A mismatch indicates either a
corrupted export or a partial write.

### Rule 2: Artifact count consistency

```
pack.manifest.artifactCount === pack.artifacts.length
```

If violated: violation `{ kind: 'artifact_count_mismatch', detail: '...' }`.

### Rule 3: Provenance integrity

For every artifact `a` in `pack.artifacts`:
```
pack.auditRecords.some(r => r.taskId === a.provenanceId)
```

If violated: violation `{ kind: 'dangling_provenance', detail: 'Artifact <id> references unknown task <provenanceId>' }`.

An artifact whose `provenanceId` does not correspond to any audit record in
the pack is a dangling reference — it was produced by a task not represented
in this session's audit trail.

---

## 4. Diff Semantics

`POST /v1/sessions/diff` computes the difference between two replay packs.

A diff compares two sessions side-by-side and identifies:

- **Tools invoked**: tools in session A but not B, B but not A, and common tools.
- **Principal differences**: principals that appear in one session but not the other.
- **Outcome differences**: denial counts, execution counts, approval counts.
- **Budget differences**: budget consumed and remaining.
- **Duration differences**: wall-clock duration delta.

The diff is deterministic: given the same two packs, it always produces the
same result. It does not re-execute any operations.

The diff is available in JSON (default) or human-readable text via the
`?format=text` parameter or `format` body field.

---

## 5. Audit Record Ordering

Audit records in a replay pack are ordered by `startedAt` (ascending).
Records with identical `startedAt` values retain insertion order.

The ordering is stable: re-exporting the same session at different times
produces the same ordering.

---

## 6. Event Types

The full list of event types that may appear in `auditRecords[].eventType`:

**Tool events:**
- `tool.started` — worker execution began
- `tool.finished` — worker execution completed successfully
- `tool.error` — worker execution failed
- `tool.denied` — broker denied due to missing capability

**Policy and approval events:**
- `policy.denied` — policy engine returned deny or unapproved approval
- `approval.requested` — approval request created
- `approval.resolved` — approval request resolved

**Budget events:**
- `budget.exhausted` — session budget reached zero

**Delegation events:**
- `delegation.depth.exceeded` — depth cap violated
- `delegation.children.exceeded` — child count cap violated
- `delegation.loop.detected` — circular delegation attempted
- `delegation.budget.exceeded` — child budget would exceed parent
- `delegation.budget.allocated` — budget cap assigned to child
- `delegation.capability.restricted` — child capabilities narrowed
- `task.cancelled` — task was cancelled

**Plugin events:**
- `plugin.installed` — plugin manifest installed
- `plugin.enabled` — plugin enabled
- `plugin.disabled` — plugin disabled
- `plugin.removed` — plugin removed
- `plugin.action` — plugin capability invoked successfully
- `plugin.capability.denied` — capability not in plugin manifest
- `plugin.action.denied` — policy denied plugin invocation

**Channel events:**
- `channel.ingest` — inbound channel message received

**Browser events:**
- `browser.allowlist.denied` — URL not on operator allowlist
- `browser.protocol.denied` — protocol not http/https
- `browser.redirect.denied` — redirect to non-allowlisted URL
- `browser.timeout` — request timed out
- `browser.body.too_large` — response body exceeded 1 MiB
- `browser.network.error` — network-level error
- `browser.content_type.denied` — response content-type not text
- `browser.url.denied` — URL is a private/loopback IP

---

## 7. PolicyDecision Schema

`PolicyDecision` appears in audit records and in the response to
`POST /v1/policy/explain`:

```typescript
interface PolicyDecision {
  mode: 'allow' | 'deny' | 'allow_with_approval' | 'sandbox_only' | 'host_elevated_only';
  reason: string;
  requiresApproval: boolean;
  auditRequired: boolean;
  allowedRuntimeTarget?: RuntimeTarget;
  matchedRuleId: string;            // Always present.
  evaluationTrace?: EvaluationStep[]; // Only present in explain() responses.
}

interface EvaluationStep {
  ruleId: string;
  matched: boolean;
  reason: string;
}
```

---

## 8. Runtime Targets

The `runtimeTarget` field on audit records and in `PolicyContext`:

| Value | Description |
|---|---|
| `sandbox` | Default isolated execution environment |
| `browser_worker` | Browser doc-fetch worker |
| `host_elevated` | Host execution (Class F, elevation required) |
| `plugin_worker` | Plugin execution environment |
| `stub` | Stub worker (testing only) |

---

## 9. Replay Pack Version

The current replay pack version is `'1'`. The `manifest.version` field
must be checked on import. Future versions will increment this field.
Importers must reject packs with unknown version values.

---

## 10. Replayability Guarantees

Replay packs are **read-only records** of what happened. They are not
executable. Replaying a pack does not re-run tools; it provides a complete
forensic record of every operation that was performed, with all inputs,
outputs, and policy decisions.

The following are guaranteed by the pack structure:
- Every tool execution has a `tool.started` + (`tool.finished` | `tool.error`) pair.
- Every denied tool call has a `tool.denied` or `policy.denied` record.
- Every artifact is linked to an audit record via `provenanceId`.
- The manifest counts are consistent with the actual arrays (validated by `validateExportBundle()`).

The following are **not** guaranteed by the pack structure:
- That re-executing the same operations with the same inputs would produce the same outputs (model outputs are non-deterministic).
- That the system state at the time of re-execution matches the original state (external dependencies may have changed).
