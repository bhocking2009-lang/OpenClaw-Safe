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
  const { manifest, auditRecords } = pack;

  const header = [
    `═══ OpenClaw Execution Trace ═══`,
    `Session  : ${manifest.sessionId}`,
    `Exported : ${manifest.exportedAt}`,
    `Records  : ${manifest.recordCount}  |  Executions: ${manifest.executionCount}  |  Denials: ${manifest.denialCount}  |  Approvals: ${manifest.approvalCount}`,
    manifest.durationMs !== null
      ? `Duration : ${(manifest.durationMs / 1000).toFixed(2)}s`
      : `Duration : n/a`,
    `Tools    : ${manifest.toolsInvoked.join(', ') || '(none)'}`,
    `═══════════════════════════════`,
    '',
  ];

  const lines = auditRecords.map((record) => {
    const ts = record.startedAt.slice(0, 19) + 'Z'; // trim to seconds
    const icon = EVENT_EMOJI[record.eventType] ?? '·';
    const event = record.eventType.padEnd(20);
    const tool = (record.toolName ?? '—').padEnd(20);
    const scope = `[${record.principalId} / ${record.sessionId}${record.taskId ? ` / ${record.taskId}` : ''}]`;

    let suffix = '';
    if (record.eventType === 'policy.denied' || record.eventType === 'tool.denied') {
      suffix = `  reason: ${record.policyDecision?.reason ?? '—'}`;
    } else if (record.eventType === 'tool.error') {
      suffix = `  error: ${record.error ?? '—'}`;
    }

    return `${ts}  ${icon} ${event} ${tool} ${scope}${suffix}`;
  });

  const footer = ['', `═══ end of trace (${auditRecords.length} records) ═══`];

  return [...header, ...lines, ...footer].join('\n');
}
