# OpenClaw Safe — Operator Documentation

This document is the complete reference for the OpenClaw Safe HTTP API.
All endpoints are mounted under `/v1` unless noted. The gateway binds to
`127.0.0.1:4242` by default (loopback-only).

**Authentication**: Supply `Authorization: Bearer <gatewaySecret>` on every
request. If `gatewaySecret` is empty (development only), authentication is
skipped.

**Content-Type**: All request and response bodies are `application/json`
unless noted.

---

## Health

### `GET /health`

Returns gateway health status. **No authentication required.**

**Response 200:**
```json
{ "status": "ok" }
```

---

## Auth — Principals

### `POST /v1/auth/principals`

Register a new principal.

**Body:**
```json
{
  "type": "operator" | "user" | "child_agent" | "system",
  "identities": { "<channelName>": "<channelId>" },
  "trustLevel": "high" | "medium" | "low",
  "policyGroup": "string"
}
```

**Response 201:** The created `Principal` object.

**Errors:**
- `400` — invalid `type` or missing required fields.

---

### `GET /v1/auth/principals`

List all registered principals.

**Response 200:** Array of `Principal` objects.

---

### `GET /v1/auth/principals/:id`

Get a single principal.

**Response 200:** `Principal` object.
**Response 404:** Principal not found.

---

## Agents

### `POST /v1/agents`

Register a new agent.

**Body:**
```json
{
  "profile": "string",
  "defaultModel": "string",
  "toolProfile": "string",
  "sandboxProfile": "string",
  "memoryNamespace": "string",
  "channelBindings": ["string"]
}
```

**Response 201:** The created `Agent` object.

---

### `GET /v1/agents`

List all registered agents.

**Response 200:** Array of `Agent` objects.

---

### `GET /v1/agents/:id`

Get a single agent.

**Response 200:** `Agent` object.
**Response 404:** Agent not found.

---

## Sessions

### `POST /v1/sessions`

Create a new session.

**Body:**
```json
{
  "principalId": "string",
  "agentId": "string",
  "mode": "interactive" | "task" | "review" | "readonly",
  "budget": 1000,
  "channelThreadBinding": "optional-string"
}
```

**Response 201:** The created `Session` object.

**Errors:**
- `400` — missing required fields.

---

### `GET /v1/sessions`

List all sessions.

**Response 200:** Array of `Session` objects.

---

### `GET /v1/sessions/:id`

Get a single session.

**Response 200:** `Session` object.
**Response 404:** Session not found.

---

### `PATCH /v1/sessions/:id`

Update session fields.

**Body (all fields optional):**
```json
{
  "mode": "interactive" | "task" | "review" | "readonly",
  "budget": 500,
  "elevationState": true
}
```

**Response 200:** Updated `Session` object.
**Response 404:** Session not found.

---

### `GET /v1/sessions/:id/replay-export`

Export a full replay pack for the session.

**Query params:**
- `?format=text` — returns a human-readable text rendering instead of JSON.

**Response 200 (JSON):** `ReplayPack` object (see [REPLAY_SPEC.md](./REPLAY_SPEC.md)).
**Response 200 (text):** Formatted execution trace as `text/plain` attachment.
**Response 404:** Session not found.

---

### `GET /v1/sessions/:id/replay-summary`

Human-readable summary of session execution.

**Query params:**
- `?format=text` — returns `text/plain` attachment.

**Response 200:** Summary string or JSON.
**Response 404:** Session not found.

---

### `GET /v1/sessions/:id/audit-integrity`

Validate audit log integrity for a session.

**Response 200:** Integrity report `{ valid: boolean, violations: [...] }`.
**Response 409:** Integrity violations found (same body, status 409).
**Response 404:** Session not found.

---

### `GET /v1/sessions/:id/export-bundle`

Export the full operator bundle for archival or sharing.

Validates bundle integrity before returning. Returns `valid: false` with
violations if the bundle is inconsistent.

**Response 200:** Export bundle (includes replay pack + validation result).
**Response 404:** Session not found.

---

### `POST /v1/sessions/diff`

Diff two session replay packs.

**Body:**
```json
{
  "sessionA": "session-id-a",
  "sessionB": "session-id-b",
  "format": "json" | "text"
}
```

**Response 200:** Diff object or text rendering.
**Response 400:** Missing session IDs.
**Response 404:** One or both sessions not found.

---

## Tasks

