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

  const manifest: ReplayPackManifest = {
    version: '1',
    sessionId,
    exportedAt: new Date().toISOString(),
    recordCount: auditRecords.length,
    artifactCount: artifacts.length,
    toolsInvoked,
    principalsInvolved,
  };

  return { manifest, auditRecords, artifacts };
}
