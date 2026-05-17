/**
 * Tests for the PolicyRuleStore, validatePolicyRule, export/import,
 * the policy editor API, and the delegated child task API.
 */

import { PolicyRuleStore, validatePolicyRule } from '../src/core/policy-store';
import { PolicyEngine, PolicyRule, DEFAULT_POLICY_RULES } from '../src/core/policy';
import { PolicyContext } from '../src/core/types';
import request from 'supertest';
import { Gateway, MAX_DELEGATION_DEPTH } from '../src/core/gateway';
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

  // Export / import
  it('exportRules returns a versioned snapshot with all rules', () => {
    store.upsertRule({ ...sampleRule, id: 'r-a' }, 10);
    store.upsertRule({ ...sampleRule, id: 'r-b' }, 20);
    const exported = store.exportRules();
    expect(exported.version).toBe('1');
    expect(exported.exportedAt).toBeTruthy();
    const ids = exported.rules.map((r) => r.id);
    expect(ids).toContain('r-a');
    expect(ids).toContain('r-b');
    expect(exported.rules[0].order).toBeDefined();
  });

  it('exportRules round-trips through importRules (replace mode)', () => {
    store.upsertRule({ ...sampleRule, id: 'orig-a' }, 10);
    store.upsertRule({ ...sampleRule, id: 'orig-b' }, 20);
    const snapshot = store.exportRules();

    // Wipe store and import
    const fresh = new PolicyRuleStore({ dbPath: ':memory:' });
    fresh.importRules(snapshot, false);
    const imported = fresh.listRules().map((r) => r.id);
    expect(imported).toContain('orig-a');
    expect(imported).toContain('orig-b');
    fresh.close();
  });

  it('importRules merge=true preserves existing rules not in the snapshot', () => {
    store.upsertRule({ ...sampleRule, id: 'keeper' }, 5);
    const snapshot = store.exportRules();
    // Add extra rule to snapshot
    snapshot.rules.push({ ...sampleRule, id: 'newcomer', order: 50 });

    const fresh = new PolicyRuleStore({ dbPath: ':memory:' });
    fresh.upsertRule({ ...sampleRule, id: 'pre-existing' }, 1);
    fresh.importRules(snapshot, true);
    const ids = fresh.listRules().map((r) => r.id);
    expect(ids).toContain('keeper');
    expect(ids).toContain('newcomer');
    expect(ids).toContain('pre-existing'); // survived merge
    fresh.close();
  });

  it('importRules throws on unsupported version', () => {
    expect(() =>
      store.importRules({ version: '2' as '1', exportedAt: '', rules: [] }, false)
    ).toThrow(/unsupported/i);
  });
});

// ---------------------------------------------------------------------------
// validatePolicyRule
// ---------------------------------------------------------------------------