### `POST /v1/tasks`

Create a new task.

**Body:**
```json
{
  "sessionId": "string",
  "title": "string",
  "ownerId": "string",
  "sandboxClass": "string",
  "capabilitySet": ["tool_name_1", "tool_name_2"],
  "dependencyIds": [],
  "deadline": "2026-01-01T00:00:00Z",
  "retryCount": 0
}
```

**Response 201:** The created `Task` object.

---

### `GET /v1/tasks/:id`

Get a single task.

**Response 200:** `Task` object.
**Response 404:** Task not found.

---

### `PATCH /v1/tasks/:id/state`

Update task state.

**Body:**
```json
{
  "state": "pending" | "running" | "awaiting_approval" | "completed" | "failed" | "cancelled",
  "executorId": "optional-executor-id"
}
```

**Response 200:** Updated `Task` object.
**Response 404:** Task not found.

---

### `POST /v1/tasks/:id/delegate`

Create a child (delegated) task. Enforces capability narrowing, budget
partitioning, depth cap, and loop detection.

**Body:**
```json
{
  "sessionId": "string",
  "title": "string",
  "ownerId": "string",
  "sandboxClass": "string",
  "capabilitySet": ["subset-of-parent-capabilities"],
  "budgetCap": 100
}
```

**Delegation constraints enforced:**
- `capabilitySet` must be a subset of the parent's `capabilitySet`.
  Extra capabilities are silently dropped; `delegation.capability.restricted`
  is emitted if any were dropped.
- `budgetCap` must not exceed the parent session's remaining budget.
  Violation → 400 + `delegation.budget.exceeded`.
- Child count for this parent must not exceed `MAX_CHILDREN_PER_TASK` (20).
  Violation → 400 + `delegation.children.exceeded`.
- `delegationDepth` must not exceed `MAX_DELEGATION_DEPTH` (5).
  Violation → 400 + `delegation.depth.exceeded`.
- No circular ancestry (loop detection).
  Violation → 400 + `delegation.loop.detected`.

**Response 201:** The created child `Task` object.
**Response 400:** Constraint violation (see audit events above).
**Response 404:** Parent task or session not found.

---

### `POST /v1/tasks/:id/cancel`

Cancel a task and all non-terminal descendants recursively. Emits
`task.cancelled` for each cancelled task.

**Response 200:** `{ cancelled: number }` — count of tasks cancelled.
**Response 404:** Task not found.

---

### `GET /v1/tasks/:id/tree`

Return the full delegation subtree rooted at this task.

**Response 200:**
```json
{
  "task": { /* Task object */ },
  "children": [
    {
      "task": { /* Task object */ },
      "children": []
    }
  ]
}
```

**Response 404:** Task not found.

---

## Approvals

### `GET /v1/approvals`

List pending approval requests.

**Response 200:** Array of `ApprovalRequest` objects.

---

### `POST /v1/approvals`

Create an approval request manually.

**Body:**
```json
{
  "sessionId": "string",
  "taskId": "string",
  "principalId": "string",
  "toolName": "string",
  "riskClass": "D",
  "duration": "once" | "session" | "task" | "policy_rule",
  "humanReadableDiff": "string"
}
```

**Response 201:** The created `ApprovalRequest` object.

---

### `POST /v1/approvals/:id/resolve`

Resolve an approval request.

**Body:**
```json
{
  "outcome": "approved" | "denied" | "expired",
  "approverId": "string"
}
```

**Response 200:** Updated `ApprovalRequest` object.
**Response 404:** Approval request not found.

**Audit event emitted:** `approval.resolved`

---

## Artifacts

### `GET /v1/artifacts`

Query artifacts.

**Query params:**
- `?invocationId=<id>` — filter by invocation
- `?provenanceId=<taskId>` — filter by task provenance
- `?type=<type>` — filter by artifact type

**Response 200:** Array of `Artifact` objects.

---

### `GET /v1/artifacts/:id`

Get a single artifact.

**Response 200:** `Artifact` object.
**Response 404:** Artifact not found.

---

## Audit Log

### `GET /v1/audit`

Query audit records.

**Query params (at least one required):**
- `?sessionId=<id>`
- `?taskId=<id>`
- `?principalId=<id>`

**Response 200:** Array of `AuditRecord` objects, ordered by `startedAt`.

---

### `GET /v1/audit/:id`

Get a single audit record.

