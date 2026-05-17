/**
 * Tests for the audit log.
 */

import { AuditLog } from '../src/core/audit';

describe('AuditLog', () => {
  let log: AuditLog;

  beforeEach(() => {
    log = new AuditLog({ dbPath: ':memory:' });
  });

  afterEach(() => {
    log.close();
  });

  it('writes and retrieves a record by id', () => {
    const record = log.write({
      sessionId: 's-1',
      principalId: 'p-1',
      eventType: 'tool.started',
      toolName: 'file_read',
      startedAt: new Date().toISOString(),
    });

    expect(record.id).toBeTruthy();
    const fetched = log.getById(record.id);
    expect(fetched).toBeDefined();
    expect(fetched?.eventType).toBe('tool.started');
    expect(fetched?.toolName).toBe('file_read');
  });

  it('queries records by session', () => {
    log.write({ sessionId: 's-1', principalId: 'p-1', eventType: 'tool.started', startedAt: new Date().toISOString() });
    log.write({ sessionId: 's-1', principalId: 'p-1', eventType: 'tool.finished', startedAt: new Date().toISOString() });
    log.write({ sessionId: 's-2', principalId: 'p-2', eventType: 'tool.started', startedAt: new Date().toISOString() });

    const records = log.queryBySession('s-1');
    expect(records).toHaveLength(2);
    expect(records.every((r) => r.sessionId === 's-1')).toBe(true);
  });

  it('queries records by task', () => {
    log.write({ sessionId: 's-1', taskId: 't-1', principalId: 'p-1', eventType: 'tool.started', startedAt: new Date().toISOString() });
    log.write({ sessionId: 's-1', taskId: 't-2', principalId: 'p-1', eventType: 'tool.started', startedAt: new Date().toISOString() });

    const records = log.queryByTask('t-1');
    expect(records).toHaveLength(1);
    expect(records[0].taskId).toBe('t-1');
  });

  it('queries records by principal', () => {
    log.write({ sessionId: 's-1', principalId: 'p-1', eventType: 'tool.started', startedAt: new Date().toISOString() });
    log.write({ sessionId: 's-2', principalId: 'p-2', eventType: 'tool.finished', startedAt: new Date().toISOString() });

    const records = log.queryByPrincipal('p-1');
    expect(records).toHaveLength(1);
    expect(records[0].principalId).toBe('p-1');
  });

  it('serializes and deserializes complex fields', () => {
    const params = { path: '/foo/bar', mode: 'read' };
    const policyDecision = { mode: 'allow' as const, reason: 'test', requiresApproval: false, auditRequired: true };
    const artifacts = [{ id: 'art-1', uri: '/tmp/file.txt', checksum: 'abc' }];

    const record = log.write({
      sessionId: 's-1',
      principalId: 'p-1',
      eventType: 'tool.finished',
      params,
      policyDecision,
      artifacts,
      startedAt: new Date().toISOString(),
    });

    const fetched = log.getById(record.id)!;
    expect(fetched.params).toEqual(params);
    expect(fetched.policyDecision).toEqual(policyDecision);
    expect(fetched.artifacts).toEqual(artifacts);
  });

  it('returns undefined for unknown id', () => {
    expect(log.getById('nonexistent')).toBeUndefined();
  });

  it('exports all records', () => {
    log.write({ sessionId: 's-1', principalId: 'p-1', eventType: 'tool.started', startedAt: new Date().toISOString() });
    log.write({ sessionId: 's-2', principalId: 'p-2', eventType: 'tool.finished', startedAt: new Date().toISOString() });

    const all = log.exportAll();
    expect(all.length).toBeGreaterThanOrEqual(2);
  });
});
