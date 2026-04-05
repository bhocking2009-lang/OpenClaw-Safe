/**
 * Tests for the PolicyRuleStore and the policy editor API.
 */

import { PolicyRuleStore } from '../src/core/policy-store';
import { PolicyEngine, PolicyRule, DEFAULT_POLICY_RULES } from '../src/core/policy';
import { PolicyContext } from '../src/core/types';
import request from 'supertest';
import { Gateway } from '../src/core/gateway';
import { ToolBroker } from '../src/core/broker';
import { AuditLog } from '../src/core/audit';
import { SessionStore } from '../src/core/session';
import { ApprovalStore } from '../src/core/approval';
import { MemoryStore } from '../src/core/memory';

// ---------------------------------------------------------------------------
// PolicyRuleStore unit tests
// ---------------------------------------------------------------------------

describe('PolicyRuleStore', () => {
  let store: PolicyRuleStore;

  beforeEach(() => {
    store = new PolicyRuleStore({ dbPath: ':memory:' });
  });

  afterEach(() => store.close());

  const sampleRule: PolicyRule = {
    id: 'rule-test-1',
    description: 'Test rule',
    match: { trustLevels: ['high'] },
    effect: 'allow',
    allowedRuntimeTarget: 'sandbox',
    auditRequired: true,
  };

  it('inserts and retrieves a rule by id', () => {
    store.upsertRule(sampleRule);
    const fetched = store.getRule(sampleRule.id);
    expect(fetched).toBeDefined();
    expect(fetched!.id).toBe(sampleRule.id);
    expect(fetched!.effect).toBe('allow');
    expect(fetched!.match.trustLevels).toEqual(['high']);
  });

  it('updates an existing rule on re-upsert', () => {
    store.upsertRule(sampleRule);
    const updated = { ...sampleRule, description: 'Updated description', effect: 'deny' as const };
    store.upsertRule(updated);

    const fetched = store.getRule(sampleRule.id);
    expect(fetched!.description).toBe('Updated description');
    expect(fetched!.effect).toBe('deny');
  });

  it('listRules returns rules in order', () => {
    store.upsertRule({ ...sampleRule, id: 'r-50' }, 50);
    store.upsertRule({ ...sampleRule, id: 'r-10' }, 10);
    store.upsertRule({ ...sampleRule, id: 'r-30' }, 30);

    const rules = store.listRules();
    const ids = rules.map((r) => r.id);
    expect(ids.indexOf('r-10')).toBeLessThan(ids.indexOf('r-30'));
    expect(ids.indexOf('r-30')).toBeLessThan(ids.indexOf('r-50'));
  });

  it('deleteRule removes the rule and returns true', () => {
    store.upsertRule(sampleRule);
    const deleted = store.deleteRule(sampleRule.id);
    expect(deleted).toBe(true);
    expect(store.getRule(sampleRule.id)).toBeUndefined();
  });

  it('deleteRule returns false for non-existent id', () => {
    expect(store.deleteRule('no-such-rule')).toBe(false);
  });

  it('returns undefined for non-existent rule', () => {
    expect(store.getRule('ghost')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// PolicyEngine.setRules / getRules
// ---------------------------------------------------------------------------

describe('PolicyEngine dynamic rule update', () => {
  it('setRules replaces the active ruleset immediately', () => {
    const engine = new PolicyEngine();

    const ctx: PolicyContext = {
      principal: { id: 'p', type: 'user', identities: {}, trustLevel: 'high', policyGroup: 'default', createdAt: '' },
      session: { id: 's', principalId: 'p', agentId: 'a', mode: 'interactive', budget: 10000, elevationState: false, createdAt: '', updatedAt: '' },
      toolName: 'anything',
      toolRiskClass: 'A',
      runtimeTarget: 'sandbox',
      approvalState: 'pending',
    };

    // With default rules, Class A is allowed
    expect(engine.evaluate(ctx).mode).toBe('allow');

    // Replace with a deny-all ruleset
    engine.setRules([{
      id: 'deny-all',
      description: 'Deny everything',
      match: {},
      effect: 'deny',
      auditRequired: true,
    }]);

    expect(engine.evaluate(ctx).mode).toBe('deny');
  });

  it('getRules returns the current ruleset', () => {
    const engine = new PolicyEngine();
    const rules = engine.getRules();
    expect(rules.length).toBeGreaterThan(0);
    expect(rules[0].id).toBe(DEFAULT_POLICY_RULES[0].id);
  });

  it('getRules returns a copy (mutation does not affect engine)', () => {
    const engine = new PolicyEngine();
    const rules = engine.getRules();
    rules.length = 0; // clear the returned copy

    // Engine should still have its rules
    expect(engine.getRules().length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Policy editor API tests (via gateway)
// ---------------------------------------------------------------------------

type App = Parameters<typeof request>[0];

function buildGatewayWithPolicyStore() {
  const policyEngine = new PolicyEngine();
  const auditLog = new AuditLog({ dbPath: ':memory:' });
  const broker = new ToolBroker(policyEngine, auditLog);
  const sessionStore = new SessionStore({ dbPath: ':memory:' });
  const approvalStore = new ApprovalStore({ dbPath: ':memory:' });
  const memoryStore = new MemoryStore({ dbPath: ':memory:' });
  const policyRuleStore = new PolicyRuleStore({ dbPath: ':memory:' });
  const gateway = new Gateway(
    { host: '127.0.0.1', port: 0, dbPath: ':memory:', gatewaySecret: '' },
    { policyEngine, broker, auditLog, sessionStore, approvalStore, memoryStore, policyRuleStore }
  );
  return { gateway, policyEngine, auditLog, sessionStore, approvalStore, memoryStore, policyRuleStore };
}

describe('Policy editor API', () => {
  let app: App;
  let auditLog: AuditLog;
  let sessionStore: SessionStore;
  let approvalStore: ApprovalStore;
  let memoryStore: MemoryStore;
  let policyRuleStore: PolicyRuleStore;

  beforeEach(() => {
    const built = buildGatewayWithPolicyStore();
    app = built.gateway.getApp();
    auditLog = built.auditLog;
    sessionStore = built.sessionStore;
    approvalStore = built.approvalStore;
    memoryStore = built.memoryStore;
    policyRuleStore = built.policyRuleStore;
  });

  afterEach(() => {
    auditLog.close();
    sessionStore.close();
    approvalStore.close();
    memoryStore.close();
    policyRuleStore.close();
  });

  it('GET /v1/policy/rules returns the default ruleset', async () => {
    const res = await request(app).get('/v1/policy/rules');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.rules)).toBe(true);
  });

  it('POST /v1/policy/rules creates a new rule and live-updates the engine', async () => {
    const res = await request(app)
      .post('/v1/policy/rules')
      .send({
        id: 'custom-deny',
        description: 'Deny all medium-trust users',
        match: { trustLevels: ['medium'] },
        effect: 'deny',
        order: 5,
      });

    expect(res.status).toBe(201);
    expect(res.body.id).toBe('custom-deny');
    expect(res.body.effect).toBe('deny');

    // Rule should now be in the store
    const stored = policyRuleStore.getRule('custom-deny');
    expect(stored).toBeDefined();
  });

  it('POST /v1/policy/rules rejects missing id', async () => {
    const res = await request(app)
      .post('/v1/policy/rules')
      .send({ description: 'no id', effect: 'allow', match: {} });
    expect(res.status).toBe(400);
  });

  it('POST /v1/policy/rules rejects invalid effect', async () => {
    const res = await request(app)
      .post('/v1/policy/rules')
      .send({ id: 'x', description: 'd', effect: 'smash', match: {} });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/effect/i);
  });

  it('DELETE /v1/policy/rules/:id removes the rule', async () => {
    await request(app)
      .post('/v1/policy/rules')
      .send({ id: 'to-delete', description: 'temp', effect: 'deny', match: {} });

    const del = await request(app).delete('/v1/policy/rules/to-delete');
    expect(del.status).toBe(204);

    expect(policyRuleStore.getRule('to-delete')).toBeUndefined();
  });

  it('DELETE /v1/policy/rules/:id returns 404 for unknown rule', async () => {
    const res = await request(app).delete('/v1/policy/rules/no-such-rule');
    expect(res.status).toBe(404);
  });

  it('PUT /v1/policy/rules/reset restores the default ruleset', async () => {
    // First, replace with a deny-all rule
    await request(app)
      .post('/v1/policy/rules')
      .send({ id: 'deny-all', description: 'deny all', effect: 'deny', match: {} });

    // Then reset
    const res = await request(app).put('/v1/policy/rules/reset');
    expect(res.status).toBe(200);
    const ruleIds = res.body.rules.map((r: { id: string }) => r.id);
    expect(ruleIds).toContain('class-a-allow');
  });
});

// ---------------------------------------------------------------------------
// Child task delegation API tests
// ---------------------------------------------------------------------------

describe('Delegated child task API', () => {
  let app: App;
  let sessionStore: SessionStore;
  let auditLog: AuditLog;
  let approvalStore: ApprovalStore;
  let memoryStore: MemoryStore;

  beforeEach(() => {
    const policyEngine = new PolicyEngine();
    auditLog = new AuditLog({ dbPath: ':memory:' });
    const broker = new ToolBroker(policyEngine, auditLog);
    sessionStore = new SessionStore({ dbPath: ':memory:' });
    approvalStore = new ApprovalStore({ dbPath: ':memory:' });
    memoryStore = new MemoryStore({ dbPath: ':memory:' });
    const gateway = new Gateway(
      { host: '127.0.0.1', port: 0, dbPath: ':memory:', gatewaySecret: '' },
      { policyEngine, broker, auditLog, sessionStore, approvalStore, memoryStore }
    );
    app = gateway.getApp();
  });

  afterEach(() => {
    auditLog.close();
    sessionStore.close();
    approvalStore.close();
    memoryStore.close();
  });

  async function createParentTask(capabilitySet: string[]) {
    const principal = await request(app).post('/v1/auth/principals').send({ type: 'user', trustLevel: 'high' });
    const agent = await request(app).post('/v1/agents').send({});
    const session = await request(app)
      .post('/v1/sessions')
      .send({ principalId: principal.body.id, agentId: agent.body.id });
    const task = await request(app)
      .post('/v1/tasks')
      .send({ sessionId: session.body.id, title: 'parent task', ownerId: principal.body.id, capabilitySet });
    return task.body as { id: string; capabilitySet: string[] };
  }

  it('creates a child task with a subset of parent capabilities', async () => {
    const parent = await createParentTask(['file_read', 'file_write', 'run_tests']);

    const res = await request(app)
      .post(`/v1/tasks/${parent.id}/delegate`)
      .send({
        title: 'child task',
        requestedCapabilities: ['file_read'],
      });

    expect(res.status).toBe(201);
    expect(res.body.childTask.capabilitySet).toEqual(['file_read']);
    expect(res.body.childTask.parentTaskId).toBe(parent.id);
  });

  it('child task cannot have capabilities beyond parent (rejected with 400)', async () => {
    const parent = await createParentTask(['file_read']);

    const res = await request(app)
      .post(`/v1/tasks/${parent.id}/delegate`)
      .send({
        title: 'overprivileged child',
        requestedCapabilities: ['file_read', 'exec_host'], // exec_host not in parent
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/exec_host/);
  });

  it('child task with all parent capabilities is valid', async () => {
    const parent = await createParentTask(['file_read', 'file_write']);

    const res = await request(app)
      .post(`/v1/tasks/${parent.id}/delegate`)
      .send({
        title: 'full child',
        requestedCapabilities: ['file_read', 'file_write'],
      });

    expect(res.status).toBe(201);
    expect(res.body.childTask.capabilitySet).toEqual(
      expect.arrayContaining(['file_read', 'file_write'])
    );
  });

  it('child task with empty capabilities is valid', async () => {
    const parent = await createParentTask(['file_read', 'file_write']);

    const res = await request(app)
      .post(`/v1/tasks/${parent.id}/delegate`)
      .send({ title: 'empty child', requestedCapabilities: [] });

    expect(res.status).toBe(201);
    expect(res.body.childTask.capabilitySet).toEqual([]);
  });

  it('returns 404 for non-existent parent task', async () => {
    const res = await request(app)
      .post('/v1/tasks/no-such-task/delegate')
      .send({ title: 'orphan', requestedCapabilities: [] });

    expect(res.status).toBe(404);
  });

  it('requires title in delegation request', async () => {
    const parent = await createParentTask(['file_read']);

    const res = await request(app)
      .post(`/v1/tasks/${parent.id}/delegate`)
      .send({ requestedCapabilities: ['file_read'] }); // no title

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/title/i);
  });

  it('requires requestedCapabilities to be an array of strings', async () => {
    const parent = await createParentTask(['file_read']);

    const res = await request(app)
      .post(`/v1/tasks/${parent.id}/delegate`)
      .send({ title: 'bad', requestedCapabilities: 'file_read' }); // string, not array

    expect(res.status).toBe(400);
  });
});