**Response 200:** `AuditRecord` object.
**Response 404:** Record not found.

---

## Memory

### `POST /v1/memory`

Store a memory item.

**Body:**
```json
{
  "sessionId": "string",
  "namespace": "string",
  "kind": "transcript" | "task" | "factual" | "preference" | "episodic" | "document" | "summary",
  "content": "string",
  "source": "string",
  "confidence": 0.9,
  "redactClass": "public" | "private" | "sensitive"
}
```

**Response 201:** The created `MemoryItem` object.

---

### `GET /v1/memory`

Query memory items.

**Query params (at least one required):**
- `?namespace=<ns>`
- `?kind=<kind>`
- `?redactClass=<class>`
- `?confidence=<min>`

**Response 200:** Array of `MemoryItem` objects.

---

### `DELETE /v1/memory/:id`

Delete a memory item.

**Response 204:** Item deleted.
**Response 404:** Item not found.

---

## Policy

### `GET /v1/policy/rules`

List all active policy rules.

**Response 200:** Array of `PolicyRule` objects.

---

### `POST /v1/policy/rules`

Create or upsert a policy rule.

**Body:** `PolicyRule` object with `id`, `match`, `effect`, and optional fields.

**Response 201:** The created or updated rule.

---

### `DELETE /v1/policy/rules/:id`

Delete a policy rule by ID.

**Response 204:** Rule deleted.
**Response 404:** Rule not found.

---

### `PUT /v1/policy/rules/reset`

Reset the policy ruleset to the built-in defaults.

**Response 200:** `{ rulesRestored: number }`

---

### `GET /v1/policy/rules/export`

Export all current policy rules as a bundle.

**Response 200:** `{ rules: PolicyRule[], exportedAt: string }`

---

### `POST /v1/policy/rules/import`

Import a policy rule bundle.

**Body:**
```json
{
  "rules": [ /* PolicyRule objects */ ],
  "mode": "merge" | "replace"
}
```

- `merge` — adds rules; existing rules with the same ID are updated.
- `replace` — replaces the entire ruleset with the imported rules.

**Response 200:** `{ imported: number }`

---

### `POST /v1/policy/explain`

Explain a policy decision for a given context. Returns the decision with
the full evaluation trace (every rule evaluated, whether it matched, why).

**Body:** A `PolicyContext` object:
```json
{
  "principal": { /* Principal */ },
  "session": { /* Session */ },
  "toolName": "browser_doc_fetch",
  "toolRiskClass": "D",
  "runtimeTarget": "browser_worker",
  "approvalState": "approved",
  "networkDomain": "api.example.com"
}
```

**Response 200:**
```json
{
  "mode": "allow",
  "reason": "Class D tools allowed for high-trust",
  "requiresApproval": false,
  "auditRequired": true,
  "matchedRuleId": "class-d-high-allow",
  "evaluationTrace": [
    { "ruleId": "system-allow", "matched": false, "reason": "principal type is not system" },
    { "ruleId": "class-d-high-allow", "matched": true, "reason": "riskClass D, trustLevel high" }
  ]
}
```

---

## Plugins

### `POST /v1/plugins`

Install a plugin. The manifest is validated against the schema; invalid
manifests are rejected with 400.

**Body:** `PluginManifest` object:
```json
{
  "id": "plugin-search",
  "name": "Web Search Plugin",
  "version": "1.0.0",
  "description": "Provides web search capabilities",
  "capabilities": ["web_search", "summarize"],
  "allowedNetworkDomains": ["api.example.com"],
  "declaredSecretNeeds": ["SEARCH_API_KEY"],
  "executionMode": "isolated_process",
  "packageHash": "sha256:abc123...",
  "pinnedVersion": "1.0.0",
  "installedAt": "2026-04-06T00:00:00Z",
  "riskClass": "A"
}
```

**Response 201:** The installed `PluginManifest` object (with `state: "installed"`).
**Response 400:** Manifest validation failed.
**Audit event:** `plugin.installed`

---

### `GET /v1/plugins`

List all installed plugins.

**Response 200:** Array of `PluginManifest` objects.

---

### `GET /v1/plugins/:id`

Get a single plugin.

**Response 200:** `PluginManifest` object.
**Response 404:** Plugin not found.

---

### `PATCH /v1/plugins/:id/state`

Enable or disable a plugin.

**Body:**
```json
{ "state": "enabled" | "disabled" }
```

