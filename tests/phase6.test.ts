/**
 * Phase 6 — Controlled Real-World Use tests.
 *
 * Covers:
 *   - Budget exhaustion enforcement (broker denies, audit event emitted)
 *   - Budget decrement after successful execution (tokensUsed)
 *   - Delegation depth exceeded audit event
 *   - Artifact filtering (by type, invocationId, provenanceId)
 *   - GET /sessions list endpoint
 *   - Export bundle budget fields (budgetRemaining, budgetExhaustedCount)
 *   - Replay manifest budgetExhaustedCount stat
 *   - Display layer shows budget.exhausted in Decisions section
 *   - Display stats header shows budget-exhausted count
 */

import request from 'supertest';
import { Gateway } from '../src/core/gateway';
import { PolicyEngine } from '../src/core/policy';
import { ToolBroker } from '../src/core/broker';
import { AuditLog } from '../src/core/audit';
import { SessionStore } from '../src/core/session';
import { ApprovalStore } from '../src/core/approval';
import { MemoryStore } from '../src/core/memory';
import { ArtifactStore } from '../src/core/artifacts';
import { buildReplayPack } from '../src/core/replay';
import { formatReplaySummary } from '../src/core/display';

type SuperTestApp = Parameters<typeof request>[0];

function buildGateway() {
  const policyEngine = new PolicyEngine();
  const auditLog = new AuditLog({ dbPath: ':memory:' });
  const sessionStore = new SessionStore({ dbPath: ':memory:' });
  const artifactStore = new ArtifactStore({ dbPath: ':memory:' });
  const broker = new ToolBroker(policyEngine, auditLog, undefined, artifactStore, sessionStore);
  const approvalStore = new ApprovalStore({ dbPath: ':memory:' });
  const memoryStore = new MemoryStore({ dbPath: ':memory:' });
  const gateway = new Gateway(
    { host: '127.0.0.1', port: 0, dbPath: ':memory:', gatewaySecret: '' },
    { policyEngine, broker, auditLog, sessionStore, approvalStore, memoryStore, artifactStore }
  );
  return { gateway, broker, auditLog, sessionStore, approvalStore, memoryStore, artifactStore };
}

function makePrincipal(app: SuperTestApp) {
  return request(app).post('/v1/auth/principals').send({
    type: 'user', trustLevel: 'high', policyGroup: 'default',
  });
}

function makeSession(app: SuperTestApp, principalId: string, budget = 100000) {
  return request(app).post('/v1/sessions').send({
    principalId, agentId: 'agent-1', mode: 'interactive', budget,
  });
}