describe('validatePolicyRule', () => {
  const validRule: PolicyRule = {
    id: 'v-rule',
    description: 'Valid rule',
    match: { riskClasses: ['A', 'B'], trustLevels: ['high'] },
    effect: 'allow',
    allowedRuntimeTarget: 'sandbox',
    auditRequired: true,
  };

  it('returns empty array for a valid rule', () => {
    expect(validatePolicyRule(validRule)).toHaveLength(0);
  });

  it('reports error for missing id', () => {
    const errs = validatePolicyRule({ ...validRule, id: '' });
    expect(errs.some((e) => e.field === 'id')).toBe(true);
  });

  it('reports error for missing description', () => {
    const errs = validatePolicyRule({ ...validRule, description: '  ' });
    expect(errs.some((e) => e.field === 'description')).toBe(true);
  });

  it('reports error for invalid effect', () => {
    const errs = validatePolicyRule({ ...validRule, effect: 'superpower' as PolicyRule['effect'] });
    expect(errs.some((e) => e.field === 'effect')).toBe(true);
  });

  it('reports error for invalid allowedRuntimeTarget', () => {
    const errs = validatePolicyRule({ ...validRule, allowedRuntimeTarget: 'magic' as PolicyRule['allowedRuntimeTarget'] });
    expect(errs.some((e) => e.field === 'allowedRuntimeTarget')).toBe(true);
  });

  it('reports error for unknown riskClass in match', () => {
    const errs = validatePolicyRule({ ...validRule, match: { riskClasses: ['Z' as 'A'] } });
    expect(errs.some((e) => e.field === 'match.riskClasses')).toBe(true);
  });

  it('reports error for unknown trustLevel in match', () => {
    const errs = validatePolicyRule({ ...validRule, match: { trustLevels: ['ultralow' as 'low'] } });
    expect(errs.some((e) => e.field === 'match.trustLevels')).toBe(true);
  });

  it('allows empty match (catch-all rule is valid)', () => {
    expect(validatePolicyRule({ ...validRule, match: {} })).toHaveLength(0);
  });

  it('can return multiple errors at once', () => {
    const errs = validatePolicyRule({ id: '', description: '', effect: 'bad' as PolicyRule['effect'], match: {}, auditRequired: true });
    expect(errs.length).toBeGreaterThanOrEqual(3);
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

  it('POST /v1/policy/rules rejects invalid effect (returns structured errors)', async () => {
    const res = await request(app)
      .post('/v1/policy/rules')
      .send({ id: 'x', description: 'd', effect: 'smash', match: {} });
    expect(res.status).toBe(400);
    // New: returns structured errors array
    expect(Array.isArray(res.body.errors)).toBe(true);
    expect(res.body.errors.some((e: { field: string }) => e.field === 'effect')).toBe(true);
  });

  it('POST /v1/policy/rules rejects invalid riskClass in match', async () => {
    const res = await request(app)
      .post('/v1/policy/rules')
      .send({ id: 'r', description: 'd', effect: 'allow', match: { riskClasses: ['Z'] } });
    expect(res.status).toBe(400);
    expect(res.body.errors.some((e: { field: string }) => e.field === 'match.riskClasses')).toBe(true);
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

  // Export / import API
  it('GET /v1/policy/rules/export returns a versioned snapshot', async () => {
    const res = await request(app).get('/v1/policy/rules/export');
    expect(res.status).toBe(200);
    expect(res.body.version).toBe('1');
    expect(res.body.exportedAt).toBeTruthy();
    expect(Array.isArray(res.body.rules)).toBe(true);
  });

  it('POST /v1/policy/rules/import round-trips a snapshot (replace)', async () => {
    // Export current rules
    const exportRes = await request(app).get('/v1/policy/rules/export');
    const snapshot = exportRes.body;

    // Add a rule
    await request(app).post('/v1/policy/rules')
      .send({ id: 'temp-rule', description: 'temp', effect: 'deny', match: {} });

    // Import original snapshot (replace mode)
    const importRes = await request(app).post('/v1/policy/rules/import').send({ ...snapshot, merge: false });
    expect(importRes.status).toBe(200);
    expect(importRes.body.imported).toBe(snapshot.rules.length);

    // temp-rule should be gone
    expect(policyRuleStore.getRule('temp-rule')).toBeUndefined();
  });

  it('POST /v1/policy/rules/import rejects wrong version', async () => {
    const res = await request(app).post('/v1/policy/rules/import').send({ version: '99', rules: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/version/i);
  });

  it('POST /v1/policy/rules/import rejects rules failing validation', async () => {
    const res = await request(app).post('/v1/policy/rules/import').send({
      version: '1',
      rules: [{ id: '', description: '', effect: 'bad', match: {} }],
    });
    expect(res.status).toBe(400);
    expect(res.body.details).toBeDefined();
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
    return task.body as { id: string; capabilitySet: string[]; delegationDepth: number };
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

  // --- Delegation depth ---

  it('child task delegationDepth is parent.delegationDepth + 1', async () => {
    const parent = await createParentTask(['file_read']);
    expect(parent.delegationDepth).toBe(0); // root task

    const childRes = await request(app)
      .post(`/v1/tasks/${parent.id}/delegate`)
      .send({ title: 'child', requestedCapabilities: [] });
    expect(childRes.status).toBe(201);
    expect(childRes.body.childTask.delegationDepth).toBe(1);
  });

  it('grandchild task has delegationDepth 2', async () => {
    const parent = await createParentTask(['file_read']);
    const childRes = await request(app)
      .post(`/v1/tasks/${parent.id}/delegate`)
      .send({ title: 'child', requestedCapabilities: [] });
    const childId = childRes.body.childTask.id as string;

    const grandchildRes = await request(app)
      .post(`/v1/tasks/${childId}/delegate`)
      .send({ title: 'grandchild', requestedCapabilities: [] });
    expect(grandchildRes.status).toBe(201);
    expect(grandchildRes.body.childTask.delegationDepth).toBe(2);
  });

  it(`rejects delegation when depth would exceed MAX_DELEGATION_DEPTH (${MAX_DELEGATION_DEPTH})`, async () => {
    // Build a chain of MAX_DELEGATION_DEPTH tasks
    const parent = await createParentTask(['file_read']);
    let currentId = parent.id;
    for (let i = 0; i < MAX_DELEGATION_DEPTH; i++) {
      const res = await request(app)
        .post(`/v1/tasks/${currentId}/delegate`)
        .send({ title: `depth-${i + 1}`, requestedCapabilities: [] });
      expect(res.status).toBe(201);
      currentId = res.body.childTask.id as string;
    }

    // One more level should be rejected
    const overRes = await request(app)
      .post(`/v1/tasks/${currentId}/delegate`)
      .send({ title: 'too-deep', requestedCapabilities: [] });
    expect(overRes.status).toBe(400);
    expect(overRes.body.error).toMatch(/depth/i);
  });

  // --- Budget cap ---

  it('child task budgetCap is stored and returned', async () => {
    const parent = await createParentTask(['file_read']);
    const res = await request(app)
      .post(`/v1/tasks/${parent.id}/delegate`)
      .send({ title: 'capped child', requestedCapabilities: [], budgetCap: 5000 });
    expect(res.status).toBe(201);
    expect(res.body.childTask.budgetCap).toBe(5000);
  });

  it('rejects non-positive budgetCap', async () => {
    const parent = await createParentTask(['file_read']);
    const res = await request(app)
      .post(`/v1/tasks/${parent.id}/delegate`)
      .send({ title: 'bad-budget', requestedCapabilities: [], budgetCap: -100 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/budgetCap/i);
  });

  it('rejects zero budgetCap', async () => {
    const parent = await createParentTask(['file_read']);
    const res = await request(app)
      .post(`/v1/tasks/${parent.id}/delegate`)
      .send({ title: 'zero-budget', requestedCapabilities: [], budgetCap: 0 });
    expect(res.status).toBe(400);
  });

  it('child task without budgetCap has no cap (unrestricted within session budget)', async () => {
    const parent = await createParentTask(['file_read']);
    const res = await request(app)
      .post(`/v1/tasks/${parent.id}/delegate`)
      .send({ title: 'uncapped', requestedCapabilities: [] });
    expect(res.status).toBe(201);
    expect(res.body.childTask.budgetCap).toBeUndefined();
  });
});


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
