/**
 * Tests for the replay pack builder.
 */

import { buildReplayPack, formatExecutionTrace, ReplayPack } from '../src/core/replay';
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

  // --- Enhanced manifest stats ---

  it('manifest includes denialCount for denied tool events', () => {
    auditLog.write({ sessionId: 'ses-stats', principalId: 'p', eventType: 'tool.denied', startedAt: new Date().toISOString() });
    auditLog.write({ sessionId: 'ses-stats', principalId: 'p', eventType: 'policy.denied', startedAt: new Date().toISOString() });
    auditLog.write({ sessionId: 'ses-stats', principalId: 'p', eventType: 'tool.finished', toolName: 'file_read', startedAt: new Date().toISOString() });
    const pack = buildReplayPack('ses-stats', auditLog);
    expect(pack.manifest.denialCount).toBe(2);
    expect(pack.manifest.executionCount).toBe(1);
  });

  it('manifest includes approvalCount for approval events', () => {
    auditLog.write({ sessionId: 'ses-appr', principalId: 'p', eventType: 'approval.requested', startedAt: new Date().toISOString() });
    auditLog.write({ sessionId: 'ses-appr', principalId: 'p', eventType: 'approval.resolved', startedAt: new Date().toISOString() });
    const pack = buildReplayPack('ses-appr', auditLog);
    expect(pack.manifest.approvalCount).toBe(2);
  });

  it('manifest durationMs is null for sessions with fewer than 2 records', () => {
    const pack = buildReplayPack('ses-empty', auditLog);
    expect(pack.manifest.durationMs).toBeNull();
  });

  it('manifest durationMs is non-negative for multi-record sessions', () => {
    const t1 = new Date(Date.now()).toISOString();
    const t2 = new Date(Date.now() + 1000).toISOString();
    auditLog.write({ sessionId: 'ses-dur', principalId: 'p', eventType: 'tool.started', startedAt: t1 });
    auditLog.write({ sessionId: 'ses-dur', principalId: 'p', eventType: 'tool.finished', startedAt: t2 });
    const pack = buildReplayPack('ses-dur', auditLog);
    expect(pack.manifest.durationMs).not.toBeNull();
    expect(pack.manifest.durationMs!).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// formatExecutionTrace
// ---------------------------------------------------------------------------

describe('formatExecutionTrace', () => {
  it('returns a non-empty string for an empty session', () => {
    const auditLog = new AuditLog({ dbPath: ':memory:' });
    const pack = buildReplayPack('ses-fmt', auditLog);
    const trace = formatExecutionTrace(pack);
    expect(typeof trace).toBe('string');
    expect(trace.length).toBeGreaterThan(0);
    auditLog.close();
  });

  it('contains session ID in the header', () => {
    const auditLog = new AuditLog({ dbPath: ':memory:' });
    const pack = buildReplayPack('ses-header-check', auditLog);
    const trace = formatExecutionTrace(pack);
    expect(trace).toContain('ses-header-check');
    auditLog.close();
  });

  it('contains one line per audit record', () => {
    const auditLog = new AuditLog({ dbPath: ':memory:' });
    auditLog.write({ sessionId: 'ses-lines', principalId: 'p', eventType: 'tool.started', toolName: 'file_read', startedAt: new Date().toISOString() });
    auditLog.write({ sessionId: 'ses-lines', principalId: 'p', eventType: 'tool.finished', toolName: 'file_read', startedAt: new Date().toISOString() });
    const pack = buildReplayPack('ses-lines', auditLog);
    const trace = formatExecutionTrace(pack);
    // Each event type should appear in the trace
    expect(trace).toContain('tool.started');
    expect(trace).toContain('tool.finished');
    auditLog.close();
  });

  it('includes execution and denial stats in header', () => {
    const auditLog = new AuditLog({ dbPath: ':memory:' });
    auditLog.write({ sessionId: 'ses-hdr', principalId: 'p', eventType: 'tool.finished', toolName: 'f', startedAt: new Date().toISOString() });
    auditLog.write({ sessionId: 'ses-hdr', principalId: 'p', eventType: 'tool.denied', startedAt: new Date().toISOString() });
    const pack = buildReplayPack('ses-hdr', auditLog);
    const trace = formatExecutionTrace(pack);
    expect(trace).toMatch(/Executions:\s*1/);
    expect(trace).toMatch(/Denials:\s*1/);
    auditLog.close();
  });

  it('is JSON-free (returns plain text, not JSON)', () => {
    const auditLog = new AuditLog({ dbPath: ':memory:' });
    const pack = buildReplayPack('ses-notjson', auditLog);
    const trace = formatExecutionTrace(pack);
    // Should not be parseable as top-level JSON object
    expect(() => JSON.parse(trace)).toThrow();
    auditLog.close();
  });

  it('all valid event types produce a recognisable icon or marker', () => {
    const eventTypes = ['tool.started', 'tool.finished', 'tool.error', 'tool.denied', 'policy.denied', 'approval.requested', 'approval.resolved'];
    const auditLog = new AuditLog({ dbPath: ':memory:' });
    for (const eventType of eventTypes) {
      auditLog.write({ sessionId: 'ses-icons', principalId: 'p', eventType, startedAt: new Date().toISOString() });
    }
    const pack = buildReplayPack('ses-icons', auditLog);
    const trace = formatExecutionTrace(pack);
    for (const eventType of eventTypes) {
      expect(trace).toContain(eventType);
    }
    auditLog.close();
  });
});

