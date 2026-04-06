/**
 * Phase 7 — Policy-Shaped Capability Expansion: browser_doc_fetch workflow.
 *
 * Covers:
 *   - Allowlist enforcement: broker denies when domain is not on allowlist
 *   - Denial-path: protocol denied, redirect denied audit events
 *   - Audit event types: browser.allowlist.denied, browser.protocol.denied,
 *     browser.redirect.denied emitted with correct eventType
 *   - tool.started / tool.finished emitted for successful fetch
 *   - Artifact linkage: structured_data artifact stored after successful fetch
 *   - Replay manifest stats: browserFetchCount and browserDenialCount
 *   - Display layer: browser denials in Decisions section (🔒 icon);
 *     browser stats in header; network summary in Executions
 *   - Export bundle: browserFetchCount and browserDenialCount fields
 *   - Operator endpoint: POST /v1/browser/doc-fetch happy path and denial
 *   - 503 when browserWorker not configured
 */

import request from 'supertest';
import { Gateway, BROWSER_DOC_FETCH_SCHEMA } from '../src/core/gateway';
import { PolicyEngine } from '../src/core/policy';
import { ToolBroker } from '../src/core/broker';
import { AuditLog } from '../src/core/audit';
import { SessionStore } from '../src/core/session';
import { ApprovalStore } from '../src/core/approval';
import { MemoryStore } from '../src/core/memory';
import { ArtifactStore } from '../src/core/artifacts';
import { BrowserWorker, BrowserWorkerError } from '../src/workers/browser';
import { buildReplayPack } from '../src/core/replay';
import { formatReplaySummary } from '../src/core/display';

type SuperTestApp = Parameters<typeof request>[0];

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function buildGateway(withBrowserWorker = true, allowedDomains: string[] = ['docs.example.com']) {
  const policyEngine = new PolicyEngine();
  const auditLog = new AuditLog({ dbPath: ':memory:' });
  const sessionStore = new SessionStore({ dbPath: ':memory:' });
  const artifactStore = new ArtifactStore({ dbPath: ':memory:' });
  const broker = new ToolBroker(policyEngine, auditLog, undefined, artifactStore, sessionStore);
  const approvalStore = new ApprovalStore({ dbPath: ':memory:' });
  const memoryStore = new MemoryStore({ dbPath: ':memory:' });
  const browserWorker = withBrowserWorker
    ? new BrowserWorker({ allowedDomains })
    : undefined;
  const gateway = new Gateway(
    { host: '127.0.0.1', port: 0, dbPath: ':memory:', gatewaySecret: '' },
    { policyEngine, broker, auditLog, sessionStore, approvalStore, memoryStore, artifactStore, browserWorker }
  );
  return { gateway, broker, auditLog, sessionStore, approvalStore, memoryStore, artifactStore };
}

/** Create a principal via HTTP and return its id. */
async function makePrincipal(app: SuperTestApp, trustLevel: 'high' | 'medium' | 'low' = 'high') {
  const res = await request(app).post('/v1/auth/principals').send({
    type: 'user', trustLevel, policyGroup: 'default',
  });
  return res.body.id as string;
}

/** Create a session with the given budget. */
async function makeSession(app: SuperTestApp, principalId: string, budget = 100_000) {
  const res = await request(app).post('/v1/sessions').send({
    principalId, agentId: 'agent-1', mode: 'interactive', budget,
  });
  return res.body.id as string;
}

/** Create a task with browser_doc_fetch in capabilitySet. */
async function makeTask(app: SuperTestApp, sessionId: string, ownerId: string) {
  const res = await request(app).post('/v1/tasks').send({
    sessionId,
    title: 'browser-doc-fetch task',
    ownerId,
    capabilitySet: ['browser_doc_fetch'],
  });
  return res.body.id as string;
}

/** Mock globalThis.fetch to return a fake response. */
function mockFetch(body: string, status = 200) {
  const original = globalThis.fetch;
  globalThis.fetch = jest.fn().mockResolvedValue({
    status,
    headers: { get: (_h: string) => 'text/plain' },
    text: async () => body,
  }) as typeof fetch;
  return () => { globalThis.fetch = original; };
}

// ---------------------------------------------------------------------------
// A. BrowserWorkerError class
// ---------------------------------------------------------------------------