On `enabled`, a version compatibility check is performed. Major version must
match the installed version. Incompatible major version → 409.

**Response 200:** Updated `PluginManifest` object.
**Response 400:** Invalid state value.
**Response 404:** Plugin not found.
**Response 409:** Version incompatible.
**Audit events:** `plugin.enabled` or `plugin.disabled`

---

### `DELETE /v1/plugins/:id`

Remove a plugin. The plugin is deleted from the store.

**Response 200:** `{ removed: true }`
**Response 404:** Plugin not found.
**Audit event:** `plugin.removed`

---

### `POST /v1/plugins/:id/invoke`

Invoke a declared capability of an enabled plugin. The invocation is mediated
through the policy engine.

**Body:**
```json
{
  "sessionId": "string",
  "capability": "web_search",
  "params": { "query": "example" },
  "taskId": "optional-task-id"
}
```

**Enforcement flow:**
1. Plugin must exist and have `state: "enabled"` → else 403
2. `capability` must be in `plugin.capabilities` → else 403 + `plugin.capability.denied` audit
3. Session must exist → else 404
4. `PolicyEngine.evaluate()` with `toolRiskClass = plugin.riskClass` → else 403 + `plugin.action.denied` audit
5. On success → 200 + `plugin.action` audit

**Response 200:**
```json
{
  "pluginId": "plugin-search",
  "capability": "web_search",
  "sessionId": "session-id",
  "audited": true,
  "executedAt": "2026-04-06T00:00:00Z"
}
```

**Response 400:** Missing `sessionId` or `capability`.
**Response 403:** Plugin not enabled, capability not declared, or policy denied.
**Response 404:** Plugin or session not found.

---

## Browser

### `POST /v1/browser/doc-fetch`

Fetch and extract text from an allowlisted documentation URL. Risk Class D.

Requires `browserWorker` to be registered in gateway dependencies.

**Body:**
```json
{
  "sessionId": "string",
  "taskId": "string",
  "principalId": "string",
  "url": "https://docs.example.com/page",
  "label": "optional-label"
}
```

**Enforcement:**
- URL must use `https:` or `http:` protocol (others → `browser.protocol.denied`)
- URL hostname must not be a private/loopback IP (`browser.url.denied`)
- URL hostname must be on the allowlist (`browser.allowlist.denied`)
- Redirects to allowlisted URLs are allowed; others → `browser.redirect.denied`
- Response content-type must be text (`browser.content_type.denied`)
- Response body must not exceed 1 MiB (`browser.body.too_large`)
- Request must complete within timeout (`browser.timeout`)

**Response 200:** Result including extracted text and a `structured_data` artifact reference.
**Response 400:** Invalid URL or missing required fields.
**Response 403:** Policy denied or allowlist violation.

---

## Channels

### `POST /v1/channels/ingest`

Ingest an inbound message from a channel. Emits a `channel.ingest` audit event.

**Body:** `InboundEnvelope` object:
```json
{
  "id": "msg-uuid",
  "channel": "webchat",
  "senderRef": "user@example.com",
  "principalId": "principal-id",
  "sessionId": "session-id",
  "content": "Hello, agent.",
  "receivedAt": "2026-04-06T00:00:00Z"
}
```

**Response 202:** `{ "status": "queued", "envelopeId": "msg-uuid" }`

---

## WebSocket Event Stream

Connect to the gateway WebSocket for real-time event notifications:

```
ws://127.0.0.1:4242?token=<gatewaySecret>
```

Events emitted over the WebSocket are lightweight status notifications;
they do not include full audit payloads. Full audit data is available only
via the authenticated `/v1/audit` endpoint.

---

## Error Format

All error responses use this body:

```json
{ "error": "Human-readable description of the error" }
```

For policy denials, the error response includes additional fields:

```json
{
  "error": "Policy denied: class D requires approval",
  "matchedRuleId": "class-d-medium-low-approval"
}
```

---

## Audit Visibility

Every state-changing operation emits at least one audit record. The audit
record includes the full request context (principal, session, task, tool,
params) and the outcome (allowed, denied, error).

Operators can replay any session in full using `GET /v1/sessions/:id/replay-export`
and verify that every operation is accounted for in the audit trail.

See [TRUST_AND_VERIFICATION.md](./TRUST_AND_VERIFICATION.md) for a complete
guide to verifying system behavior from audit and replay data alone.
