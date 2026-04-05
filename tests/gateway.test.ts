/**
 * Tests for the gateway HTTP API.
 */

import request from 'supertest';
import { Gateway, GatewayConfig } from '../src/core/gateway';
import { PolicyEngine } from '../src/core/policy';
import { ToolBroker } from '../src/core/broker';
import { AuditLog } from '../src/core/audit';
import { SessionStore } from '../src/core/session';
import { ApprovalStore } from '../src/core/approval';
import { MemoryStore } from '../src/core/memory';

// supertest types
type SuperTestApp = Parameters<typeof request>[0];

function buildGateway(secret = '') {
  const policyEngine = new PolicyEngine();
  const auditLog = new AuditLog({ dbPath: ':memory:' });
  const broker = new ToolBroker(policyEngine, auditLog);
  const sessionStore = new SessionStore({ dbPath: ':memory:' });
  const approvalStore = new ApprovalStore({ dbPath: ':memory:' });
  const memoryStore = new MemoryStore({ dbPath: ':memory:' });

  const gateway = new Gateway(
    { host: '127.0.0.1', port: 0, dbPath: ':memory:', gatewaySecret: secret },
    { policyEngine, broker, auditLog, sessionStore, approvalStore, memoryStore }
  );

  return { gateway, auditLog, sessionStore, approvalStore, memoryStore };
}