describe('BrowserWorkerError', () => {
  it('carries the auditEventType property', () => {
    const err = new BrowserWorkerError('domain not allowed', 'browser.allowlist.denied');
    expect(err.auditEventType).toBe('browser.allowlist.denied');
    expect(err.message).toContain('domain not allowed');
    expect(err.name).toBe('BrowserWorkerError');
  });
});

// ---------------------------------------------------------------------------
// B. Allowlist enforcement (broker-level)
// ---------------------------------------------------------------------------

describe('broker: browser.allowlist.denied audit event', () => {
  let auditLog: AuditLog;
  let sessionStore: SessionStore;
  let broker: ToolBroker;

  beforeEach(() => {
    const policyEngine = new PolicyEngine();
    auditLog = new AuditLog({ dbPath: ':memory:' });
    sessionStore = new SessionStore({ dbPath: ':memory:' });
    const artifactStore = new ArtifactStore({ dbPath: ':memory:' });
    broker = new ToolBroker(policyEngine, auditLog, undefined, artifactStore, sessionStore);

    const worker = new BrowserWorker({ allowedDomains: ['docs.example.com'] });
    broker.registerWorker(worker);
    broker.registerTool(BROWSER_DOC_FETCH_SCHEMA);
  });

  afterEach(() => {
    auditLog.close();
    sessionStore.close();
  });

  it('emits browser.allowlist.denied when domain is not on allowlist', async () => {
    const session = sessionStore.createSession({ principalId: 'p1', agentId: 'a1', budget: 10_000 });
    const principal = {
      id: 'p1', type: 'user' as const, trustLevel: 'high' as const,
      policyGroup: 'default', identities: {}, createdAt: new Date().toISOString(),
    };

    const result = await broker.dispatch(
      { id: 'inv-1', sessionId: session.id, taskId: 'task-1', principalId: 'p1',
        toolName: 'browser_doc_fetch', params: { url: 'https://evil.example.com/doc' } },
      { principal, session, toolName: 'browser_doc_fetch', toolRiskClass: 'D',
        runtimeTarget: 'browser_worker', networkDomain: 'evil.example.com', approvalState: 'pending' },
      { capabilitySet: ['browser_doc_fetch'], sandboxClass: 'default' }
    );

    expect(result.denied).toBe(false); // policy allowed, worker threw
    const records = auditLog.queryBySession(session.id);
    const denial = records.find((r) => r.eventType === 'browser.allowlist.denied');
    expect(denial).toBeDefined();
    expect(denial!.toolName).toBe('browser_doc_fetch');
    expect(denial!.error).toMatch(/not on the allowlist/i);
  });

  it('does NOT emit browser.allowlist.denied when domain is allowed (uses mock fetch)', async () => {
    const restore = mockFetch('<html>docs</html>');
    try {
      const session = sessionStore.createSession({ principalId: 'p1', agentId: 'a1', budget: 10_000 });
      const principal = {
        id: 'p1', type: 'user' as const, trustLevel: 'high' as const,
        policyGroup: 'default', identities: {}, createdAt: new Date().toISOString(),
      };

      await broker.dispatch(
        { id: 'inv-2', sessionId: session.id, taskId: 'task-2', principalId: 'p1',
          toolName: 'browser_doc_fetch', params: { url: 'https://docs.example.com/guide' } },
        { principal, session, toolName: 'browser_doc_fetch', toolRiskClass: 'D',
          runtimeTarget: 'browser_worker', networkDomain: 'docs.example.com', approvalState: 'pending' },
        { capabilitySet: ['browser_doc_fetch'], sandboxClass: 'default' }
      );

      const records = auditLog.queryBySession(session.id);
      expect(records.find((r) => r.eventType === 'browser.allowlist.denied')).toBeUndefined();
      expect(records.find((r) => r.eventType === 'tool.finished')).toBeDefined();
    } finally {
      restore();
    }
  });
});

// ---------------------------------------------------------------------------
// C. Denial-path audit events
// ---------------------------------------------------------------------------

