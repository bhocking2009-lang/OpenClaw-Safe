/**
 * Phase 11 — Delegation Maturity tests.
 *
 * Covers:
 *   A. Delegation tree integrity   — parentTaskId, tree endpoint, hierarchy in replay
 *   B. Capability inheritance      — strict intersection, no widening, restriction audit
 *   C. Budget partitioning         — budgetCap allocation, total enforcement, audit events
 *   D. Cancellation / revocation   — cancel subtree, terminal states, audit events
 *   E. Denial paths                — depth exceeded, children limit, loop guard, budget exceeded
 *   F. SessionStore unit tests     — listChildTasks, countChildTasks, getDelegationTree
 *   G. Constants                   — MAX_CHILDREN_PER_TASK, MAX_DELEGATION_DEPTH exported
 */

import request from 'supertest';
import { Gateway, MAX_DELEGATION_DEPTH, MAX_CHILDREN_PER_TASK } from '../src/core/gateway';
import { PolicyEngine } from '../src/core/policy';
import { ToolBroker } from '../src/core/broker';
import { AuditLog } from '../src/core/audit';
import { SessionStore } from '../src/core/session';
import { ApprovalStore } from '../src/core/approval';
import { MemoryStore } from '../src/core/memory';
import { ArtifactStore } from '../src/core/artifacts';
import { PolicyRuleStore } from '../src/core/policy-store';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type App = Parameters<typeof request>[0];

interface GwSetup {
  app: App;
  sessionStore: SessionStore;
  auditLog: AuditLog;
  close(): void;
}

function makeGateway(): GwSetup {
  const policyEngine = new PolicyEngine();
  const auditLog = new AuditLog({ dbPath: ':memory:' });
  const sessionStore = new SessionStore({ dbPath: ':memory:' });
  const broker = new ToolBroker(policyEngine, auditLog, undefined, undefined, sessionStore);
  const approvalStore = new ApprovalStore({ dbPath: ':memory:' });
  const memoryStore = new MemoryStore({ dbPath: ':memory:' });
  const artifactStore = new ArtifactStore({ dbPath: ':memory:' });
  const policyRuleStore = new PolicyRuleStore({ dbPath: ':memory:' });
  const gateway = new Gateway(
    { host: '127.0.0.1', port: 0, dbPath: ':memory:', gatewaySecret: '' },
    { policyEngine, broker, auditLog, sessionStore, approvalStore, memoryStore, artifactStore, policyRuleStore }
  );
  return {
    app: gateway.getApp(),
    sessionStore,
    auditLog,
    close: () => {
      auditLog.close();
      sessionStore.close();
      approvalStore.close();
      memoryStore.close();
      artifactStore.close();
      policyRuleStore.close();
    },
  };
}

async function createSession(gw: GwSetup) {
  const res = await request(gw.app)
    .post('/v1/sessions')
    .send({ principalId: 'p-1', agentId: 'a-1', mode: 'task' });
  return res.body as { id: string };
}

async function createTask(gw: GwSetup, sessionId: string, capabilities: string[] = ['file_read', 'file_write']) {
  const res = await request(gw.app)
    .post('/v1/tasks')
    .send({ sessionId, title: 'root task', ownerId: 'p-1', capabilitySet: capabilities });
  return res.body as { id: string; capabilitySet: string[]; delegationDepth: number; budgetCap?: number };
}

async function delegate(
  gw: GwSetup,
  parentId: string,
  opts: { title?: string; requestedCapabilities?: string[]; budgetCap?: number } = {}
) {
  return request(gw.app)
    .post(`/v1/tasks/${parentId}/delegate`)
    .send({
      title: opts.title ?? 'child task',
      requestedCapabilities: opts.requestedCapabilities ?? ['file_read'],
      ...(opts.budgetCap !== undefined ? { budgetCap: opts.budgetCap } : {}),
    });
}

// ---------------------------------------------------------------------------
// A. Delegation Tree Integrity
// ---------------------------------------------------------------------------

