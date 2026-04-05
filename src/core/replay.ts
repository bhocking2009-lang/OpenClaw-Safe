/**
 * Replay pack export for OpenClaw Secure.
 *
 * A replay pack is a self-contained, exportable bundle of everything that
 * happened in a session: audit records, artifact metadata, and a manifest.
 * It is sufficient to reconstruct and review any session offline.
 */

import { AuditRecord, Artifact } from './types';
import { AuditLog } from './audit';
import { ArtifactStore } from './artifacts';

// ---------------------------------------------------------------------------
// Replay pack shape
// ---------------------------------------------------------------------------

export interface ReplayPackManifest {
  version: '1';
  sessionId: string;
  exportedAt: string;
  recordCount: number;
  artifactCount: number;
  toolsInvoked: string[];
  principalsInvolved: string[];
  /** Number of broker denials recorded in this session */
  denialCount: number;
  /** Number of completed tool executions (tool.finished events) */
  executionCount: number;
  /** Number of approval-related events (approval.requested + approval.resolved) */
  approvalCount: number;
  /** Wall-clock duration of the session in ms (last record − first record) */
  durationMs: number | null;
}

export interface ReplayPack {
  manifest: ReplayPackManifest;
  auditRecords: AuditRecord[];
  artifacts: Artifact[];
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

/**
 * Build a replay pack for the given session.
 *
 * @param sessionId - The session to export.
 * @param auditLog  - The audit log to query.
 * @param artifactStore - Optional artifact store. If omitted, artifacts list is empty.
 */
export function buildReplayPack(
  sessionId: string,
  auditLog: AuditLog,
  artifactStore?: ArtifactStore
): ReplayPack {
  const auditRecords = auditLog.queryBySession(sessionId);

  // Collect all provenanceIds mentioned in artifact refs across the records
  const provenanceIds = new Set<string>();
  for (const record of auditRecords) {
    if (record.artifacts) {
      for (const ref of record.artifacts) {
        provenanceIds.add(ref.id);
      }
    }
    if (record.taskId) provenanceIds.add(record.taskId);
  }

  // Resolve full artifact metadata when a store is available
  const artifacts: Artifact[] = [];
  if (artifactStore) {
    for (const provenanceId of provenanceIds) {
      artifacts.push(...artifactStore.listByProvenance(provenanceId));
    }
  }

  const toolsInvoked = [
    ...new Set(
      auditRecords
        .filter((r) => r.toolName !== undefined)
        .map((r) => r.toolName as string)
    ),
  ];

  const principalsInvolved = [
    ...new Set(auditRecords.map((r) => r.principalId)),
  ];

  // --- Stats ---
  const denialCount = auditRecords.filter(
    (r) => r.eventType === 'tool.denied' || r.eventType === 'policy.denied'
  ).length;

  const executionCount = auditRecords.filter(
    (r) => r.eventType === 'tool.finished'
  ).length;

  const approvalCount = auditRecords.filter(
    (r) => r.eventType === 'approval.requested' || r.eventType === 'approval.resolved'
  ).length;

  let durationMs: number | null = null;
  if (auditRecords.length >= 2) {
    const first = Date.parse(auditRecords[0].startedAt);
    const last = Date.parse(auditRecords[auditRecords.length - 1].startedAt);
    if (!isNaN(first) && !isNaN(last)) durationMs = last - first;
  }

  const manifest: ReplayPackManifest = {
    version: '1',
    sessionId,
    exportedAt: new Date().toISOString(),
    recordCount: auditRecords.length,
    artifactCount: artifacts.length,
    toolsInvoked,
    principalsInvolved,
    denialCount,
    executionCount,
    approvalCount,
    durationMs,
  };

  return { manifest, auditRecords, artifacts };
}

// ---------------------------------------------------------------------------
// Human-readable execution trace
// ---------------------------------------------------------------------------

const EVENT_EMOJI: Record<string, string> = {
  'tool.started':        '▶',
  'tool.finished':       '✓',
  'tool.error':          '✗',
  'tool.denied':         '⛔',
  'policy.denied':       '⛔',
  'approval.requested':  '⏳',
  'approval.resolved':   '✅',
  'channel.ingest':      '📨',
};

/**
 * Format a replay pack as a human-readable execution trace.
 *
 * Produces a timestamped, single-line-per-event text trace suitable for
 * operator review, log storage, or terminal output.
 *
 * Example line:
 *   2026-04-05T12:00:00Z  ✓ tool.finished     file_write   [p-1 / s-1 / t-1]
 */
export function formatExecutionTrace(pack: ReplayPack): string {
  const { manifest, auditRecords, artifacts } = pack;

  // Build a lookup from invocationId → artifact list (via ArtifactRef on the record)
  const artifactsByInvocation: Map<string, Artifact[]> = new Map();
  for (const artifact of artifacts) {
    const key = artifact.provenanceId;
    const existing = artifactsByInvocation.get(key) ?? [];
    existing.push(artifact);
    artifactsByInvocation.set(key, existing);
  }

  const header = [
    `═══ OpenClaw Execution Trace ═══`,
    `Session  : ${manifest.sessionId}`,
    `Exported : ${manifest.exportedAt}`,
    `Records  : ${manifest.recordCount}  |  Executions: ${manifest.executionCount}  |  Denials: ${manifest.denialCount}  |  Approvals: ${manifest.approvalCount}`,
    manifest.durationMs !== null
      ? `Duration : ${(manifest.durationMs / 1000).toFixed(2)}s`
      : `Duration : n/a`,
    `Tools    : ${manifest.toolsInvoked.join(', ') || '(none)'}`,
    `Artifacts: ${manifest.artifactCount}`,
    `═══════════════════════════════`,
    '',
  ];

  const lines: string[] = [];
  for (const record of auditRecords) {
    const ts = record.startedAt.slice(0, 19) + 'Z'; // trim to seconds
    const icon = EVENT_EMOJI[record.eventType] ?? '·';
    const event = record.eventType.padEnd(20);
    const tool = (record.toolName ?? '—').padEnd(20);
    const scope = `[${record.principalId} / ${record.sessionId}${record.taskId ? ` / ${record.taskId}` : ''}]`;

    let suffix = '';
    if (record.eventType === 'policy.denied' || record.eventType === 'tool.denied') {
      suffix = `  reason: ${record.policyDecision?.reason ?? '—'}`;
      if (record.policyDecision?.matchedRuleId) {
        suffix += `  rule: ${record.policyDecision.matchedRuleId}`;
      }
    } else if (record.eventType === 'tool.error') {
      suffix = `  error: ${record.error ?? '—'}`;
    }

    lines.push(`${ts}  ${icon} ${event} ${tool} ${scope}${suffix}`);

    // Artifact summary lines for tool.finished events
    if (record.eventType === 'tool.finished' && record.taskId) {
      const taskArtifacts = artifactsByInvocation.get(record.taskId) ?? [];
      for (const art of taskArtifacts) {
        lines.push(`       └─ artifact [${art.type}] ${art.uri}  (${art.retentionClass}, sha: ${art.checksum.slice(0, 12)})`);
      }
    }
  }

  const footer = ['', `═══ end of trace (${auditRecords.length} records) ═══`];

  return [...header, ...lines, ...footer].join('\n');
}

// ---------------------------------------------------------------------------
// A. Replay diff
// ---------------------------------------------------------------------------

export interface ReplayDiffResult {
  sessionA: string;
  sessionB: string;
  /**
   * Events in A with no counterpart (same eventType + toolName + taskId) in B.
   * Ordered by position in A.
   */
  onlyInA: AuditRecord[];
  /**
   * Events in B with no counterpart in A.
   */
  onlyInB: AuditRecord[];
  /**
   * Events whose eventType + toolName match in both packs but whose
   * recorded error / policyDecision differ.
   */
  changed: Array<{ inA: AuditRecord; inB: AuditRecord; fields: string[] }>;
  /** True when onlyInA, onlyInB, and changed are all empty. */
  identical: boolean;
}

/**
 * Produce a structured diff between two replay packs.
 *
 * Events are matched greedily in order by (eventType, toolName, taskId).
 * This is sufficient for deterministic session comparison; it is not intended
 * as a full Myers-diff line-level comparison.
 *
 * The function is pure — it reads both packs and returns a result with no
 * side effects.
 */
export function diffReplayPacks(a: ReplayPack, b: ReplayPack): ReplayDiffResult {
  type Key = string;
  const makeKey = (r: AuditRecord): Key =>
    [r.eventType, r.toolName ?? '', r.taskId ?? ''].join('::');

  // Build frequency maps
  const aKeys = a.auditRecords.map(makeKey);
  const bKeys = b.auditRecords.map(makeKey);

  const bAvailable = new Map<Key, AuditRecord[]>();
  for (const record of b.auditRecords) {
    const k = makeKey(record);
    const list = bAvailable.get(k) ?? [];
    list.push(record);
    bAvailable.set(k, list);
  }

  const onlyInA: AuditRecord[] = [];
  const changed: ReplayDiffResult['changed'] = [];
  const matchedBIds = new Set<string>();

  for (const recordA of a.auditRecords) {
    const k = makeKey(recordA);
    const candidates = bAvailable.get(k) ?? [];
    const match = candidates.find((r) => !matchedBIds.has(r.id));

    if (!match) {
      onlyInA.push(recordA);
    } else {
      matchedBIds.add(match.id);
      // Check for semantic differences in matched pair
      const diffFields: string[] = [];
      if (recordA.error !== match.error) diffFields.push('error');
      if (JSON.stringify(recordA.policyDecision) !== JSON.stringify(match.policyDecision))
        diffFields.push('policyDecision');
      if (recordA.runtimeTarget !== match.runtimeTarget) diffFields.push('runtimeTarget');
      if (diffFields.length > 0) changed.push({ inA: recordA, inB: match, fields: diffFields });
    }
  }

  const onlyInB = b.auditRecords.filter((r) => !matchedBIds.has(r.id));

  // Suppress bKeys usage (only needed conceptually)
  void aKeys;
  void bKeys;

  return {
    sessionA: a.manifest.sessionId,
    sessionB: b.manifest.sessionId,
    onlyInA,
    onlyInB,
    changed,
    identical: onlyInA.length === 0 && onlyInB.length === 0 && changed.length === 0,
  };
}

// ---------------------------------------------------------------------------
// A. Replay sequence validation
// ---------------------------------------------------------------------------

export interface ReplayExpectedEvent {
  /** Required. Must match exactly. */
  eventType: string;
  /** Optional. When set, must match. */
  toolName?: string;
  /** Optional. When set, must match. */
  taskId?: string;
}

export interface ReplaySequenceViolation {
  index: number;
  expected: ReplayExpectedEvent;
  /** Actual event at this position, or undefined if the pack is shorter. */
  actual: AuditRecord | undefined;
  reason: string;
}

export interface ReplaySequenceResult {
  valid: boolean;
  violations: ReplaySequenceViolation[];
}

/**
 * Validate that a replay pack's audit records match an expected ordered sequence.
 *
 * Only the first `expected.length` records of the pack are checked.
 * If the pack has fewer records than expected, missing positions are violations.
 *
 * This is a pure assertion function with no side effects.
 */
export function validateReplaySequence(
  pack: ReplayPack,
  expected: ReplayExpectedEvent[]
): ReplaySequenceResult {
  const violations: ReplaySequenceViolation[] = [];

  for (let i = 0; i < expected.length; i++) {
    const exp = expected[i];
    const actual = pack.auditRecords[i];

    if (!actual) {
      violations.push({
        index: i,
        expected: exp,
        actual: undefined,
        reason: `No record at position ${i}; expected eventType="${exp.eventType}"`,
      });
      continue;
    }

    if (actual.eventType !== exp.eventType) {
      violations.push({
        index: i,
        expected: exp,
        actual,
        reason: `eventType mismatch at position ${i}: expected="${exp.eventType}" actual="${actual.eventType}"`,
      });
      continue; // skip optional checks since the event type is already wrong
    }

    if (exp.toolName !== undefined && actual.toolName !== exp.toolName) {
      violations.push({
        index: i,
        expected: exp,
        actual,
        reason: `toolName mismatch at position ${i}: expected="${exp.toolName}" actual="${actual.toolName ?? '(none)'}"`,
      });
    }

    if (exp.taskId !== undefined && actual.taskId !== exp.taskId) {
      violations.push({
        index: i,
        expected: exp,
        actual,
        reason: `taskId mismatch at position ${i}: expected="${exp.taskId}" actual="${actual.taskId ?? '(none)'}"`,
      });
    }
  }

  return { valid: violations.length === 0, violations };
}

// ---------------------------------------------------------------------------
// B. Audit integrity check
// ---------------------------------------------------------------------------

export type AuditIntegrityViolationKind =
  | 'unmatched_started'      // tool.started with no tool.finished or tool.error
  | 'orphaned_finished'      // tool.finished with no preceding tool.started
  | 'denial_without_policy'  // tool.denied / policy.denied with no policyDecision
  | 'approval_lifecycle_incomplete'; // approval.requested with no approval.resolved

export interface AuditIntegrityViolation {
  kind: AuditIntegrityViolationKind;
  record: AuditRecord;
  message: string;
}

export interface AuditIntegrityResult {
  valid: boolean;
  violations: AuditIntegrityViolation[];
}

/**
 * Check the audit integrity of a replay pack.
 *
 * Validates:
 *   1. Every tool.started has a matching tool.finished or tool.error (same taskId + toolName).
 *   2. Every tool.finished has a preceding tool.started.
 *   3. Every tool.denied / policy.denied carries a policyDecision.
 *   4. Every approval.requested has a matching approval.resolved.
 *
 * This is a pure function — no side effects, no DB access.
 */
export function checkAuditIntegrity(pack: ReplayPack): AuditIntegrityResult {
  const violations: AuditIntegrityViolation[] = [];
  const records = pack.auditRecords;

  type InvKey = string;
  const makeInvKey = (r: AuditRecord): InvKey =>
    [r.taskId ?? '', r.toolName ?? '', r.principalId].join('::');

  // Track open starts
  const openStarts = new Map<InvKey, AuditRecord>();
  // Track finished/errored keys to allow orphan detection
  const closedKeys = new Set<InvKey>();
  // Track open approval requests by (sessionId + requestedAction)
  const openApprovals = new Map<string, AuditRecord>();

  for (const record of records) {
    const invKey = makeInvKey(record);

    if (record.eventType === 'tool.started') {
      openStarts.set(invKey, record);

    } else if (record.eventType === 'tool.finished' || record.eventType === 'tool.error') {
      if (!openStarts.has(invKey)) {
        violations.push({
          kind: 'orphaned_finished',
          record,
          message: `${record.eventType} for tool "${record.toolName ?? '(unknown)'}" has no preceding tool.started (key: ${invKey})`,
        });
      } else {
        openStarts.delete(invKey);
      }
      closedKeys.add(invKey);

    } else if (record.eventType === 'tool.denied' || record.eventType === 'policy.denied') {
      if (!record.policyDecision) {
        violations.push({
          kind: 'denial_without_policy',
          record,
          message: `${record.eventType} for tool "${record.toolName ?? '(unknown)'}" is missing policyDecision`,
        });
      }

    } else if (record.eventType === 'approval.requested') {
      const approvalKey = `${record.sessionId}::${record.taskId ?? ''}`;
      openApprovals.set(approvalKey, record);

    } else if (record.eventType === 'approval.resolved') {
      const approvalKey = `${record.sessionId}::${record.taskId ?? ''}`;
      openApprovals.delete(approvalKey);
    }
  }

  // Any still-open starts = unmatched
  for (const [, record] of openStarts) {
    violations.push({
      kind: 'unmatched_started',
      record,
      message: `tool.started for "${record.toolName ?? '(unknown)'}" has no matching tool.finished or tool.error`,
    });
  }

  // Any still-open approvals = incomplete lifecycle
  for (const [, record] of openApprovals) {
    violations.push({
      kind: 'approval_lifecycle_incomplete',
      record,
      message: `approval.requested has no matching approval.resolved for session "${record.sessionId}"`,
    });
  }

  return { valid: violations.length === 0, violations };
}

// ---------------------------------------------------------------------------
// Replay pack shape
// ---------------------------------------------------------------------------

export interface ReplayPackManifest {
  version: '1';
  sessionId: string;
  exportedAt: string;
  recordCount: number;
  artifactCount: number;
  toolsInvoked: string[];
  principalsInvolved: string[];
  /** Number of broker denials recorded in this session */
  denialCount: number;
  /** Number of completed tool executions (tool.finished events) */
  executionCount: number;
  /** Number of approval-related events (approval.requested + approval.resolved) */
  approvalCount: number;
  /** Wall-clock duration of the session in ms (last record − first record) */
  durationMs: number | null;
}

export interface ReplayPack {
  manifest: ReplayPackManifest;
  auditRecords: AuditRecord[];
  artifacts: Artifact[];
}