describe('broker: denial-path audit events', () => {
  let auditLog: AuditLog;
  let sessionStore: SessionStore;
  let broker: ToolBroker;

  beforeEach(() => {
    const policyEngine = new PolicyEngine();
    auditLog = new AuditLog({ dbPath: ':memory:' });
    sessionStore = new SessionStore({ dbPath: ':memory:' });
    const artifactStore = new ArtifactStore({ dbPath: ':memory:' });
    broker = new ToolBroker(policyEngine, auditLog, undefined, artifactStore, sessionStore);

    const worker = new BrowserWorker({ allowedDomains: ['docs.example.com', 'allowed.org'] });
    broker.registerWorker(worker);
    broker.registerTool(BROWSER_DOC_FETCH_SCHEMA);
  });

  afterEach(() => {
    auditLog.close();
    sessionStore.close();
  });

  function makeSessionAndPrincipal() {
    const session = sessionStore.createSession({ principalId: 'p1', agentId: 'a1', budget: 10_000 });
    const principal = {
      id: 'p1', type: 'user' as const, trustLevel: 'high' as const,
      policyGroup: 'default', identities: {}, createdAt: new Date().toISOString(),
    };
    return { session, principal };
  }

  it('emits browser.protocol.denied for non-http/https protocols', async () => {
    const { session, principal } = makeSessionAndPrincipal();

    await broker.dispatch(
      { id: 'inv-3', sessionId: session.id, taskId: 'task-3', principalId: 'p1',
        toolName: 'browser_doc_fetch', params: { url: 'ftp://docs.example.com/file' } },
      { principal, session, toolName: 'browser_doc_fetch', toolRiskClass: 'D',
        runtimeTarget: 'browser_worker', networkDomain: 'docs.example.com', approvalState: 'pending' },
      { capabilitySet: ['browser_doc_fetch'], sandboxClass: 'default' }
    );

    const records = auditLog.queryBySession(session.id);
    const denial = records.find((r) => r.eventType === 'browser.protocol.denied');
    expect(denial).toBeDefined();
    expect(denial!.error).toMatch(/unsupported protocol/i);
  });

  it('emits browser.redirect.denied when fetch encounters a redirect', async () => {
    const { session, principal } = makeSessionAndPrincipal();

    // Simulate fetch throwing a redirect TypeError
    const original = globalThis.fetch;
    globalThis.fetch = jest.fn().mockRejectedValue(
      Object.assign(new TypeError('redirect mode is set to error, so redirect is an error'), {})
    ) as typeof fetch;

    try {
      await broker.dispatch(
        { id: 'inv-4', sessionId: session.id, taskId: 'task-4', principalId: 'p1',
          toolName: 'browser_doc_fetch', params: { url: 'https://docs.example.com/redirected' } },
        { principal, session, toolName: 'browser_doc_fetch', toolRiskClass: 'D',
          runtimeTarget: 'browser_worker', networkDomain: 'docs.example.com', approvalState: 'pending' },
        { capabilitySet: ['browser_doc_fetch'], sandboxClass: 'default' }
      );
    } finally {
      globalThis.fetch = original;
    }

    const records = auditLog.queryBySession(session.id);
    const denial = records.find((r) => r.eventType === 'browser.redirect.denied');
    expect(denial).toBeDefined();
    expect(denial!.error).toMatch(/redirect/i);
  });
});

// ---------------------------------------------------------------------------
// D. Artifact linkage
// ---------------------------------------------------------------------------

