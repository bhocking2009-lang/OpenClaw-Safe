/**
 * Phase 5 — Operator Interface tests.
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

type SuperTestApp = Parameters<typeof request>[0];

function buildGateway() {
  const policyEngine = new PolicyEngine();
  const auditLog = new AuditLog({ dbPath: ':memory:' });
  const broker = new ToolBroker(policyEngine, auditLog);
  const sessionStore = new SessionStore({ dbPath: ':memory:' });
  const approvalStore = new ApprovalStore({ dbPath: ':memory:' });
  const memoryStore = new MemoryStore({ dbPath: ':memory:' });
  const artifactStore = new ArtifactStore({ dbPath: ':memory:' });
  const gateway = new Gateway(
    { host: '127.0.0.1', port: 0, dbPath: ':memory:', gatewaySecret: '' },
    { policyEngine, broker, auditLog, sessionStore, approvalStore, memoryStore, artifactStore }
  );
  return { gateway, auditLog, sessionStore, approvalStore, memoryStore, artifactStore };
}

function makePrincipal(app: SuperTestApp) {
  return request(app).post('/v1/auth/principals').send({
    type: 'user', trustLevel: 'high', policyGroup: 'default',
  });
}

function makeSession(app: SuperTestApp, principalId: string) {
  return request(app).post('/v1/sessions').send({
    principalId, agentId: 'agent-1', mode: 'interactive', budget: 100000,
  });
}

describe('Phase 5 Operator Interface', () => {
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

  async function setupSession() {
    const pRes = await makePrincipal(app);
    const principalId = pRes.body.id as string;
    const sRes = await makeSession(app, principalId);
    const sessionId = sRes.body.id as string;
    const t = new Date().toISOString();
    auditLog.write({ sessionId, taskId: 'task-a', principalId, eventType: 'tool.started', toolName: 'file_write', startedAt: t });
    auditLog.write({ sessionId, taskId: 'task-a', principalId, eventType: 'tool.finished', toolName: 'file_write', startedAt: t });
    auditLog.write({
      sessionId, principalId, eventType: 'tool.denied', toolName: 'host_exec', startedAt: t,
      policyDecision: { mode: 'deny', reason: 'low trust', requiresApproval: false, auditRequired: true, matchedRuleId: 'low-trust-deny-non-readonly' },
    });
    return { principalId, sessionId };
  }

  // ---------------------------------------------------------------------------
  // GET /sessions/:id/replay-summary
  // ---------------------------------------------------------------------------

  describe('GET /v1/sessions/:id/replay-summary', () => {
    it('returns 404 for unknown session', async () => {
      const res = await request(app).get('/v1/sessions/no-such-session/replay-summary');
      expect(res.status).toBe(404);
    });

    it('returns 200 with text/plain', async () => {
      const { sessionId } = await setupSession();
      const res = await request(app).get(`/v1/sessions/${sessionId}/replay-summary`);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/plain/);
    });

    it('response body contains the session ID', async () => {
      const { sessionId } = await setupSession();
      const res = await request(app).get(`/v1/sessions/${sessionId}/replay-summary`);
      expect(res.text).toContain(sessionId);
    });

    it('response contains all four section headers', async () => {
      const { sessionId } = await setupSession();
      const res = await request(app).get(`/v1/sessions/${sessionId}/replay-summary`);
      expect(res.text).toContain('Decisions');
      expect(res.text).toContain('Approvals');
      expect(res.text).toContain('Executions');
      expect(res.text).toContain('Artifacts');
    });

    it('shows denial in Decisions section', async () => {
      const { sessionId } = await setupSession();
      const res = await request(app).get(`/v1/sessions/${sessionId}/replay-summary`);
      expect(res.text).toContain('low trust');
      expect(res.text).toContain('low-trust-deny-non-readonly');
    });

    it('shows tool execution in Executions section', async () => {
      const { sessionId } = await setupSession();
      const res = await request(app).get(`/v1/sessions/${sessionId}/replay-summary`);
      expect(res.text).toContain('file_write');
      expect(res.text).toContain('success');
    });

    it('sets Content-Disposition attachment header', async () => {
      const { sessionId } = await setupSession();
      const res = await request(app).get(`/v1/sessions/${sessionId}/replay-summary`);
      expect(res.headers['content-disposition']).toMatch(/attachment/);
    });

    it('sets X-Content-Type-Options nosniff', async () => {
      const { sessionId } = await setupSession();
      const res = await request(app).get(`/v1/sessions/${sessionId}/replay-summary`);
      expect(res.headers['x-content-type-options']).toBe('nosniff');
    });

    it('shows no artifacts placeholder when no artifacts exist', async () => {
      const { sessionId } = await setupSession();
      const res = await request(app).get(`/v1/sessions/${sessionId}/replay-summary`);
      expect(res.text).toContain('no artifacts in this session');
    });

    it('stats show 1 execution and 1 denial', async () => {
      const { sessionId } = await setupSession();
      const res = await request(app).get(`/v1/sessions/${sessionId}/replay-summary`);
      expect(res.text).toContain('1 execution');
      expect(res.text).toContain('1 denial');
    });
  });

  // ---------------------------------------------------------------------------
  // POST /sessions/diff
  // ---------------------------------------------------------------------------

  describe('POST /v1/sessions/diff', () => {
    it('returns 400 when sessionA missing', async () => {
      const { sessionId } = await setupSession();
      const res = await request(app).post('/v1/sessions/diff').send({ sessionB: sessionId });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/sessionA/);
    });

    it('returns 400 when sessionB missing', async () => {
      const { sessionId } = await setupSession();
      const res = await request(app).post('/v1/sessions/diff').send({ sessionA: sessionId });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/sessionB/);
    });

    it('returns 404 when sessionA not found', async () => {
      const { sessionId } = await setupSession();
      const res = await request(app).post('/v1/sessions/diff').send({ sessionA: 'no-such', sessionB: sessionId });
      expect(res.status).toBe(404);
    });

    it('returns 404 when sessionB not found', async () => {
      const { sessionId } = await setupSession();
      const res = await request(app).post('/v1/sessions/diff').send({ sessionA: sessionId, sessionB: 'no-such' });
      expect(res.status).toBe(404);
    });

    it('returns 200 JSON diff with required fields', async () => {
      const { sessionId: s1 } = await setupSession();
      const pRes = await makePrincipal(app);
      const s2 = (await makeSession(app, pRes.body.id)).body.id as string;
      const res = await request(app).post('/v1/sessions/diff').send({ sessionA: s1, sessionB: s2 });
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('sessionA', s1);
      expect(res.body).toHaveProperty('sessionB', s2);
      expect(res.body).toHaveProperty('identical');
      expect(res.body).toHaveProperty('onlyInA');
      expect(res.body).toHaveProperty('onlyInB');
      expect(res.body).toHaveProperty('changed');
    });

    it('onlyInA lists events in A but not B', async () => {
      const { sessionId: s1 } = await setupSession();
      const pRes = await makePrincipal(app);
      const s2 = (await makeSession(app, pRes.body.id)).body.id as string;
      const res = await request(app).post('/v1/sessions/diff').send({ sessionA: s1, sessionB: s2 });
      expect(res.body.onlyInA.length).toBeGreaterThan(0);
      expect(res.body.identical).toBe(false);
    });

    it('two empty sessions are identical', async () => {
      const pRes = await makePrincipal(app);
      const s1 = (await makeSession(app, pRes.body.id)).body.id as string;
      const s2 = (await makeSession(app, pRes.body.id)).body.id as string;
      const res = await request(app).post('/v1/sessions/diff').send({ sessionA: s1, sessionB: s2 });
      expect(res.body.identical).toBe(true);
    });

    it('format=text returns text/plain with Replay Diff header', async () => {
      const { sessionId: s1 } = await setupSession();
      const pRes = await makePrincipal(app);
      const s2 = (await makeSession(app, pRes.body.id)).body.id as string;
      const res = await request(app).post('/v1/sessions/diff').send({ sessionA: s1, sessionB: s2, format: 'text' });
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/plain/);
      expect(res.text).toContain('Replay Diff');
    });

    it('text diff contains both session IDs', async () => {
      const { sessionId: s1 } = await setupSession();
      const pRes = await makePrincipal(app);
      const s2 = (await makeSession(app, pRes.body.id)).body.id as string;
      const res = await request(app).post('/v1/sessions/diff').send({ sessionA: s1, sessionB: s2, format: 'text' });
      expect(res.text).toContain(s1);
      expect(res.text).toContain(s2);
    });

    it('text diff shows Only in A section', async () => {
      const { sessionId: s1 } = await setupSession();
      const pRes = await makePrincipal(app);
      const s2 = (await makeSession(app, pRes.body.id)).body.id as string;
      const res = await request(app).post('/v1/sessions/diff').send({ sessionA: s1, sessionB: s2, format: 'text' });
      expect(res.text).toContain('Only in A');
    });

    it('text diff sets Content-Disposition attachment', async () => {
      const { sessionId: s1 } = await setupSession();
      const pRes = await makePrincipal(app);
      const s2 = (await makeSession(app, pRes.body.id)).body.id as string;
      const res = await request(app).post('/v1/sessions/diff').send({ sessionA: s1, sessionB: s2, format: 'text' });
      expect(res.headers['content-disposition']).toMatch(/attachment/);
    });
  });

  // ---------------------------------------------------------------------------
  // GET /sessions/:id/audit-integrity?format=text
  // ---------------------------------------------------------------------------

  describe('GET /v1/sessions/:id/audit-integrity?format=text', () => {
    it('returns text/plain with Audit Integrity Report header', async () => {
      const { sessionId } = await setupSession();
      const res = await request(app).get(`/v1/sessions/${sessionId}/audit-integrity?format=text`);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/plain/);
      expect(res.text).toContain('Audit Integrity Report');
    });

    it('JSON format (default) still returns JSON', async () => {
      const { sessionId } = await setupSession();
      const res = await request(app).get(`/v1/sessions/${sessionId}/audit-integrity`);
      expect(res.headers['content-type']).toMatch(/json/);
      expect(res.body).toHaveProperty('valid');
    });

    it('text format sets Content-Disposition attachment', async () => {
      const { sessionId } = await setupSession();
      const res = await request(app).get(`/v1/sessions/${sessionId}/audit-integrity?format=text`);
      expect(res.headers['content-disposition']).toMatch(/attachment/);
    });

    it('text shows Lifecycle Errors for session with unmatched start', async () => {
      const pRes = await makePrincipal(app);
      const sRes = await makeSession(app, pRes.body.id);
      const sessionId = sRes.body.id as string;
      auditLog.write({ sessionId, taskId: 'x', principalId: pRes.body.id, eventType: 'tool.started', toolName: 'build', startedAt: new Date().toISOString() });
      const res = await request(app).get(`/v1/sessions/${sessionId}/audit-integrity?format=text`);
      expect(res.text).toContain('Lifecycle Errors');
    });

    it('text shows Policy Gaps for denial without policyDecision', async () => {
      const pRes = await makePrincipal(app);
      const sRes = await makeSession(app, pRes.body.id);
      const sessionId = sRes.body.id as string;
      auditLog.write({ sessionId, principalId: pRes.body.id, eventType: 'tool.denied', toolName: 'x', startedAt: new Date().toISOString() });
      const res = await request(app).get(`/v1/sessions/${sessionId}/audit-integrity?format=text`);
      expect(res.text).toContain('Policy Gaps');
    });
  });

  // ---------------------------------------------------------------------------
  // POST /policy/explain?format=text
  // ---------------------------------------------------------------------------

  describe('POST /v1/policy/explain?format=text', () => {
    it('returns text/plain with Policy Explanation header', async () => {
      const pRes = await makePrincipal(app);
      const sRes = await makeSession(app, pRes.body.id);
      const res = await request(app)
        .post('/v1/policy/explain?format=text')
        .send({ principalId: pRes.body.id, sessionId: sRes.body.id, toolName: 'file_read', toolRiskClass: 'A' });
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/plain/);
      expect(res.text).toContain('Policy Explanation');
    });

    it('shows ALLOW for Class A high-trust', async () => {
      const pRes = await makePrincipal(app);
      const sRes = await makeSession(app, pRes.body.id);
      const res = await request(app)
        .post('/v1/policy/explain?format=text')
        .send({ principalId: pRes.body.id, sessionId: sRes.body.id, toolName: 'file_read', toolRiskClass: 'A' });
      expect(res.text).toContain('ALLOW');
    });

    it('shows matched rule ID in output', async () => {
      const pRes = await makePrincipal(app);
      const sRes = await makeSession(app, pRes.body.id);
      const res = await request(app)
        .post('/v1/policy/explain?format=text')
        .send({ principalId: pRes.body.id, sessionId: sRes.body.id, toolName: 'file_read', toolRiskClass: 'A' });
      expect(res.text).toContain('class-a-allow');
    });

    it('shows Rule Evaluation Trace section', async () => {
      const pRes = await makePrincipal(app);
      const sRes = await makeSession(app, pRes.body.id);
      const res = await request(app)
        .post('/v1/policy/explain?format=text')
        .send({ principalId: pRes.body.id, sessionId: sRes.body.id, toolName: 'file_read', toolRiskClass: 'A' });
      expect(res.text).toContain('Rule Evaluation Trace');
    });

    it('shows MATCHED marker for matched rule', async () => {
      const pRes = await makePrincipal(app);
      const sRes = await makeSession(app, pRes.body.id);
      const res = await request(app)
        .post('/v1/policy/explain?format=text')
        .send({ principalId: pRes.body.id, sessionId: sRes.body.id, toolName: 'code_exec', toolRiskClass: 'C' });
      expect(res.text).toContain('MATCHED');
    });

    it('sets Content-Disposition attachment', async () => {
      const pRes = await makePrincipal(app);
      const sRes = await makeSession(app, pRes.body.id);
      const res = await request(app)
        .post('/v1/policy/explain?format=text')
        .send({ principalId: pRes.body.id, sessionId: sRes.body.id, toolName: 'file_read', toolRiskClass: 'A' });
      expect(res.headers['content-disposition']).toMatch(/attachment/);
    });

    it('JSON format (default) still returns JSON decision', async () => {
      const pRes = await makePrincipal(app);
      const sRes = await makeSession(app, pRes.body.id);
      const res = await request(app)
        .post('/v1/policy/explain')
        .send({ principalId: pRes.body.id, sessionId: sRes.body.id, toolName: 'file_read', toolRiskClass: 'A' });
      expect(res.headers['content-type']).toMatch(/json/);
      expect(res.body).toHaveProperty('mode');
      expect(res.body).toHaveProperty('evaluationTrace');
    });
  });

  // ---------------------------------------------------------------------------
  // GET /sessions/:id/export-bundle
  // ---------------------------------------------------------------------------

  describe('GET /v1/sessions/:id/export-bundle', () => {
    it('returns 404 for unknown session', async () => {
      const res = await request(app).get('/v1/sessions/no-such/export-bundle');
      expect(res.status).toBe(404);
    });

    it('returns 200 JSON with all required top-level fields', async () => {
      const { sessionId } = await setupSession();
      const res = await request(app).get(`/v1/sessions/${sessionId}/export-bundle`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('sessionId');
      expect(res.body).toHaveProperty('exportedAt');
      expect(res.body).toHaveProperty('replayPack');
      expect(res.body).toHaveProperty('summary');
      expect(res.body).toHaveProperty('integrityReport');
      expect(res.body).toHaveProperty('integrityReportText');
      expect(res.body).toHaveProperty('artifactManifest');
    });

    it('sessionId field matches requested session', async () => {
      const { sessionId } = await setupSession();
      const res = await request(app).get(`/v1/sessions/${sessionId}/export-bundle`);
      expect(res.body.sessionId).toBe(sessionId);
    });

    it('replayPack has manifest, auditRecords, artifacts', async () => {
      const { sessionId } = await setupSession();
      const res = await request(app).get(`/v1/sessions/${sessionId}/export-bundle`);
      expect(res.body.replayPack).toHaveProperty('manifest');
      expect(res.body.replayPack).toHaveProperty('auditRecords');
      expect(res.body.replayPack).toHaveProperty('artifacts');
    });

    it('summary text contains the session ID', async () => {
      const { sessionId } = await setupSession();
      const res = await request(app).get(`/v1/sessions/${sessionId}/export-bundle`);
      expect(typeof res.body.summary).toBe('string');
      expect(res.body.summary).toContain(sessionId);
    });

    it('summary text contains the four section headers', async () => {
      const { sessionId } = await setupSession();
      const res = await request(app).get(`/v1/sessions/${sessionId}/export-bundle`);
      expect(res.body.summary).toContain('Decisions');
      expect(res.body.summary).toContain('Approvals');
      expect(res.body.summary).toContain('Executions');
      expect(res.body.summary).toContain('Artifacts');
    });

    it('integrityReport has valid and violations fields', async () => {
      const { sessionId } = await setupSession();
      const res = await request(app).get(`/v1/sessions/${sessionId}/export-bundle`);
      expect(res.body.integrityReport).toHaveProperty('valid');
      expect(res.body.integrityReport).toHaveProperty('violations');
    });

    it('integrityReportText contains Audit Integrity Report header', async () => {
      const { sessionId } = await setupSession();
      const res = await request(app).get(`/v1/sessions/${sessionId}/export-bundle`);
      expect(res.body.integrityReportText).toContain('Audit Integrity Report');
    });

    it('artifactManifest is an array', async () => {
      const { sessionId } = await setupSession();
      const res = await request(app).get(`/v1/sessions/${sessionId}/export-bundle`);
      expect(Array.isArray(res.body.artifactManifest)).toBe(true);
    });

    it('artifactManifest entries include required metadata fields when artifacts exist', async () => {
      const pRes = await makePrincipal(app);
      const sRes = await makeSession(app, pRes.body.id);
      const sessionId = sRes.body.id as string;
      const t = new Date().toISOString();
      auditLog.write({ sessionId, taskId: 'task-z', principalId: pRes.body.id, eventType: 'tool.finished', toolName: 'build', startedAt: t });
      artifactStore.store({ type: 'file', uri: '/bin/output', provenanceId: 'task-z', checksum: 'abc123', label: 'Build artifact', invocationId: 'inv-x' });
      const res = await request(app).get(`/v1/sessions/${sessionId}/export-bundle`);
      expect(res.body.artifactManifest.length).toBe(1);
      const entry = res.body.artifactManifest[0];
      expect(entry).toHaveProperty('id');
      expect(entry).toHaveProperty('type');
      expect(entry).toHaveProperty('uri');
      expect(entry).toHaveProperty('checksum');
      expect(entry).toHaveProperty('retentionClass');
      expect(entry).toHaveProperty('provenanceId');
      expect(entry.label).toBe('Build artifact');
      expect(entry.invocationId).toBe('inv-x');
    });

    it('bundle recordCount is consistent with auditRecords length', async () => {
      const { sessionId } = await setupSession();
      const res = await request(app).get(`/v1/sessions/${sessionId}/export-bundle`);
      const { manifest, auditRecords } = res.body.replayPack as { manifest: { recordCount: number }; auditRecords: unknown[] };
      expect(auditRecords.length).toBe(manifest.recordCount);
    });

    it('integrityReport valid is consistent with violations array', async () => {
      const { sessionId } = await setupSession();
      const res = await request(app).get(`/v1/sessions/${sessionId}/export-bundle`);
      const { valid, violations } = res.body.integrityReport as { valid: boolean; violations: unknown[] };
      expect(valid).toBe(violations.length === 0);
    });

    it('exportedAt is a valid ISO timestamp', async () => {
      const { sessionId } = await setupSession();
      const res = await request(app).get(`/v1/sessions/${sessionId}/export-bundle`);
      const d = new Date(res.body.exportedAt as string);
      expect(isNaN(d.getTime())).toBe(false);
    });

    it('manifest recordCount matches number of audit records written (3)', async () => {
      const { sessionId } = await setupSession();
      const res = await request(app).get(`/v1/sessions/${sessionId}/export-bundle`);
      expect(res.body.replayPack.manifest.recordCount).toBe(3);
    });
  });
});