describe('Delegation tree integrity', () => {
  it('child task has parentTaskId set to parent', async () => {
    const gw = makeGateway();
    const sess = await createSession(gw);
    const parent = await createTask(gw, sess.id);
    const res = await delegate(gw, parent.id);
    expect(res.status).toBe(201);
    expect(res.body.childTask.parentTaskId).toBe(parent.id);
    gw.close();
  });

  it('delegationDepth increments by 1 for each level', async () => {
    const gw = makeGateway();
    const sess = await createSession(gw);
    const root = await createTask(gw, sess.id);
    expect(root.delegationDepth).toBe(0);
    const child = (await delegate(gw, root.id)).body.childTask;
    expect(child.delegationDepth).toBe(1);
    const grandchild = (
      await request(gw.app)
        .post(`/v1/tasks/${child.id}/delegate`)
        .send({ title: 'gc', requestedCapabilities: ['file_read'] })
    ).body.childTask;
    expect(grandchild.delegationDepth).toBe(2);
    gw.close();
  });

  it('GET /tasks/:id/tree returns full hierarchy', async () => {
    const gw = makeGateway();
    const sess = await createSession(gw);
    const root = await createTask(gw, sess.id);
    const child = (await delegate(gw, root.id)).body.childTask;
    await request(gw.app)
      .post(`/v1/tasks/${child.id}/delegate`)
      .send({ title: 'gc', requestedCapabilities: ['file_read'] });

    const treeRes = await request(gw.app).get(`/v1/tasks/${root.id}/tree`);
    expect(treeRes.status).toBe(200);
    const tree = treeRes.body.tree;
    expect(tree.task.id).toBe(root.id);
    expect(tree.children).toHaveLength(1);
    expect(tree.children[0].task.id).toBe(child.id);
    expect(tree.children[0].children).toHaveLength(1);
    gw.close();
  });

  it('GET /tasks/:id/tree returns 404 for unknown task', async () => {
    const gw = makeGateway();
    const res = await request(gw.app).get('/v1/tasks/no-such-task/tree');
    expect(res.status).toBe(404);
    gw.close();
  });

  it('leaf task tree has empty children array', async () => {
    const gw = makeGateway();
    const sess = await createSession(gw);
    const root = await createTask(gw, sess.id);
    const treeRes = await request(gw.app).get(`/v1/tasks/${root.id}/tree`);
    expect(treeRes.body.tree.children).toHaveLength(0);
    gw.close();
  });

  it('multiple siblings are all present in tree', async () => {
    const gw = makeGateway();
    const sess = await createSession(gw);
    const root = await createTask(gw, sess.id);
    await delegate(gw, root.id, { title: 'c1' });
    await delegate(gw, root.id, { title: 'c2' });
    await delegate(gw, root.id, { title: 'c3' });
    const treeRes = await request(gw.app).get(`/v1/tasks/${root.id}/tree`);
    expect(treeRes.body.tree.children).toHaveLength(3);
    gw.close();
  });
});

// ---------------------------------------------------------------------------
// B. Capability Inheritance
// ---------------------------------------------------------------------------