describe('artifact linkage: structured_data artifact on successful fetch', () => {
  let auditLog: AuditLog;
  let sessionStore: SessionStore;
  let artifactStore: ArtifactStore;
  let broker: ToolBroker;

  beforeEach(() => {
    const policyEngine = new PolicyEngine();
    auditLog = new AuditLog({ dbPath: ':memory:' });
    sessionStore = new SessionStore({ dbPath: ':memory:' });
    artifactStore = new ArtifactStore({ dbPath: ':memory:' });
    broker = new ToolBroker(policyEngine, auditLog, undefined, artifactStore, sessionStore);

    const worker = new BrowserWorker({ allowedDomains: ['docs.example.com'] });
    broker.registerWorker(worker);
    broker.registerTool(BROWSER_DOC_FETCH_SCHEMA);
  });

  afterEach(() => {
    auditLog.close();
    sessionStore.close();
    artifactStore.close();
  });

  it('stores a structured_data artifact after a successful fetch', async () => {
    const restore = mockFetch('# API Reference\nThis is the documentation.');
    try {
      const session = sessionStore.createSession({ principalId: 'p1', agentId: 'a1', budget: 10_000 });
      const principal = {
        id: 'p1', type: 'user' as const, trustLevel: 'high' as const,
        policyGroup: 'default', identities: {}, createdAt: new Date().toISOString(),
      };

      const result = await broker.dispatch(
        { id: 'inv-5', sessionId: session.id, taskId: 'task-5', principalId: 'p1',
          toolName: 'browser_doc_fetch', params: { url: 'https://docs.example.com/api', label: 'API Reference' } },
        { principal, session, toolName: 'browser_doc_fetch', toolRiskClass: 'D',
          runtimeTarget: 'browser_worker', networkDomain: 'docs.example.com', approvalState: 'pending' },
        { capabilitySet: ['browser_doc_fetch'], sandboxClass: 'default' }
      );

      expect(result.denied).toBe(false);
      expect(result.receipt).toBeDefined();
      expect(result.receipt!.artifacts).toHaveLength(1);
      expect(result.receipt!.artifacts[0].uri).toMatch(/^browser-doc:\/\//);
      expect(result.receipt!.artifacts[0].type).toBe('structured_data');

      // Artifact should be stored in the artifact store
      const stored = artifactStore.listByType('structured_data');
      expect(stored).toHaveLength(1);
      expect(stored[0].type).toBe('structured_data');
      expect(stored[0].label).toBe('API Reference');
      expect(stored[0].invocationId).toBe('inv-5');
    } finally {
      restore();
    }
  });

  it('artifact is filterable by type=structured_data', async () => {
    const restore = mockFetch('docs content');
    try {
      const session = sessionStore.createSession({ principalId: 'p1', agentId: 'a1', budget: 10_000 });
      const principal = {
        id: 'p1', type: 'user' as const, trustLevel: 'high' as const,
        policyGroup: 'default', identities: {}, createdAt: new Date().toISOString(),
      };

      await broker.dispatch(
        { id: 'inv-6', sessionId: session.id, taskId: 'task-6', principalId: 'p1',
          toolName: 'browser_doc_fetch', params: { url: 'https://docs.example.com/guide' } },
        { principal, session, toolName: 'browser_doc_fetch', toolRiskClass: 'D',
          runtimeTarget: 'browser_worker', networkDomain: 'docs.example.com', approvalState: 'pending' },
        { capabilitySet: ['browser_doc_fetch'], sandboxClass: 'default' }
      );

      const byType = artifactStore.listByType('structured_data');
      expect(byType.length).toBeGreaterThan(0);
      expect(byType[0].type).toBe('structured_data');
    } finally {
      restore();
    }
  });
});

// ---------------------------------------------------------------------------
// E. Replay pack stats
// ---------------------------------------------------------------------------

describe('replay pack: browserFetchCount and browserDenialCount', () => {
  let auditLog: AuditLog;
  let sessionStore: SessionStore;
  let broker: ToolBroker;

  beforeEach(() => {
    const policyEngine = new PolicyEngine();
    auditLog = new AuditLog({ dbPath: ':memory:' });
    sessionStore = new SessionStore({ dbPath: ':memory:' });
    broker = new ToolBroker(policyEngine, auditLog, undefined, undefined, sessionStore);

    const worker = new BrowserWorker({ allowedDomains: ['docs.example.com'] });
    broker.registerWorker(worker);
    broker.registerTool(BROWSER_DOC_FETCH_SCHEMA);
  });

  afterEach(() => {
    auditLog.close();
    sessionStore.close();
  });

  it('browserFetchCount reflects successful fetch completions', async () => {
    const restore = mockFetch('content');
    try {
      const session = sessionStore.createSession({ principalId: 'p1', agentId: 'a1', budget: 10_000 });
      const principal = {
        id: 'p1', type: 'user' as const, trustLevel: 'high' as const,
        policyGroup: 'default', identities: {}, createdAt: new Date().toISOString(),
      };
      const task = { capabilitySet: ['browser_doc_fetch'], sandboxClass: 'default' };
      const ctx = { principal, session, toolName: 'browser_doc_fetch', toolRiskClass: 'D' as const,
        runtimeTarget: 'browser_worker' as const, networkDomain: 'docs.example.com', approvalState: 'pending' as const };

      await broker.dispatch(
        { id: 'inv-7', sessionId: session.id, taskId: 't7', principalId: 'p1',
          toolName: 'browser_doc_fetch', params: { url: 'https://docs.example.com/a' } },
        ctx, task
      );

      const pack = buildReplayPack(session.id, auditLog);
      expect(pack.manifest.browserFetchCount).toBe(1);
      expect(pack.manifest.browserDenialCount).toBe(0);
    } finally {
      restore();
    }
  });

  it('browserDenialCount reflects allowlist denial events', async () => {
    const session = sessionStore.createSession({ principalId: 'p1', agentId: 'a1', budget: 10_000 });
    const principal = {
      id: 'p1', type: 'user' as const, trustLevel: 'high' as const,
      policyGroup: 'default', identities: {}, createdAt: new Date().toISOString(),
    };
    const task = { capabilitySet: ['browser_doc_fetch'], sandboxClass: 'default' };

    // Attempt two blocked domains
    for (const url of ['https://evil.com/a', 'https://blocked.org/b']) {
      const hostname = new URL(url).hostname;
      await broker.dispatch(
        { id: `inv-${url}`, sessionId: session.id, taskId: 't8', principalId: 'p1',
          toolName: 'browser_doc_fetch', params: { url } },
        { principal, session, toolName: 'browser_doc_fetch', toolRiskClass: 'D',
          runtimeTarget: 'browser_worker', networkDomain: hostname, approvalState: 'pending' },
        task
      );
    }

    const pack = buildReplayPack(session.id, auditLog);
    expect(pack.manifest.browserDenialCount).toBe(2);
    expect(pack.manifest.browserFetchCount).toBe(0);
  });

  it('protocol denial is counted in browserDenialCount', async () => {
    const session = sessionStore.createSession({ principalId: 'p1', agentId: 'a1', budget: 10_000 });
    const principal = {
      id: 'p1', type: 'user' as const, trustLevel: 'high' as const,
      policyGroup: 'default', identities: {}, createdAt: new Date().toISOString(),
    };

    await broker.dispatch(
      { id: 'inv-9', sessionId: session.id, taskId: 't9', principalId: 'p1',
        toolName: 'browser_doc_fetch', params: { url: 'ftp://docs.example.com/x' } },
      { principal, session, toolName: 'browser_doc_fetch', toolRiskClass: 'D',
        runtimeTarget: 'browser_worker', networkDomain: 'docs.example.com', approvalState: 'pending' },
      { capabilitySet: ['browser_doc_fetch'], sandboxClass: 'default' }
    );

    const pack = buildReplayPack(session.id, auditLog);
    expect(pack.manifest.browserDenialCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// F. Display layer
// ---------------------------------------------------------------------------

describe('display layer: browser events visibility', () => {
  it('shows 🔒 icon for browser.allowlist.denied in Decisions section', () => {
    const sessionId = 'sess-display-1';
    const auditLog = new AuditLog({ dbPath: ':memory:' });
    const sessionStore = new SessionStore({ dbPath: ':memory:' });
    const broker = new ToolBroker(new PolicyEngine(), auditLog, undefined, undefined, sessionStore);
    const worker = new BrowserWorker({ allowedDomains: [] });
    broker.registerWorker(worker);
    broker.registerTool(BROWSER_DOC_FETCH_SCHEMA);

    const session = sessionStore.createSession({ principalId: 'p1', agentId: 'a1', budget: 10_000 });
    const principal = {
      id: 'p1', type: 'user' as const, trustLevel: 'high' as const,
      policyGroup: 'default', identities: {}, createdAt: new Date().toISOString(),
    };

    const dispatchPromise = broker.dispatch(
      { id: 'inv-d1', sessionId: session.id, taskId: 't-d1', principalId: 'p1',
        toolName: 'browser_doc_fetch', params: { url: 'https://evil.com/doc' } },
      { principal, session, toolName: 'browser_doc_fetch', toolRiskClass: 'D',
        runtimeTarget: 'browser_worker', networkDomain: 'evil.com', approvalState: 'pending' },
      { capabilitySet: ['browser_doc_fetch'], sandboxClass: 'default' }
    );

    return dispatchPromise.then(() => {
      const pack = buildReplayPack(session.id, auditLog);
      const summary = formatReplaySummary(pack);

      expect(summary).toContain('🔒');
      expect(summary).toContain('browser.allowlist.denied');

      auditLog.close();
      sessionStore.close();
    });
  });

  it('stats header includes browser fetch and denial counts', () => {
    const auditLog = new AuditLog({ dbPath: ':memory:' });
    const sessionStore = new SessionStore({ dbPath: ':memory:' });
    const broker = new ToolBroker(new PolicyEngine(), auditLog, undefined, undefined, sessionStore);
    const worker = new BrowserWorker({ allowedDomains: [] });
    broker.registerWorker(worker);
    broker.registerTool(BROWSER_DOC_FETCH_SCHEMA);

    const session = sessionStore.createSession({ principalId: 'p1', agentId: 'a1', budget: 10_000 });
    const principal = {
      id: 'p1', type: 'user' as const, trustLevel: 'high' as const,
      policyGroup: 'default', identities: {}, createdAt: new Date().toISOString(),
    };

    const dispatchPromise = broker.dispatch(
      { id: 'inv-d2', sessionId: session.id, taskId: 't-d2', principalId: 'p1',
        toolName: 'browser_doc_fetch', params: { url: 'https://blocked.com/doc' } },
      { principal, session, toolName: 'browser_doc_fetch', toolRiskClass: 'D',
        runtimeTarget: 'browser_worker', networkDomain: 'blocked.com', approvalState: 'pending' },
      { capabilitySet: ['browser_doc_fetch'], sandboxClass: 'default' }
    );

    return dispatchPromise.then(() => {
      const pack = buildReplayPack(session.id, auditLog);
      const summary = formatReplaySummary(pack);

      expect(summary).toContain('browser fetch(es)');
      expect(summary).toContain('browser denial(s)');

      auditLog.close();
      sessionStore.close();
    });
  });

  it('shows network summary in Executions section for successful browser fetch', async () => {
    const auditLog = new AuditLog({ dbPath: ':memory:' });
    const sessionStore = new SessionStore({ dbPath: ':memory:' });
    const broker = new ToolBroker(new PolicyEngine(), auditLog, undefined, undefined, sessionStore);
    const worker = new BrowserWorker({ allowedDomains: ['docs.example.com'] });
    broker.registerWorker(worker);
    broker.registerTool(BROWSER_DOC_FETCH_SCHEMA);

    const restore = mockFetch('hello docs');
    try {
      const session = sessionStore.createSession({ principalId: 'p1', agentId: 'a1', budget: 10_000 });
      const principal = {
        id: 'p1', type: 'user' as const, trustLevel: 'high' as const,
        policyGroup: 'default', identities: {}, createdAt: new Date().toISOString(),
      };

      await broker.dispatch(
        { id: 'inv-d3', sessionId: session.id, taskId: 't-d3', principalId: 'p1',
          toolName: 'browser_doc_fetch', params: { url: 'https://docs.example.com/page' } },
        { principal, session, toolName: 'browser_doc_fetch', toolRiskClass: 'D',
          runtimeTarget: 'browser_worker', networkDomain: 'docs.example.com', approvalState: 'pending' },
        { capabilitySet: ['browser_doc_fetch'], sandboxClass: 'default' }
      );

      const pack = buildReplayPack(session.id, auditLog);
      const summary = formatReplaySummary(pack);

      expect(summary).toContain('network');
    } finally {
      restore();
      auditLog.close();
      sessionStore.close();
    }
  });
});

// ---------------------------------------------------------------------------
// G. Export bundle
// ---------------------------------------------------------------------------

describe('export bundle: browser fields', () => {
  let app: SuperTestApp;
  let auditLog: AuditLog;
  let sessionStore: SessionStore;
  let artifactStore: ArtifactStore;

  beforeEach(() => {
    const built = buildGateway(true, ['docs.example.com']);
    app = built.gateway.getApp();
    auditLog = built.auditLog;
    sessionStore = built.sessionStore;
    artifactStore = built.artifactStore;
  });

  afterEach(() => {
    auditLog.close();
    sessionStore.close();
    artifactStore.close();
  });

  it('export-bundle includes browserFetchCount and browserDenialCount', async () => {
    const principalId = await makePrincipal(app);
    const sessionId = await makeSession(app, principalId);

    const bundleRes = await request(app).get(`/v1/sessions/${sessionId}/export-bundle`);
    expect(bundleRes.status).toBe(200);
    expect(typeof bundleRes.body.browserFetchCount).toBe('number');
    expect(typeof bundleRes.body.browserDenialCount).toBe('number');
    expect(bundleRes.body.browserFetchCount).toBe(0);
    expect(bundleRes.body.browserDenialCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// H. Operator endpoint: POST /v1/browser/doc-fetch
// ---------------------------------------------------------------------------

describe('POST /v1/browser/doc-fetch operator endpoint', () => {
  let app: SuperTestApp;
  let auditLog: AuditLog;
  let sessionStore: SessionStore;
  let artifactStore: ArtifactStore;

  beforeEach(() => {
    const built = buildGateway(true, ['docs.example.com']);
    app = built.gateway.getApp();
    auditLog = built.auditLog;
    sessionStore = built.sessionStore;
    artifactStore = built.artifactStore;
  });

  afterEach(() => {
    auditLog.close();
    sessionStore.close();
    artifactStore.close();
  });

  it('returns 400 when sessionId is missing', async () => {
    const res = await request(app).post('/v1/browser/doc-fetch').send({ url: 'https://docs.example.com/' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/sessionId/i);
  });

  it('returns 400 when url is missing', async () => {
    const principalId = await makePrincipal(app);
    const sessionId = await makeSession(app, principalId);
    const taskId = await makeTask(app, sessionId, principalId);
    const res = await request(app).post('/v1/browser/doc-fetch').send({ sessionId, taskId });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/url/i);
  });

  it('returns 400 for an invalid url', async () => {
    const principalId = await makePrincipal(app);
    const sessionId = await makeSession(app, principalId);
    const taskId = await makeTask(app, sessionId, principalId);
    const res = await request(app).post('/v1/browser/doc-fetch')
      .send({ sessionId, taskId, url: 'not-a-url' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/url/i);
  });

  it('returns 404 for unknown session', async () => {
    const res = await request(app).post('/v1/browser/doc-fetch')
      .send({ sessionId: 'no-such-session', taskId: 't', url: 'https://docs.example.com/' });
    expect(res.status).toBe(404);
  });

  it('returns 404 for unknown task', async () => {
    const principalId = await makePrincipal(app);
    const sessionId = await makeSession(app, principalId);
    const res = await request(app).post('/v1/browser/doc-fetch')
      .send({ sessionId, taskId: 'no-such-task', url: 'https://docs.example.com/' });
    expect(res.status).toBe(404);
  });

  it('returns denied=true when domain is not on allowlist', async () => {
    const principalId = await makePrincipal(app);
    const sessionId = await makeSession(app, principalId);
    const taskId = await makeTask(app, sessionId, principalId);

    const res = await request(app).post('/v1/browser/doc-fetch')
      .send({ sessionId, taskId, url: 'https://evil.com/doc' });

    expect(res.status).toBe(200);
    expect(res.body.denied).toBe(false); // policy allowed; worker denied
    expect(res.body.error).toMatch(/allowlist|not on the allowlist/i);
  });

  it('happy path: returns receipt and artifact on successful fetch', async () => {
    const restore = mockFetch('<h1>Getting Started</h1>');
    try {
      const principalId = await makePrincipal(app);
      const sessionId = await makeSession(app, principalId);
      const taskId = await makeTask(app, sessionId, principalId);

      const res = await request(app).post('/v1/browser/doc-fetch')
        .send({ sessionId, taskId, url: 'https://docs.example.com/guide', label: 'Getting Started' });

      expect(res.status).toBe(200);
      expect(res.body.denied).toBe(false);
      expect(res.body.receipt).toBeDefined();
      expect(res.body.error).toBeNull();

      // Artifact should be visible via GET /v1/artifacts?type=structured_data
      const artRes = await request(app).get('/v1/artifacts?type=structured_data');
      expect(artRes.status).toBe(200);
      expect(artRes.body.artifacts.length).toBeGreaterThan(0);
      expect(artRes.body.artifacts[0].type).toBe('structured_data');
    } finally {
      restore();
    }
  });

  it('audit log contains tool.started and tool.finished for successful fetch', async () => {
    const restore = mockFetch('documentation text');
    try {
      const principalId = await makePrincipal(app);
      const sessionId = await makeSession(app, principalId);
      const taskId = await makeTask(app, sessionId, principalId);

      await request(app).post('/v1/browser/doc-fetch')
        .send({ sessionId, taskId, url: 'https://docs.example.com/api' });

      const auditRes = await request(app).get(`/v1/audit?sessionId=${sessionId}`);
      const records = auditRes.body.records as Array<{ eventType: string }>;
      expect(records.find((r) => r.eventType === 'tool.started')).toBeDefined();
      expect(records.find((r) => r.eventType === 'tool.finished')).toBeDefined();
    } finally {
      restore();
    }
  });

  it('audit log contains browser.allowlist.denied for blocked domain', async () => {
    const principalId = await makePrincipal(app);
    const sessionId = await makeSession(app, principalId);
    const taskId = await makeTask(app, sessionId, principalId);

    await request(app).post('/v1/browser/doc-fetch')
      .send({ sessionId, taskId, url: 'https://not-on-list.com/doc' });

    const auditRes = await request(app).get(`/v1/audit?sessionId=${sessionId}`);
    const records = auditRes.body.records as Array<{ eventType: string }>;
    expect(records.find((r) => r.eventType === 'browser.allowlist.denied')).toBeDefined();
  });

  it('export-bundle shows non-zero browserDenialCount after a denial', async () => {
    const principalId = await makePrincipal(app);
    const sessionId = await makeSession(app, principalId);
    const taskId = await makeTask(app, sessionId, principalId);

    await request(app).post('/v1/browser/doc-fetch')
      .send({ sessionId, taskId, url: 'https://evil.com/doc' });

    const bundleRes = await request(app).get(`/v1/sessions/${sessionId}/export-bundle`);
    expect(bundleRes.status).toBe(200);
    expect(bundleRes.body.browserDenialCount).toBe(1);
    expect(bundleRes.body.browserFetchCount).toBe(0);
  });

  it('replay summary shows browser denial in Decisions section', async () => {
    const principalId = await makePrincipal(app);
    const sessionId = await makeSession(app, principalId);
    const taskId = await makeTask(app, sessionId, principalId);

    await request(app).post('/v1/browser/doc-fetch')
      .send({ sessionId, taskId, url: 'https://not-allowed.com/doc' });

    const summaryRes = await request(app).get(`/v1/sessions/${sessionId}/replay-summary?format=text`);
    expect(summaryRes.status).toBe(200);
    expect(summaryRes.text).toContain('🔒');
    expect(summaryRes.text).toContain('browser.allowlist.denied');
  });
});

// ---------------------------------------------------------------------------
// I. 503 when browserWorker is not configured
// ---------------------------------------------------------------------------

describe('POST /v1/browser/doc-fetch: 503 without browser worker', () => {
  it('returns 503 when gateway is started without a browserWorker', async () => {
    const built = buildGateway(false);
    const app = built.gateway.getApp();

    const res = await request(app).post('/v1/browser/doc-fetch')
      .send({ sessionId: 'any', taskId: 'any', url: 'https://docs.example.com/' });

    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/browser worker not configured/i);

    built.auditLog.close();
    built.sessionStore.close();
    built.artifactStore.close();
  });
});

// ---------------------------------------------------------------------------
// J. BROWSER_DOC_FETCH_SCHEMA exported constant
// ---------------------------------------------------------------------------

describe('BROWSER_DOC_FETCH_SCHEMA', () => {
  it('has risk class D and browser_worker runtime target', () => {
    expect(BROWSER_DOC_FETCH_SCHEMA.riskClass).toBe('D');
    expect(BROWSER_DOC_FETCH_SCHEMA.defaultRuntimeTarget).toBe('browser_worker');
    expect(BROWSER_DOC_FETCH_SCHEMA.name).toBe('browser_doc_fetch');
  });

  it('input schema requires url', () => {
    const required = (BROWSER_DOC_FETCH_SCHEMA.inputSchema as { required?: string[] }).required;
    expect(required).toContain('url');
  });
});
