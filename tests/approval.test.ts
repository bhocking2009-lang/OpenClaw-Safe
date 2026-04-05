/**
 * Tests for the approval system.
 */

import { ApprovalStore } from '../src/core/approval';

describe('ApprovalStore', () => {
  let store: ApprovalStore;

  beforeEach(() => {
    store = new ApprovalStore({ dbPath: ':memory:' });
  });

  afterEach(() => {
    store.close();
  });

  it('creates and retrieves an approval request', () => {
    const req = store.createRequest({
      taskId: 't-1',
      requestedAction: 'send_email(to=test@example.com)',
      riskClass: 'E',
      proposedScope: { to: 'test@example.com', subject: 'Hello' },
      duration: 'once',
      humanReadableDiff: 'Send email to test@example.com with subject "Hello"',
    });

    expect(req.id).toBeTruthy();
    expect(req.outcome).toBe('pending');
    expect(req.riskClass).toBe('E');

    const fetched = store.getRequest(req.id);
    expect(fetched).toEqual(req);
  });

  it('returns undefined for unknown request', () => {
    expect(store.getRequest('nonexistent')).toBeUndefined();
  });

  it('lists pending approvals', () => {
    store.createRequest({
      taskId: 't-1',
      requestedAction: 'action_1',
      riskClass: 'C',
      proposedScope: {},
      duration: 'once',
      humanReadableDiff: 'Run tests in sandbox',
    });
    store.createRequest({
      taskId: 't-2',
      requestedAction: 'action_2',
      riskClass: 'E',
      proposedScope: {},
      duration: 'once',
      humanReadableDiff: 'Send webhook',
    });

    const pending = store.listPending();
    expect(pending.length).toBeGreaterThanOrEqual(2);
    expect(pending.every((r) => r.outcome === 'pending')).toBe(true);
  });

  it('resolves an approval to approved', () => {
    const req = store.createRequest({
      taskId: 't-1',
      requestedAction: 'action',
      riskClass: 'D',
      proposedScope: {},
      duration: 'once',
      humanReadableDiff: 'Browse to example.com',
    });

    const resolved = store.resolve(req.id, 'approver-1', 'approved');
    expect(resolved).toBeDefined();
    expect(resolved?.outcome).toBe('approved');
    expect(resolved?.approverId).toBe('approver-1');
    expect(resolved?.resolvedAt).toBeTruthy();

    // Should no longer appear in pending
    const pending = store.listPending();
    expect(pending.find((r) => r.id === req.id)).toBeUndefined();
  });

  it('resolves an approval to denied', () => {
    const req = store.createRequest({
      taskId: 't-1',
      requestedAction: 'action',
      riskClass: 'F',
      proposedScope: {},
      duration: 'once',
      humanReadableDiff: 'Access secret FOO',
    });

    const resolved = store.resolve(req.id, 'approver-1', 'denied');
    expect(resolved?.outcome).toBe('denied');
  });

  it('cannot resolve an already-resolved request', () => {
    const req = store.createRequest({
      taskId: 't-1',
      requestedAction: 'action',
      riskClass: 'C',
      proposedScope: {},
      duration: 'once',
      humanReadableDiff: 'Run build',
    });

    store.resolve(req.id, 'approver-1', 'approved');
    const second = store.resolve(req.id, 'approver-2', 'denied');
    expect(second).toBeUndefined();

    // Outcome should still be 'approved'
    const fetched = store.getRequest(req.id);
    expect(fetched?.outcome).toBe('approved');
  });

  it('lists requests by task', () => {
    store.createRequest({ taskId: 't-1', requestedAction: 'a1', riskClass: 'A', proposedScope: {}, duration: 'once', humanReadableDiff: 'Read file' });
    store.createRequest({ taskId: 't-1', requestedAction: 'a2', riskClass: 'B', proposedScope: {}, duration: 'once', humanReadableDiff: 'Write file' });
    store.createRequest({ taskId: 't-2', requestedAction: 'a3', riskClass: 'C', proposedScope: {}, duration: 'once', humanReadableDiff: 'Run tests' });

    const forTask1 = store.listByTask('t-1');
    expect(forTask1).toHaveLength(2);
    expect(forTask1.every((r) => r.taskId === 't-1')).toBe(true);
  });

  it('serializes and deserializes proposedScope', () => {
    const scope = { domain: 'example.com', port: 443, tls: true };
    const req = store.createRequest({
      taskId: 't-1',
      requestedAction: 'browse',
      riskClass: 'D',
      proposedScope: scope,
      duration: 'session',
      humanReadableDiff: 'Browse to example.com',
    });

    const fetched = store.getRequest(req.id)!;
    expect(fetched.proposedScope).toEqual(scope);
  });
});
