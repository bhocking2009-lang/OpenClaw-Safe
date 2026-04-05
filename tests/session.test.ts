/**
 * Tests for session and task management.
 */

import { SessionStore } from '../src/core/session';

describe('SessionStore', () => {
  let store: SessionStore;

  beforeEach(() => {
    store = new SessionStore({ dbPath: ':memory:' });
  });

  afterEach(() => {
    store.close();
  });

  // Sessions

  it('creates and retrieves a session', () => {
    const session = store.createSession({
      principalId: 'p-1',
      agentId: 'a-1',
    });

    expect(session.id).toBeTruthy();
    expect(session.principalId).toBe('p-1');
    expect(session.agentId).toBe('a-1');
    expect(session.mode).toBe('interactive');
    expect(session.budget).toBe(100_000);
    expect(session.elevationState).toBe(false);

    const fetched = store.getSession(session.id);
    expect(fetched).toEqual(session);
  });

  it('returns undefined for unknown session', () => {
    expect(store.getSession('nonexistent')).toBeUndefined();
  });

  it('lists sessions by principal', () => {
    store.createSession({ principalId: 'p-1', agentId: 'a-1' });
    store.createSession({ principalId: 'p-1', agentId: 'a-2' });
    store.createSession({ principalId: 'p-2', agentId: 'a-1' });

    const sessions = store.listSessionsByPrincipal('p-1');
    expect(sessions).toHaveLength(2);
    expect(sessions.every((s) => s.principalId === 'p-1')).toBe(true);
  });

  it('updates session fields', () => {
    const session = store.createSession({ principalId: 'p-1', agentId: 'a-1', budget: 5000 });
    const updated = store.updateSession(session.id, { budget: 4000, elevationState: true });

    expect(updated).toBeDefined();
    expect(updated?.budget).toBe(4000);
    expect(updated?.elevationState).toBe(true);

    const fetched = store.getSession(session.id);
    expect(fetched?.budget).toBe(4000);
    expect(fetched?.elevationState).toBe(true);
  });

  it('returns undefined when updating non-existent session', () => {
    expect(store.updateSession('nonexistent', { budget: 1 })).toBeUndefined();
  });

  it('deletes a session', () => {
    const session = store.createSession({ principalId: 'p-1', agentId: 'a-1' });
    store.deleteSession(session.id);
    expect(store.getSession(session.id)).toBeUndefined();
  });

  // Tasks

  it('creates and retrieves a task', () => {
    const session = store.createSession({ principalId: 'p-1', agentId: 'a-1' });
    const task = store.createTask({
      sessionId: session.id,
      title: 'Run lint',
      ownerId: 'p-1',
      capabilitySet: ['run_lint'],
      sandboxClass: 'test-runner',
    });

    expect(task.id).toBeTruthy();
    expect(task.title).toBe('Run lint');
    expect(task.state).toBe('pending');
    expect(task.capabilitySet).toEqual(['run_lint']);
    expect(task.sandboxClass).toBe('test-runner');

    const fetched = store.getTask(task.id);
    expect(fetched).toEqual(task);
  });

  it('returns undefined for unknown task', () => {
    expect(store.getTask('nonexistent')).toBeUndefined();
  });

  it('lists tasks by session', () => {
    const session = store.createSession({ principalId: 'p-1', agentId: 'a-1' });
    store.createTask({ sessionId: session.id, title: 'Task 1', ownerId: 'p-1' });
    store.createTask({ sessionId: session.id, title: 'Task 2', ownerId: 'p-1' });

    const tasks = store.listTasksBySession(session.id);
    expect(tasks).toHaveLength(2);
  });

  it('updates task state', () => {
    const session = store.createSession({ principalId: 'p-1', agentId: 'a-1' });
    const task = store.createTask({ sessionId: session.id, title: 'Run tests', ownerId: 'p-1' });

    const updated = store.updateTaskState(task.id, 'running', 'executor-1');
    expect(updated?.state).toBe('running');
    expect(updated?.executorId).toBe('executor-1');

    const fetched = store.getTask(task.id);
    expect(fetched?.state).toBe('running');
  });

  it('returns undefined when updating non-existent task state', () => {
    expect(store.updateTaskState('nonexistent', 'running')).toBeUndefined();
  });

  it('updates task capabilities', () => {
    const session = store.createSession({ principalId: 'p-1', agentId: 'a-1' });
    const task = store.createTask({ sessionId: session.id, title: 'Task', ownerId: 'p-1', capabilitySet: ['a'] });

    const updated = store.updateTaskCapabilities(task.id, ['a', 'b', 'c']);
    expect(updated?.capabilitySet).toEqual(['a', 'b', 'c']);
  });

  it('lists tasks by state', () => {
    const session = store.createSession({ principalId: 'p-1', agentId: 'a-1' });
    const t1 = store.createTask({ sessionId: session.id, title: 'T1', ownerId: 'p-1' });
    const t2 = store.createTask({ sessionId: session.id, title: 'T2', ownerId: 'p-1' });
    store.updateTaskState(t1.id, 'running');
    store.updateTaskState(t2.id, 'completed');

    const pending = store.listTasksByState('pending');
    const running = store.listTasksByState('running');
    const completed = store.listTasksByState('completed');

    // t1 should be running, t2 completed, none pending
    expect(running.some((t) => t.id === t1.id)).toBe(true);
    expect(completed.some((t) => t.id === t2.id)).toBe(true);
    // These two were the only tasks, none left pending
    expect(pending.some((t) => t.id === t1.id || t.id === t2.id)).toBe(false);
  });
});