describe('Capability inheritance', () => {
  it('child can request a strict subset of parent capabilities', async () => {
    const gw = makeGateway();
    const sess = await createSession(gw);
    const parent = await createTask(gw, sess.id, ['file_read', 'file_write', 'exec']);
    const res = await delegate(gw, parent.id, { requestedCapabilities: ['file_read'] });
    expect(res.status).toBe(201);
    expect(res.body.childTask.capabilitySet).toEqual(['file_read']);
    gw.close();
  });

  it('child can request same capabilities as parent (no restriction)', async () => {
    const gw = makeGateway();
    const sess = await createSession(gw);
    const parent = await createTask(gw, sess.id, ['file_read', 'file_write']);
    const res = await delegate(gw, parent.id, { requestedCapabilities: ['file_read', 'file_write'] });
    expect(res.status).toBe(201);
    expect(res.body.childTask.capabilitySet).toEqual(['file_read', 'file_write']);
    gw.close();
  });

  it('child cannot request capabilities beyond parent (widening denied)', async () => {
    const gw = makeGateway();
    const sess = await createSession(gw);
    const parent = await createTask(gw, sess.id, ['file_read']);
    const res = await delegate(gw, parent.id, { requestedCapabilities: ['file_read', 'exec'] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not in parent capabilitySet/i);
    gw.close();
  });

  it('emits delegation.capability.restricted audit event when child is narrower', async () => {
    const gw = makeGateway();
    const sess = await createSession(gw);
    const parent = await createTask(gw, sess.id, ['file_read', 'file_write']);
    const childRes = await delegate(gw, parent.id, { requestedCapabilities: ['file_read'] });
    const childId = childRes.body.childTask.id;

    const records = gw.auditLog.queryBySession(sess.id);
    const evt = records.find((r) => r.eventType === 'delegation.capability.restricted');
    expect(evt).toBeDefined();
    expect(evt?.taskId).toBe(childId);
    const delta = evt?.sessionDelta as { inherited: string[]; restricted: string[]; parentTaskId: string };
    expect(delta.inherited).toContain('file_read');
    expect(delta.restricted).toContain('file_write');
    expect(delta.parentTaskId).toBe(parent.id);
    gw.close();
  });

  it('does NOT emit delegation.capability.restricted when child has same capabilities', async () => {
    const gw = makeGateway();
    const sess = await createSession(gw);
    const parent = await createTask(gw, sess.id, ['file_read']);
    await delegate(gw, parent.id, { requestedCapabilities: ['file_read'] });
    const records = gw.auditLog.queryBySession(sess.id);
    const evt = records.find((r) => r.eventType === 'delegation.capability.restricted');
    expect(evt).toBeUndefined();
    gw.close();
  });

  it('capability set is inherited transitively and cannot be re-widened', async () => {
    const gw = makeGateway();
    const sess = await createSession(gw);
    const root = await createTask(gw, sess.id, ['file_read', 'file_write']);
    const child = (await delegate(gw, root.id, { requestedCapabilities: ['file_read'] })).body.childTask;
    // Child only has file_read — trying to delegate file_write to grandchild must fail
    const res = await request(gw.app)
      .post(`/v1/tasks/${child.id}/delegate`)
      .send({ title: 'gc', requestedCapabilities: ['file_write'] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not in parent capabilitySet/i);
    gw.close();
  });
});

// ---------------------------------------------------------------------------
// C. Budget Partitioning
// ---------------------------------------------------------------------------

describe('Budget partitioning', () => {
  it('child can have a budgetCap set', async () => {
    const gw = makeGateway();
    const sess = await createSession(gw);
    const parent = await createTask(gw, sess.id);
    // Set parent budgetCap via DB so partitioning is enforceable
    gw.sessionStore['db'].prepare('UPDATE tasks SET budget_cap = 1000 WHERE id = ?').run(parent.id);
    const res = await delegate(gw, parent.id, { budgetCap: 400 });
    expect(res.status).toBe(201);
    expect(res.body.childTask.budgetCap).toBe(400);
    gw.close();
  });

  it('emits delegation.budget.allocated audit event when budgetCap is set', async () => {
    const gw = makeGateway();
    const sess = await createSession(gw);
    const parent = await createTask(gw, sess.id);
    gw.sessionStore['db'].prepare('UPDATE tasks SET budget_cap = 1000 WHERE id = ?').run(parent.id);
    const childRes = await delegate(gw, parent.id, { budgetCap: 300 });
    const childId = childRes.body.childTask.id;
    const records = gw.auditLog.queryBySession(sess.id);
    const evt = records.find((r) => r.eventType === 'delegation.budget.allocated');
    expect(evt).toBeDefined();
    expect(evt?.taskId).toBe(childId);
    const delta = evt?.sessionDelta as { parentTaskId: string; budgetCap: number };
    expect(delta.budgetCap).toBe(300);
    expect(delta.parentTaskId).toBe(parent.id);
    gw.close();
  });

  it('enforces total child budgetCap does not exceed parent budgetCap', async () => {
    const gw = makeGateway();
    const sess = await createSession(gw);
    const parent = await createTask(gw, sess.id);
    gw.sessionStore['db'].prepare('UPDATE tasks SET budget_cap = 1000 WHERE id = ?').run(parent.id);
    await delegate(gw, parent.id, { budgetCap: 600, title: 'c1' }); // 600 / 1000 used
    await delegate(gw, parent.id, { budgetCap: 300, title: 'c2' }); // 900 / 1000 used
    const res = await delegate(gw, parent.id, { budgetCap: 200, title: 'overflow' }); // 1100 — over limit
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/budget partition exceeded/i);
    gw.close();
  });

  it('emits delegation.budget.exceeded audit event on partition violation', async () => {
    const gw = makeGateway();
    const sess = await createSession(gw);
    const parent = await createTask(gw, sess.id);
    gw.sessionStore['db'].prepare('UPDATE tasks SET budget_cap = 500 WHERE id = ?').run(parent.id);
    await delegate(gw, parent.id, { budgetCap: 400, title: 'c1' });
    await delegate(gw, parent.id, { budgetCap: 200, title: 'over' }); // 600 > 500
    const records = gw.auditLog.queryBySession(sess.id);
    const evt = records.find((r) => r.eventType === 'delegation.budget.exceeded');
    expect(evt).toBeDefined();
    gw.close();
  });

  it('allows exactly filling parent budget (no overage)', async () => {
    const gw = makeGateway();
    const sess = await createSession(gw);
    const parent = await createTask(gw, sess.id);
    gw.sessionStore['db'].prepare('UPDATE tasks SET budget_cap = 1000 WHERE id = ?').run(parent.id);
    const r1 = await delegate(gw, parent.id, { budgetCap: 500, title: 'c1' });
    const r2 = await delegate(gw, parent.id, { budgetCap: 500, title: 'c2' });
    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);
    gw.close();
  });

  it('no budgetCap enforcement when parent has no budgetCap', async () => {
    const gw = makeGateway();
    const sess = await createSession(gw);
    const parent = await createTask(gw, sess.id);
    // No parent budgetCap — large child budgetCap should be allowed
    const res = await delegate(gw, parent.id, { budgetCap: 999_999 });
    expect(res.status).toBe(201);
    gw.close();
  });

  it('does not emit budget.allocated event when no budgetCap is specified', async () => {
    const gw = makeGateway();
    const sess = await createSession(gw);
    const parent = await createTask(gw, sess.id);
    await delegate(gw, parent.id);
    const records = gw.auditLog.queryBySession(sess.id);
    const evt = records.find((r) => r.eventType === 'delegation.budget.allocated');
    expect(evt).toBeUndefined();
    gw.close();
  });
});

