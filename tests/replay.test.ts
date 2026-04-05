/**
 * Tests for the replay pack builder.
 */

import { buildReplayPack } from '../src/core/replay';
import { AuditLog } from '../src/core/audit';
import { ArtifactStore } from '../src/core/artifacts';

describe('buildReplayPack', () => {
  let auditLog: AuditLog;
  let artifactStore: ArtifactStore;

  beforeEach(() => {
    auditLog = new AuditLog({ dbPath: ':memory:' });
    artifactStore = new ArtifactStore({ dbPath: ':memory:' });
  });

  afterEach(() => {
    auditLog.close();
    artifactStore.close();
  });

  it('returns a pack with empty arrays for a session with no records', () => {
    const pack = buildReplayPack('session-empty', auditLog);
    expect(pack.manifest.sessionId).toBe('session-empty');
    expect(pack.manifest.recordCount).toBe(0);
    expect(pack.auditRecords).toHaveLength(0);
    expect(pack.artifacts).toHaveLength(0);
    expect(pack.manifest.version).toBe('1');
    expect(pack.manifest.exportedAt).toBeTruthy();
  });

  it('includes all audit records for the session', () => {
    auditLog.write({
      sessionId: 'ses-1',
      principalId: 'p-1',
      eventType: 'tool.started',
      toolName: 'file_read',
      startedAt: new Date().toISOString(),
    });
    auditLog.write({
      sessionId: 'ses-1',
      principalId: 'p-1',
      eventType: 'tool.finished',
      toolName: 'file_read',
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
    });
    // Different session — should NOT appear
    auditLog.write({
      sessionId: 'ses-2',
      principalId: 'p-2',
      eventType: 'tool.started',
      toolName: 'other_tool',
      startedAt: new Date().toISOString(),
    });

    const pack = buildReplayPack('ses-1', auditLog);
    expect(pack.manifest.recordCount).toBe(2);
    expect(pack.auditRecords).toHaveLength(2);
    expect(pack.auditRecords.every((r) => r.sessionId === 'ses-1')).toBe(true);
  });

  it('populates toolsInvoked and principalsInvolved in manifest', () => {
    auditLog.write({
      sessionId: 'ses-tools',
      principalId: 'p-alpha',
      eventType: 'tool.started',
      toolName: 'file_read',
      startedAt: new Date().toISOString(),
    });
    auditLog.write({
      sessionId: 'ses-tools',
      principalId: 'p-beta',
      eventType: 'tool.started',
      toolName: 'file_write',
      startedAt: new Date().toISOString(),
    });
    auditLog.write({
      sessionId: 'ses-tools',
      principalId: 'p-alpha',
      eventType: 'tool.started',
      toolName: 'file_read', // duplicate — should appear only once
      startedAt: new Date().toISOString(),
    });

    const pack = buildReplayPack('ses-tools', auditLog);
    expect(pack.manifest.toolsInvoked).toContain('file_read');
    expect(pack.manifest.toolsInvoked).toContain('file_write');
    expect(pack.manifest.toolsInvoked.filter((t) => t === 'file_read')).toHaveLength(1); // deduplicated
    expect(pack.manifest.principalsInvolved).toContain('p-alpha');
    expect(pack.manifest.principalsInvolved).toContain('p-beta');
  });

  it('includes artifacts from artifactStore when provided', () => {
    const taskId = 't-replay';
    auditLog.write({
      sessionId: 'ses-art',
      taskId,
      principalId: 'p-1',
      eventType: 'tool.finished',
      toolName: 'build',
      startedAt: new Date().toISOString(),
    });
    artifactStore.store({
      type: 'file',
      uri: '/workspace/out.bin',
      provenanceId: taskId,
      checksum: 'abc',
    });
    artifactStore.store({
      type: 'log',
      uri: '/logs/build.log',
      provenanceId: taskId,
      checksum: 'def',
    });

    const pack = buildReplayPack('ses-art', auditLog, artifactStore);
    expect(pack.manifest.artifactCount).toBe(2);
    expect(pack.artifacts).toHaveLength(2);
    expect(pack.artifacts.map((a) => a.uri)).toContain('/workspace/out.bin');
  });

  it('returns empty artifacts list when no artifactStore is provided', () => {
    auditLog.write({
      sessionId: 'ses-nostore',
      principalId: 'p-1',
      taskId: 'task-ns',
      eventType: 'tool.finished',
      startedAt: new Date().toISOString(),
    });
    const pack = buildReplayPack('ses-nostore', auditLog);
    expect(pack.artifacts).toHaveLength(0);
    expect(pack.manifest.artifactCount).toBe(0);
  });

  it('replay pack is JSON-serialisable (self-contained)', () => {
    auditLog.write({
      sessionId: 'ses-serial',
      principalId: 'p-1',
      eventType: 'tool.started',
      toolName: 'file_read',
      startedAt: new Date().toISOString(),
    });
    const pack = buildReplayPack('ses-serial', auditLog);
    expect(() => JSON.stringify(pack)).not.toThrow();
    const roundTripped = JSON.parse(JSON.stringify(pack));
    expect(roundTripped.manifest.sessionId).toBe('ses-serial');
  });
});