describe('Gateway HTTP API', () => {
  let gateway: Gateway;
  let auditLog: AuditLog;
  let sessionStore: SessionStore;
  let approvalStore: ApprovalStore;
  let memoryStore: MemoryStore;
  let app: SuperTestApp;

  beforeEach(() => {
    const built = buildGateway();
    gateway = built.gateway;
    auditLog = built.auditLog;
    sessionStore = built.sessionStore;
    approvalStore = built.approvalStore;
    memoryStore = built.memoryStore;
    app = gateway.getApp();
  });

  afterEach(() => {
    auditLog.close();
    sessionStore.close();
    approvalStore.close();
    memoryStore.close();
  });

  // Health check
  it('GET /health returns ok (no auth required)', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  // Auth required for other routes
  it('GET /v1/auth/principals requires auth', async () => {
    const { gateway: gw, auditLog: al, sessionStore: ss, approvalStore: as, memoryStore: ms } = buildGateway('test-secret');
    const res = await request(gw.getApp()).get('/v1/auth/principals');
    expect(res.status).toBe(401);
    al.close(); ss.close(); as.close(); ms.close();
  });

  it('GET /v1/auth/principals with correct secret returns 200', async () => {
    const { gateway: gw, auditLog: al, sessionStore: ss, approvalStore: as, memoryStore: ms } = buildGateway('test-secret');
    const res = await request(gw.getApp())
      .get('/v1/auth/principals')
      .set('Authorization', 'Bearer test-secret');
    expect(res.status).toBe(200);
    al.close(); ss.close(); as.close(); ms.close();
  });

  // Principals
  it('POST /v1/auth/principals creates a principal', async () => {
    const res = await request(app)
      .post('/v1/auth/principals')
      .set('Authorization', 'Bearer ')
      .send({ type: 'user', identities: { webchat: 'user-1' }, trustLevel: 'medium', policyGroup: 'default' });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeTruthy();
    expect(res.body.type).toBe('user');
  });

  it('GET /v1/auth/principals/:id returns the principal', async () => {
    const createRes = await request(app)
      .post('/v1/auth/principals')
      .set('Authorization', 'Bearer ')
      .send({ type: 'operator', identities: {}, trustLevel: 'high', policyGroup: 'admin' });

    const id = createRes.body.id as string;
    const getRes = await request(app)
      .get(`/v1/auth/principals/${id}`)
      .set('Authorization', 'Bearer ');
    expect(getRes.status).toBe(200);
    expect(getRes.body.id).toBe(id);
  });

  it('GET /v1/auth/principals/:id returns 404 for unknown', async () => {
    const res = await request(app)
      .get('/v1/auth/principals/nonexistent')
      .set('Authorization', 'Bearer ');
    expect(res.status).toBe(404);
  });

  // Agents
  it('POST /v1/agents creates an agent', async () => {
    const res = await request(app)
      .post('/v1/agents')
      .set('Authorization', 'Bearer ')
      .send({ profile: 'assistant', defaultModel: 'gpt-4' });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeTruthy();
  });

  // Sessions
  it('POST /v1/sessions creates a session', async () => {
    const pRes = await request(app)
      .post('/v1/auth/principals')
      .set('Authorization', 'Bearer ')
      .send({ type: 'user', identities: {}, trustLevel: 'high', policyGroup: 'default' });
    const aRes = await request(app)
      .post('/v1/agents')
      .set('Authorization', 'Bearer ')
      .send({});

    const res = await request(app)
      .post('/v1/sessions')
      .set('Authorization', 'Bearer ')
      .send({ principalId: pRes.body.id, agentId: aRes.body.id });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeTruthy();
    expect(res.body.mode).toBe('interactive');
  });

  it('POST /v1/sessions returns 400 without principalId', async () => {
    const res = await request(app)
      .post('/v1/sessions')
      .set('Authorization', 'Bearer ')
      .send({ agentId: 'a-1' });
    expect(res.status).toBe(400);
  });

  // Tasks
  it('POST /v1/tasks creates a task', async () => {
    // Create a session first
    const pRes = await request(app)
      .post('/v1/auth/principals')
      .set('Authorization', 'Bearer ')
      .send({ type: 'user', identities: {}, trustLevel: 'high', policyGroup: 'default' });
    const aRes = await request(app)
      .post('/v1/agents')
      .set('Authorization', 'Bearer ')
      .send({});
    const sRes = await request(app)
      .post('/v1/sessions')
      .set('Authorization', 'Bearer ')
      .send({ principalId: pRes.body.id, agentId: aRes.body.id });

    const res = await request(app)
      .post('/v1/tasks')
      .set('Authorization', 'Bearer ')
      .send({ sessionId: sRes.body.id, title: 'Build the project', ownerId: pRes.body.id });
    expect(res.status).toBe(201);
    expect(res.body.state).toBe('pending');
  });

  // Approvals
  it('POST /v1/approvals creates an approval request', async () => {
    const res = await request(app)
      .post('/v1/approvals')
      .set('Authorization', 'Bearer ')
      .send({
        taskId: 't-1',
        requestedAction: 'browse(example.com)',
        riskClass: 'D',
        proposedScope: { domain: 'example.com' },
        humanReadableDiff: 'Browse to example.com',
      });
    expect(res.status).toBe(201);
    expect(res.body.outcome).toBe('pending');
  });

  it('GET /v1/approvals lists pending', async () => {
    await request(app)
      .post('/v1/approvals')
      .set('Authorization', 'Bearer ')
      .send({ taskId: 't-1', requestedAction: 'a', riskClass: 'C', proposedScope: {}, humanReadableDiff: 'h' });

    const res = await request(app)
      .get('/v1/approvals')
      .set('Authorization', 'Bearer ');
    expect(res.status).toBe(200);
    expect(res.body.approvals.length).toBeGreaterThanOrEqual(1);
  });

  it('POST /v1/approvals/:id/resolve resolves an approval', async () => {
    const createRes = await request(app)
      .post('/v1/approvals')
      .set('Authorization', 'Bearer ')
      .send({ taskId: 't-1', requestedAction: 'a', riskClass: 'D', proposedScope: {}, humanReadableDiff: 'h' });

    const res = await request(app)
      .post(`/v1/approvals/${createRes.body.id}/resolve`)
      .set('Authorization', 'Bearer ')
      .send({ approverId: 'p-1', outcome: 'approved' });
    expect(res.status).toBe(200);
    expect(res.body.outcome).toBe('approved');
  });

  // Audit
  it('GET /v1/audit returns audit records', async () => {
    auditLog.write({ sessionId: 's-1', principalId: 'p-1', eventType: 'tool.started', startedAt: new Date().toISOString() });

    const res = await request(app)
      .get('/v1/audit')
      .set('Authorization', 'Bearer ');
    expect(res.status).toBe(200);
    expect(res.body.records.length).toBeGreaterThanOrEqual(1);
  });

  // Memory
  it('POST /v1/memory stores a memory item', async () => {
    const res = await request(app)
      .post('/v1/memory')
      .set('Authorization', 'Bearer ')
      .send({ namespace: 'test', kind: 'factual', content: 'test fact' });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeTruthy();
  });

  it('GET /v1/memory queries memory', async () => {
    await request(app)
      .post('/v1/memory')
      .set('Authorization', 'Bearer ')
      .send({ namespace: 'ns-q', kind: 'factual', content: 'fact' });

    const res = await request(app)
      .get('/v1/memory?namespace=ns-q')
      .set('Authorization', 'Bearer ');
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThanOrEqual(1);
  });
});