// ---------------------------------------------------------------------------
// D. Cancellation / Revocation
// ---------------------------------------------------------------------------

describe('Cancellation / revocation', () => {
  it('POST /tasks/:id/cancel cancels a single task with no children', async () => {
    const gw = makeGateway();
    const sess = await createSession(gw);
    const task = await createTask(gw, sess.id);
    const res = await request(gw.app).post(`/v1/tasks/${task.id}/cancel`);
    expect(res.status).toBe(200);
    expect(res.body.cancelled).toHaveLength(1);
    expect(res.body.cancelled[0].state).toBe('cancelled');
    gw.close();
  });

  it('cancels entire subtree recursively', async () => {
    const gw = makeGateway();
    const sess = await createSession(gw);
    const root = await createTask(gw, sess.id);
    const child1 = (await delegate(gw, root.id, { title: 'c1' })).body.childTask;
    const child2 = (await delegate(gw, root.id, { title: 'c2' })).body.childTask;
    await request(gw.app)
      .post(`/v1/tasks/${child1.id}/delegate`)
      .send({ title: 'gc1', requestedCapabilities: ['file_read'] });

    const res = await request(gw.app).post(`/v1/tasks/${root.id}/cancel`);
    expect(res.status).toBe(200);
    // root + child1 + gc1 + child2 = 4
    expect(res.body.cancelled).toHaveLength(4);
    const ids = res.body.cancelled.map((t: { id: string }) => t.id);
    expect(ids).toContain(root.id);
    expect(ids).toContain(child1.id);
    expect(ids).toContain(child2.id);
    gw.close();
  });

  it('emits task.cancelled audit event for each cancelled task', async () => {
    const gw = makeGateway();
    const sess = await createSession(gw);
    const root = await createTask(gw, sess.id);
    await delegate(gw, root.id, { title: 'c1' });
    await request(gw.app).post(`/v1/tasks/${root.id}/cancel`);
    const records = gw.auditLog.queryBySession(sess.id);
    const cancelledEvents = records.filter((r) => r.eventType === 'task.cancelled');
    expect(cancelledEvents).toHaveLength(2); // root + child
    gw.close();
  });

  it('skips already-completed tasks but still recurses to non-terminal children', async () => {
    const gw = makeGateway();
    const sess = await createSession(gw);
    const root = await createTask(gw, sess.id);
    const child = (await delegate(gw, root.id, { title: 'c1' })).body.childTask;
    // complete root before cancelling
    await request(gw.app).patch(`/v1/tasks/${root.id}/state`).send({ state: 'completed' });
    const res = await request(gw.app).post(`/v1/tasks/${root.id}/cancel`);
    // root is completed so NOT in cancelled list, but child should be
    const ids = res.body.cancelled.map((t: { id: string }) => t.id);
    expect(ids).not.toContain(root.id);
    expect(ids).toContain(child.id);
    gw.close();
  });

  it('returns 404 for unknown task', async () => {
    const gw = makeGateway();
    const res = await request(gw.app).post('/v1/tasks/no-such-task/cancel');
    expect(res.status).toBe(404);
    gw.close();
  });

  it('cancellation is idempotent — already-cancelled tasks are not double-counted', async () => {
    const gw = makeGateway();
    const sess = await createSession(gw);
    const task = await createTask(gw, sess.id);
    await request(gw.app).post(`/v1/tasks/${task.id}/cancel`);
    const res2 = await request(gw.app).post(`/v1/tasks/${task.id}/cancel`);
    expect(res2.body.cancelled).toHaveLength(0); // already cancelled
    gw.close();
  });

  it('audit event sessionDelta.cancelledBy is set to the root task id', async () => {
    const gw = makeGateway();
    const sess = await createSession(gw);
    const root = await createTask(gw, sess.id);
    const child = (await delegate(gw, root.id, { title: 'c1' })).body.childTask;
    await request(gw.app).post(`/v1/tasks/${root.id}/cancel`);
    const records = gw.auditLog.queryBySession(sess.id);
    const cancelEvt = records.find((r) => r.eventType === 'task.cancelled' && r.taskId === child.id);
    expect((cancelEvt?.sessionDelta as { cancelledBy: string }).cancelledBy).toBe(root.id);
    gw.close();
  });

  it('failed task is skipped but its children are still cancelled', async () => {
    const gw = makeGateway();
    const sess = await createSession(gw);
    const root = await createTask(gw, sess.id);
    await request(gw.app).patch(`/v1/tasks/${root.id}/state`).send({ state: 'failed' });
    const child = (await delegate(gw, root.id, { title: 'c1' })).body.childTask;
    const res = await request(gw.app).post(`/v1/tasks/${root.id}/cancel`);
    const ids = res.body.cancelled.map((t: { id: string }) => t.id);
    expect(ids).not.toContain(root.id);
    expect(ids).toContain(child.id);
    gw.close();
  });
});