describe('Phase 6 — Controlled Real-World Use', () => {
  let app: SuperTestApp;
  let auditLog: AuditLog;
  let sessionStore: SessionStore;
  let approvalStore: ApprovalStore;
  let memoryStore: MemoryStore;
  let artifactStore: ArtifactStore;

  beforeEach(() => {
    const built = buildGateway();
    app = built.gateway.getApp();
    auditLog = built.auditLog;
    sessionStore = built.sessionStore;
    approvalStore = built.approvalStore;
    memoryStore = built.memoryStore;
    artifactStore = built.artifactStore;
  });

  afterEach(() => {
    auditLog.close();
    sessionStore.close();
    approvalStore.close();
    memoryStore.close();
    artifactStore.close();
  });

  // ---------------------------------------------------------------------------
  // Budget exhaustion enforcement
  // ---------------------------------------------------------------------------

  describe('budget exhaustion enforcement', () => {
    it('broker emits budget.exhausted audit event when session budget is 0', () => {
      const policyEngine = new PolicyEngine();
      const testAuditLog = new AuditLog({ dbPath: ':memory:' });
      const testSessionStore = new SessionStore({ dbPath: ':memory:' });
      const broker = new ToolBroker(policyEngine, testAuditLog, undefined, undefined, testSessionStore);

      broker.registerTool({ name: 'file_read', description: 'Read a file', riskClass: 'A', defaultRuntimeTarget: 'sandbox', inputSchema: {}, concurrencySafe: true, idempotent: true, auditPayloadShape: {} });

      const session = testSessionStore.createSession({ principalId: 'p1', agentId: 'a1', budget: 0 });
      const principal = { id: 'p1', type: 'user' as const, trustLevel: 'high' as const, policyGroup: 'default', identities: {}, createdAt: new Date().toISOString() };

      return broker.dispatch(
        { id: 'inv-1', sessionId: session.id, taskId: 'task-1', principalId: 'p1', toolName: 'file_read', params: {} },
        { principal, session, toolName: 'file_read', toolRiskClass: 'A', runtimeTarget: 'sandbox', approvalState: 'pending' },
        { capabilitySet: ['file_read'], sandboxClass: 'workspace-read' }
      ).then((result) => {
        expect(result.denied).toBe(true);
        expect(result.policyDecision.reason).toMatch(/budget exhausted/i);

        const records = testAuditLog.queryBySession(session.id);
        const budgetEvent = records.find((r) => r.eventType === 'budget.exhausted');
        expect(budgetEvent).toBeDefined();
        expect(budgetEvent?.toolName).toBe('file_read');
        expect(budgetEvent?.budgetRemaining).toBe(0);
        testAuditLog.close();
        testSessionStore.close();
      });
    });

    it('broker does NOT emit budget.exhausted when budget > 0', () => {
      const policyEngine = new PolicyEngine();
      const testAuditLog = new AuditLog({ dbPath: ':memory:' });
      const testSessionStore = new SessionStore({ dbPath: ':memory:' });
      const broker = new ToolBroker(policyEngine, testAuditLog, undefined, undefined, testSessionStore);

      broker.registerTool({ name: 'file_read', description: 'Read a file', riskClass: 'A', defaultRuntimeTarget: 'sandbox', inputSchema: {}, concurrencySafe: true, idempotent: true, auditPayloadShape: {} });

      const session = testSessionStore.createSession({ principalId: 'p1', agentId: 'a1', budget: 1000 });
      const principal = { id: 'p1', type: 'user' as const, trustLevel: 'high' as const, policyGroup: 'default', identities: {}, createdAt: new Date().toISOString() };

      return broker.dispatch(
        { id: 'inv-2', sessionId: session.id, taskId: 'task-2', principalId: 'p1', toolName: 'file_read', params: {} },
        { principal, session, toolName: 'file_read', toolRiskClass: 'A', runtimeTarget: 'sandbox', approvalState: 'pending' },
        { capabilitySet: ['file_read'], sandboxClass: 'workspace-read' }
      ).then(() => {
        const records = testAuditLog.queryBySession(session.id);
        const budgetEvent = records.find((r) => r.eventType === 'budget.exhausted');
        expect(budgetEvent).toBeUndefined();
        testAuditLog.close();
        testSessionStore.close();
      });
    });

    it('budget.exhausted event is captured in replayPack manifest', () => {
      const testAuditLog = new AuditLog({ dbPath: ':memory:' });
      const testSessionStore = new SessionStore({ dbPath: ':memory:' });
      const session = testSessionStore.createSession({ principalId: 'p1', agentId: 'a1', budget: 0 });
      const t = new Date().toISOString();
      testAuditLog.write({ sessionId: session.id, principalId: 'p1', eventType: 'budget.exhausted', toolName: 'file_write', startedAt: t, budgetRemaining: 0 });

      const pack = buildReplayPack(session.id, testAuditLog);
      expect(pack.manifest.budgetExhaustedCount).toBe(1);
      testAuditLog.close();
      testSessionStore.close();
    });

    it('budgetExhaustedCount is 0 for session with no exhaustion events', () => {
      const testAuditLog = new AuditLog({ dbPath: ':memory:' });
      const testSessionStore = new SessionStore({ dbPath: ':memory:' });
      const session = testSessionStore.createSession({ principalId: 'p1', agentId: 'a1' });
      const t = new Date().toISOString();
      testAuditLog.write({ sessionId: session.id, principalId: 'p1', eventType: 'tool.finished', toolName: 'file_read', startedAt: t });

      const pack = buildReplayPack(session.id, testAuditLog);
      expect(pack.manifest.budgetExhaustedCount).toBe(0);
      testAuditLog.close();
      testSessionStore.close();
    });
  });

  // ---------------------------------------------------------------------------
  // Budget decrement after execution
  // ---------------------------------------------------------------------------

  describe('budget decrement via SessionStore.decrementBudget', () => {
    it('decrementBudget reduces session budget by the given amount', () => {
      const testSessionStore = new SessionStore({ dbPath: ':memory:' });
      const session = testSessionStore.createSession({ principalId: 'p1', agentId: 'a1', budget: 5000 });
      const updated = testSessionStore.decrementBudget(session.id, 1500);
      expect(updated?.budget).toBe(3500);
      testSessionStore.close();
    });

    it('decrementBudget does not go below zero', () => {
      const testSessionStore = new SessionStore({ dbPath: ':memory:' });
      const session = testSessionStore.createSession({ principalId: 'p1', agentId: 'a1', budget: 100 });
      const updated = testSessionStore.decrementBudget(session.id, 9999);
      expect(updated?.budget).toBe(0);
      testSessionStore.close();
    });

    it('decrementBudget returns undefined for unknown session', () => {
      const testSessionStore = new SessionStore({ dbPath: ':memory:' });
      const result = testSessionStore.decrementBudget('no-such-id', 100);
      expect(result).toBeUndefined();
      testSessionStore.close();
    });

    it('decrementBudget with amount 0 leaves budget unchanged', () => {
      const testSessionStore = new SessionStore({ dbPath: ':memory:' });
      const session = testSessionStore.createSession({ principalId: 'p1', agentId: 'a1', budget: 200 });
      const updated = testSessionStore.decrementBudget(session.id, 0);
      expect(updated?.budget).toBe(200);
      testSessionStore.close();
    });
  });

  // ---------------------------------------------------------------------------
  // Delegation depth exceeded audit event
  // ---------------------------------------------------------------------------

  describe('delegation.depth.exceeded audit event', () => {
    it('emits delegation.depth.exceeded audit event when depth limit is reached', async () => {
      const pRes = await makePrincipal(app);
      const sRes = await makeSession(app, pRes.body.id);
      const sessionId = sRes.body.id as string;

      // Create a task already at MAX_DELEGATION_DEPTH directly via sessionStore
      const deepTask = sessionStore.createTask({
        sessionId,
        title: 'Deep task',
        ownerId: pRes.body.id,
        capabilitySet: ['file_read'],
        sandboxClass: 'workspace-read',
        delegationDepth: 5, // MAX_DELEGATION_DEPTH
      });

      // Attempting to delegate from depth-5 task should fail
      const failRes = await request(app).post(`/v1/tasks/${deepTask.id}/delegate`).send({
        title: 'Too deep', requestedCapabilities: ['file_read'],
      });
      expect(failRes.status).toBe(400);
      expect(failRes.body.error).toMatch(/delegation depth/i);

      // Audit event should have been emitted
      const records = auditLog.queryBySession(sessionId);
      const depthEvent = records.find((r) => r.eventType === 'delegation.depth.exceeded');
      expect(depthEvent).toBeDefined();
      expect(depthEvent?.error).toMatch(/delegation depth/i);
    });

    it('delegation.depth.exceeded event appears in replay pack', async () => {
      const pRes = await makePrincipal(app);
      const sRes = await makeSession(app, pRes.body.id);
      const sessionId = sRes.body.id as string;

      const deepTask = sessionStore.createTask({
        sessionId, title: 'Deep', ownerId: pRes.body.id,
        capabilitySet: ['file_read'], sandboxClass: 'workspace-read',
        delegationDepth: 5,
      });

      await request(app).post(`/v1/tasks/${deepTask.id}/delegate`).send({ title: 'X', requestedCapabilities: ['file_read'] });

      const pack = buildReplayPack(sessionId, auditLog);
      const depthEvent = pack.auditRecords.find((r) => r.eventType === 'delegation.depth.exceeded');
      expect(depthEvent).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Artifact filtering
  // ---------------------------------------------------------------------------

  describe('artifact filtering on GET /v1/artifacts', () => {
    it('?type= filter returns only matching artifact types', async () => {
      artifactStore.store({ type: 'file', uri: '/a/b.txt', provenanceId: 'p1', checksum: 'c1' });
      artifactStore.store({ type: 'log', uri: '/a/c.log', provenanceId: 'p1', checksum: 'c2' });
      artifactStore.store({ type: 'file', uri: '/a/d.txt', provenanceId: 'p1', checksum: 'c3' });

      const res = await request(app).get('/v1/artifacts?type=file');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.artifacts)).toBe(true);
      expect(res.body.artifacts.every((a: { type: string }) => a.type === 'file')).toBe(true);
      expect(res.body.artifacts.length).toBe(2);
    });

    it('?type=log returns only log artifacts', async () => {
      artifactStore.store({ type: 'file', uri: '/x', provenanceId: 'p1', checksum: 'c1' });
      artifactStore.store({ type: 'log', uri: '/y', provenanceId: 'p1', checksum: 'c2' });

      const res = await request(app).get('/v1/artifacts?type=log');
      expect(res.body.artifacts.length).toBe(1);
      expect(res.body.artifacts[0].type).toBe('log');
    });

    it('?invocationId= returns artifacts for that invocation', async () => {
      artifactStore.store({ type: 'file', uri: '/a', provenanceId: 'p1', checksum: 'c1', invocationId: 'inv-aaa' });
      artifactStore.store({ type: 'file', uri: '/b', provenanceId: 'p1', checksum: 'c2', invocationId: 'inv-bbb' });

      const res = await request(app).get('/v1/artifacts?invocationId=inv-aaa');
      expect(res.body.artifacts.length).toBe(1);
      expect(res.body.artifacts[0].invocationId).toBe('inv-aaa');
    });

    it('?provenanceId= returns artifacts for that provenance', async () => {
      artifactStore.store({ type: 'file', uri: '/a', provenanceId: 'task-1', checksum: 'c1' });
      artifactStore.store({ type: 'file', uri: '/b', provenanceId: 'task-2', checksum: 'c2' });
      artifactStore.store({ type: 'file', uri: '/c', provenanceId: 'task-1', checksum: 'c3' });

      const res = await request(app).get('/v1/artifacts?provenanceId=task-1');
      expect(res.body.artifacts.length).toBe(2);
      expect(res.body.artifacts.every((a: { provenanceId: string }) => a.provenanceId === 'task-1')).toBe(true);
    });

    it('no filter returns all artifacts', async () => {
      artifactStore.store({ type: 'file', uri: '/a', provenanceId: 'p1', checksum: 'c1' });
      artifactStore.store({ type: 'log', uri: '/b', provenanceId: 'p2', checksum: 'c2' });

      const res = await request(app).get('/v1/artifacts');
      expect(res.body.artifacts.length).toBe(2);
    });

    it('ArtifactStore.listByType returns correct results', () => {
      artifactStore.store({ type: 'file', uri: '/a', provenanceId: 'p1', checksum: 'c1' });
      artifactStore.store({ type: 'screenshot', uri: '/b', provenanceId: 'p2', checksum: 'c2' });
      artifactStore.store({ type: 'file', uri: '/c', provenanceId: 'p3', checksum: 'c3' });

      const files = artifactStore.listByType('file');
      expect(files.length).toBe(2);
      expect(files.every((a) => a.type === 'file')).toBe(true);

      const snaps = artifactStore.listByType('screenshot');
      expect(snaps.length).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // GET /sessions list endpoint
  // ---------------------------------------------------------------------------

  describe('GET /v1/sessions', () => {
    it('returns 200 with a sessions array', async () => {
      const res = await request(app).get('/v1/sessions');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.sessions)).toBe(true);
    });

    it('returns empty array when no sessions exist', async () => {
      const res = await request(app).get('/v1/sessions');
      expect(res.body.sessions).toHaveLength(0);
    });

    it('returns all created sessions', async () => {
      const pRes = await makePrincipal(app);
      await makeSession(app, pRes.body.id);
      await makeSession(app, pRes.body.id);
      await makeSession(app, pRes.body.id);

      const res = await request(app).get('/v1/sessions');
      expect(res.body.sessions.length).toBe(3);
    });

    it('each session has expected fields', async () => {
      const pRes = await makePrincipal(app);
      await makeSession(app, pRes.body.id);

      const res = await request(app).get('/v1/sessions');
      const s = res.body.sessions[0];
      expect(s).toHaveProperty('id');
      expect(s).toHaveProperty('principalId');
      expect(s).toHaveProperty('budget');
      expect(s).toHaveProperty('mode');
      expect(s).toHaveProperty('createdAt');
    });

    it('SessionStore.listSessions returns all sessions', () => {
      sessionStore.createSession({ principalId: 'p1', agentId: 'a1' });
      sessionStore.createSession({ principalId: 'p2', agentId: 'a1' });
      const all = sessionStore.listSessions();
      expect(all.length).toBe(2);
    });
  });

  // ---------------------------------------------------------------------------
  // Export bundle budget fields
  // ---------------------------------------------------------------------------

  describe('export bundle budget fields', () => {
    it('export bundle contains budgetRemaining field', async () => {
      const pRes = await makePrincipal(app);
      const sRes = await makeSession(app, pRes.body.id, 5000);
      const res = await request(app).get(`/v1/sessions/${sRes.body.id}/export-bundle`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('budgetRemaining');
      expect(typeof res.body.budgetRemaining).toBe('number');
    });

    it('budgetRemaining matches session budget', async () => {
      const pRes = await makePrincipal(app);
      const sRes = await makeSession(app, pRes.body.id, 7777);
      const res = await request(app).get(`/v1/sessions/${sRes.body.id}/export-bundle`);
      expect(res.body.budgetRemaining).toBe(7777);
    });

    it('export bundle contains budgetExhaustedCount field', async () => {
      const pRes = await makePrincipal(app);
      const sRes = await makeSession(app, pRes.body.id);
      const res = await request(app).get(`/v1/sessions/${sRes.body.id}/export-bundle`);
      expect(res.body).toHaveProperty('budgetExhaustedCount');
      expect(typeof res.body.budgetExhaustedCount).toBe('number');
    });

    it('budgetExhaustedCount reflects actual exhaustion events', async () => {
      const pRes = await makePrincipal(app);
      const sRes = await makeSession(app, pRes.body.id);
      const sessionId = sRes.body.id as string;
      const t = new Date().toISOString();
      auditLog.write({ sessionId, principalId: pRes.body.id, eventType: 'budget.exhausted', startedAt: t, budgetRemaining: 0 });
      auditLog.write({ sessionId, principalId: pRes.body.id, eventType: 'budget.exhausted', startedAt: t, budgetRemaining: 0 });

      const res = await request(app).get(`/v1/sessions/${sessionId}/export-bundle`);
      expect(res.body.budgetExhaustedCount).toBe(2);
    });

    it('replayPack manifest has budgetExhaustedCount', async () => {
      const pRes = await makePrincipal(app);
      const sRes = await makeSession(app, pRes.body.id);
      const res = await request(app).get(`/v1/sessions/${sRes.body.id}/export-bundle`);
      expect(res.body.replayPack.manifest).toHaveProperty('budgetExhaustedCount');
    });
  });

  // ---------------------------------------------------------------------------
  // Display layer budget visibility
  // ---------------------------------------------------------------------------

  describe('display layer — budget events in Decisions section', () => {
    it('formatReplaySummary shows budget.exhausted in Decisions section', () => {
      const testAuditLog = new AuditLog({ dbPath: ':memory:' });
      const testSessionStore = new SessionStore({ dbPath: ':memory:' });
      const session = testSessionStore.createSession({ principalId: 'p1', agentId: 'a1', budget: 0 });
      const t = new Date().toISOString();
      testAuditLog.write({
        sessionId: session.id, principalId: 'p1', eventType: 'budget.exhausted',
        toolName: 'file_write', startedAt: t, budgetRemaining: 0,
      });

      const pack = buildReplayPack(session.id, testAuditLog);
      const text = formatReplaySummary(pack);

      expect(text).toContain('budget.exhausted');
      expect(text).toContain('file_write');
      testAuditLog.close();
      testSessionStore.close();
    });

    it('stats header shows budget-exhausted count', () => {
      const testAuditLog = new AuditLog({ dbPath: ':memory:' });
      const testSessionStore = new SessionStore({ dbPath: ':memory:' });
      const session = testSessionStore.createSession({ principalId: 'p1', agentId: 'a1', budget: 0 });
      const t = new Date().toISOString();
      testAuditLog.write({ sessionId: session.id, principalId: 'p1', eventType: 'budget.exhausted', startedAt: t });

      const pack = buildReplayPack(session.id, testAuditLog);
      const text = formatReplaySummary(pack);

      expect(text).toContain('1 budget-exhausted event');
      testAuditLog.close();
      testSessionStore.close();
    });

    it('formatReplaySummary shows 💰 icon for budget.exhausted events', () => {
      const testAuditLog = new AuditLog({ dbPath: ':memory:' });
      const testSessionStore = new SessionStore({ dbPath: ':memory:' });
      const session = testSessionStore.createSession({ principalId: 'p1', agentId: 'a1', budget: 0 });
      const t = new Date().toISOString();
      testAuditLog.write({ sessionId: session.id, principalId: 'p1', eventType: 'budget.exhausted', startedAt: t, budgetRemaining: 0 });

      const pack = buildReplayPack(session.id, testAuditLog);
      const text = formatReplaySummary(pack);
      expect(text).toContain('💰');
      testAuditLog.close();
      testSessionStore.close();
    });

    it('formatReplaySummary shows budgetRemaining when present', () => {
      const testAuditLog = new AuditLog({ dbPath: ':memory:' });
      const testSessionStore = new SessionStore({ dbPath: ':memory:' });
      const session = testSessionStore.createSession({ principalId: 'p1', agentId: 'a1', budget: 0 });
      const t = new Date().toISOString();
      testAuditLog.write({ sessionId: session.id, principalId: 'p1', eventType: 'budget.exhausted', startedAt: t, budgetRemaining: 0 });

      const pack = buildReplayPack(session.id, testAuditLog);
      const text = formatReplaySummary(pack);
      expect(text).toContain('remaining=0');
      testAuditLog.close();
      testSessionStore.close();
    });

    it('formatReplaySummary shows delegation.depth.exceeded with 🚫 icon', () => {
      const testAuditLog = new AuditLog({ dbPath: ':memory:' });
      const testSessionStore = new SessionStore({ dbPath: ':memory:' });
      const session = testSessionStore.createSession({ principalId: 'p1', agentId: 'a1' });
      const t = new Date().toISOString();
      testAuditLog.write({
        sessionId: session.id, principalId: 'p1', eventType: 'delegation.depth.exceeded',
        startedAt: t, error: 'Maximum delegation depth exceeded',
      });

      const pack = buildReplayPack(session.id, testAuditLog);
      const text = formatReplaySummary(pack);
      expect(text).toContain('delegation.depth.exceeded');
      expect(text).toContain('🚫');
      testAuditLog.close();
      testSessionStore.close();
    });

    it('formatReplaySummary shows 0 budget-exhausted events when none occurred', () => {
      const testAuditLog = new AuditLog({ dbPath: ':memory:' });
      const testSessionStore = new SessionStore({ dbPath: ':memory:' });
      const session = testSessionStore.createSession({ principalId: 'p1', agentId: 'a1' });
      const t = new Date().toISOString();
      testAuditLog.write({ sessionId: session.id, principalId: 'p1', eventType: 'tool.finished', toolName: 'file_read', startedAt: t });

      const pack = buildReplayPack(session.id, testAuditLog);
      const text = formatReplaySummary(pack);
      expect(text).toContain('0 budget-exhausted event');
      testAuditLog.close();
      testSessionStore.close();
    });
  });
});