// ---------------------------------------------------------------------------
// E. Denial paths
// ---------------------------------------------------------------------------

describe('Delegation denial paths', () => {
  it('rejects delegation when depth exceeds MAX_DELEGATION_DEPTH', async () => {
    const gw = makeGateway();
    const sess = await createSession(gw);
    const deepTask = gw.sessionStore.createTask({
      sessionId: sess.id,
      title: 'deep',
      ownerId: 'p-1',
      capabilitySet: ['file_read'],
      delegationDepth: MAX_DELEGATION_DEPTH,
    });
    const res = await request(gw.app)
      .post(`/v1/tasks/${deepTask.id}/delegate`)
      .send({ title: 'too deep', requestedCapabilities: ['file_read'] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/delegation depth/i);
    gw.close();
  });

  it('emits delegation.depth.exceeded audit event', async () => {
    const gw = makeGateway();
    const sess = await createSession(gw);
    const deepTask = gw.sessionStore.createTask({
      sessionId: sess.id,
      title: 'deep',
      ownerId: 'p-1',
      capabilitySet: ['file_read'],
      delegationDepth: MAX_DELEGATION_DEPTH,
    });
    await request(gw.app)
      .post(`/v1/tasks/${deepTask.id}/delegate`)
      .send({ title: 'too deep', requestedCapabilities: ['file_read'] });
    const records = gw.auditLog.queryBySession(sess.id);
    const evt = records.find((r) => r.eventType === 'delegation.depth.exceeded');
    expect(evt).toBeDefined();
    gw.close();
  });

  it('rejects delegation when child count exceeds MAX_CHILDREN_PER_TASK', async () => {
    const gw = makeGateway();
    const sess = await createSession(gw);
    const parent = await createTask(gw, sess.id);
    // Fill up to the limit
    for (let i = 0; i < MAX_CHILDREN_PER_TASK; i++) {
      const r = await delegate(gw, parent.id, { title: `c${i}` });
      expect(r.status).toBe(201);
    }
    // One more should fail
    const res = await delegate(gw, parent.id, { title: 'overflow' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/child task count/i);
    gw.close();
  }, 30_000);

  it('emits delegation.children.exceeded audit event', async () => {
    const gw = makeGateway();
    const sess = await createSession(gw);
    const parent = await createTask(gw, sess.id);
    for (let i = 0; i < MAX_CHILDREN_PER_TASK; i++) {
      await delegate(gw, parent.id, { title: `c${i}` });
    }
    await delegate(gw, parent.id, { title: 'overflow' });
    const records = gw.auditLog.queryBySession(sess.id);
    const evt = records.find((r) => r.eventType === 'delegation.children.exceeded');
    expect(evt).toBeDefined();
    gw.close();
  }, 30_000);

  it('rejects unknown parent task', async () => {
    const gw = makeGateway();
    const res = await request(gw.app)
      .post('/v1/tasks/no-such-task/delegate')
      .send({ title: 'x', requestedCapabilities: [] });
    expect(res.status).toBe(404);
    gw.close();
  });

  it('rejects missing title', async () => {
    const gw = makeGateway();
    const sess = await createSession(gw);
    const parent = await createTask(gw, sess.id);
    const res = await request(gw.app)
      .post(`/v1/tasks/${parent.id}/delegate`)
      .send({ requestedCapabilities: ['file_read'] });
    expect(res.status).toBe(400);
    gw.close();
  });

  it('rejects invalid budgetCap (zero)', async () => {
    const gw = makeGateway();
    const sess = await createSession(gw);
    const parent = await createTask(gw, sess.id);
    const res = await delegate(gw, parent.id, { budgetCap: 0 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/budgetCap/i);
    gw.close();
  });

  it('rejects invalid budgetCap (negative)', async () => {
    const gw = makeGateway();
    const sess = await createSession(gw);
    const parent = await createTask(gw, sess.id);
    const res = await delegate(gw, parent.id, { budgetCap: -100 });
    expect(res.status).toBe(400);
    gw.close();
  });
});

// ---------------------------------------------------------------------------
// F. SessionStore unit tests — new methods
// ---------------------------------------------------------------------------

describe('SessionStore delegation helpers', () => {
  it('listChildTasks returns direct children only', () => {
    const store = new SessionStore({ dbPath: ':memory:' });
    const sess = store.createSession({ principalId: 'p', agentId: 'a', mode: 'task' });
    const parent = store.createTask({ sessionId: sess.id, title: 'parent', ownerId: 'p' });
    const child1 = store.createTask({ sessionId: sess.id, title: 'c1', ownerId: 'p', parentTaskId: parent.id });
    const child2 = store.createTask({ sessionId: sess.id, title: 'c2', ownerId: 'p', parentTaskId: parent.id });
    // grandchild — should NOT appear in listChildTasks(parent.id)
    store.createTask({ sessionId: sess.id, title: 'gc', ownerId: 'p', parentTaskId: child1.id });
    const children = store.listChildTasks(parent.id);
    expect(children).toHaveLength(2);
    expect(children.map((c) => c.id)).toEqual(expect.arrayContaining([child1.id, child2.id]));
    store.close();
  });

  it('countChildTasks returns correct count', () => {
    const store = new SessionStore({ dbPath: ':memory:' });
    const sess = store.createSession({ principalId: 'p', agentId: 'a', mode: 'task' });
    const parent = store.createTask({ sessionId: sess.id, title: 'parent', ownerId: 'p' });
    expect(store.countChildTasks(parent.id)).toBe(0);
    store.createTask({ sessionId: sess.id, title: 'c1', ownerId: 'p', parentTaskId: parent.id });
    store.createTask({ sessionId: sess.id, title: 'c2', ownerId: 'p', parentTaskId: parent.id });
    expect(store.countChildTasks(parent.id)).toBe(2);
    store.close();
  });

  it('getDelegationTree returns undefined for unknown task', () => {
    const store = new SessionStore({ dbPath: ':memory:' });
    expect(store.getDelegationTree('no-such-id')).toBeUndefined();
    store.close();
  });

  it('getDelegationTree returns correct nested structure', () => {
    const store = new SessionStore({ dbPath: ':memory:' });
    const sess = store.createSession({ principalId: 'p', agentId: 'a', mode: 'task' });
    const root = store.createTask({ sessionId: sess.id, title: 'root', ownerId: 'p' });
    const child = store.createTask({ sessionId: sess.id, title: 'child', ownerId: 'p', parentTaskId: root.id });
    store.createTask({ sessionId: sess.id, title: 'gc', ownerId: 'p', parentTaskId: child.id });

    const tree = store.getDelegationTree(root.id)!;
    expect(tree.task.id).toBe(root.id);
    expect(tree.children).toHaveLength(1);
    expect(tree.children[0].task.id).toBe(child.id);
    expect(tree.children[0].children).toHaveLength(1);
    store.close();
  });

  it('getDelegationTree for a leaf node has empty children', () => {
    const store = new SessionStore({ dbPath: ':memory:' });
    const sess = store.createSession({ principalId: 'p', agentId: 'a', mode: 'task' });
    const task = store.createTask({ sessionId: sess.id, title: 'leaf', ownerId: 'p' });
    const tree = store.getDelegationTree(task.id)!;
    expect(tree.children).toHaveLength(0);
    store.close();
  });
});

// ---------------------------------------------------------------------------
// G. Constants are exported
// ---------------------------------------------------------------------------

describe('Constants', () => {
  it('MAX_CHILDREN_PER_TASK is exported and positive', () => {
    expect(typeof MAX_CHILDREN_PER_TASK).toBe('number');
    expect(MAX_CHILDREN_PER_TASK).toBeGreaterThan(0);
  });

  it('MAX_DELEGATION_DEPTH is still exported correctly', () => {
    expect(typeof MAX_DELEGATION_DEPTH).toBe('number');
    expect(MAX_DELEGATION_DEPTH).toBeGreaterThan(0);
  });
});
