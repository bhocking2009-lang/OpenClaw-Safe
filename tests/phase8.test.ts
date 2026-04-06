/**
 * Phase 8 — Stability + Hardening tests.
 *
 * Covers:
 *   A. Browser failure-path audit events: timeout, body-too-large, network
 *      error, content-type denial
 *   B. Replay determinism: manifest counts include all new event types,
 *      lastKnownBudgetRemaining is set
 *   C. Budget correctness: tokensUsed always defined for browser workflow,
 *      fresh budget check guard
 *   D. Concurrency safety: parallel broker dispatches do not corrupt budget
 *   E. Input hardening: URL length, private IPs, localhost, IP literals
 *   F. Export bundle integrity: validateExportBundle catches mismatches
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
import {
  BrowserWorker,
  BrowserWorkerError,
  isPrivateOrInternalHost,
  isIpLiteral,
  isAcceptableContentType,
  isDomainAllowed,
} from '../src/workers/browser';
import { buildReplayPack, validateExportBundle } from '../src/core/replay';
import { formatReplaySummary } from '../src/core/display';

type SuperTestApp = Parameters<typeof request>[0];

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function buildBroker(allowedDomains: string[] = ['docs.example.com']) {
  const policyEngine = new PolicyEngine();
  const auditLog = new AuditLog({ dbPath: ':memory:' });
  const sessionStore = new SessionStore({ dbPath: ':memory:' });
  const artifactStore = new ArtifactStore({ dbPath: ':memory:' });
  const broker = new ToolBroker(policyEngine, auditLog, undefined, artifactStore, sessionStore);
  const worker = new BrowserWorker({ allowedDomains });
  broker.registerWorker(worker);
  broker.registerTool(BROWSER_DOC_FETCH_SCHEMA);
  return { broker, auditLog, sessionStore, artifactStore };
}

function makeSessionAndPrincipal(sessionStore: SessionStore) {
  const session = sessionStore.createSession({ principalId: 'p1', agentId: 'a1', budget: 100_000 });
  const principal = {
    id: 'p1',
    type: 'user' as const,
    trustLevel: 'high' as const,
    policyGroup: 'default',
    identities: {},
    createdAt: new Date().toISOString(),
  };
  return { session, principal };
}

function makePolicyCtx(
  principal: ReturnType<typeof makeSessionAndPrincipal>['principal'],
  session: ReturnType<typeof makeSessionAndPrincipal>['session'],
  networkDomain = 'docs.example.com'
) {
  return {
    principal,
    session,
    toolName: 'browser_doc_fetch',
    toolRiskClass: 'D' as const,
    runtimeTarget: 'browser_worker' as const,
    networkDomain,
    approvalState: 'pending' as const,
  };
}

function mockFetchWith(impl: () => Promise<unknown>) {
  const original = globalThis.fetch;
  globalThis.fetch = jest.fn().mockImplementation(impl) as typeof fetch;
  return () => { globalThis.fetch = original; };
}

function buildGateway(allowedDomains: string[] = ['docs.example.com']) {
  const policyEngine = new PolicyEngine();
  const auditLog = new AuditLog({ dbPath: ':memory:' });
  const sessionStore = new SessionStore({ dbPath: ':memory:' });
  const artifactStore = new ArtifactStore({ dbPath: ':memory:' });
  const broker = new ToolBroker(policyEngine, auditLog, undefined, artifactStore, sessionStore);
  const approvalStore = new ApprovalStore({ dbPath: ':memory:' });
  const memoryStore = new MemoryStore({ dbPath: ':memory:' });
  const browserWorker = new BrowserWorker({ allowedDomains });
  const gateway = new Gateway(
    { host: '127.0.0.1', port: 0, dbPath: ':memory:', gatewaySecret: '' },
    { policyEngine, broker, auditLog, sessionStore, approvalStore, memoryStore, artifactStore, browserWorker }
  );
  return { gateway, broker, auditLog, sessionStore, artifactStore };
}

// ---------------------------------------------------------------------------
// A. Browser failure-path audit events
// ---------------------------------------------------------------------------

describe('Phase 8A: browser failure-path audit events', () => {
  let broker: ToolBroker;
  let auditLog: AuditLog;
  let sessionStore: SessionStore;

  beforeEach(() => {
    ({ broker, auditLog, sessionStore } = buildBroker(['docs.example.com']));
  });

  afterEach(() => {
    auditLog.close();
    sessionStore.close();
  });

  it('emits browser.timeout on AbortError', async () => {
    const { session, principal } = makeSessionAndPrincipal(sessionStore);
    const restore = mockFetchWith(async () => {
      const err = new Error('The operation was aborted.');
      err.name = 'AbortError';
      throw err;
    });
    try {
      await broker.dispatch(
        { id: 'inv-t1', sessionId: session.id, taskId: 'task-t1', principalId: 'p1',
          toolName: 'browser_doc_fetch', params: { url: 'https://docs.example.com/page' } },
        makePolicyCtx(principal, session),
        { capabilitySet: ['browser_doc_fetch'], sandboxClass: 'default' }
      );
    } finally {
      restore();
    }
    const records = auditLog.queryBySession(session.id);
    const denial = records.find((r) => r.eventType === 'browser.timeout');
    expect(denial).toBeDefined();
    expect(denial!.error).toMatch(/timed out/i);
  });

  it('emits browser.body.too_large when response exceeds maxBodyBytes', async () => {
    const { session, principal } = makeSessionAndPrincipal(sessionStore);
    // Worker configured with tiny maxBodyBytes to trigger denial
    const { broker: smallBroker, auditLog: smallAudit, sessionStore: smallSession } = buildBroker([]);
    // Override worker with small max
    const policyEngine = new PolicyEngine();
    const miniAudit = new AuditLog({ dbPath: ':memory:' });
    const miniSession = new SessionStore({ dbPath: ':memory:' });
    const miniArtifacts = new ArtifactStore({ dbPath: ':memory:' });
    const miniBroker = new ToolBroker(policyEngine, miniAudit, undefined, miniArtifacts, miniSession);
    const miniWorker = new BrowserWorker({ allowedDomains: ['docs.example.com'], maxBodyBytes: 10 });
    miniBroker.registerWorker(miniWorker);
    miniBroker.registerTool(BROWSER_DOC_FETCH_SCHEMA);

    const miniSess = miniSession.createSession({ principalId: 'p1', agentId: 'a1', budget: 100_000 });
    const miniPrincipal = {
      id: 'p1', type: 'user' as const, trustLevel: 'high' as const,
      policyGroup: 'default', identities: {}, createdAt: new Date().toISOString(),
    };

    const restore = mockFetchWith(async () => ({
      status: 200,
      headers: { get: (h: string) => h === 'content-type' ? 'text/html' : null },
      text: async () => 'x'.repeat(100),
    }));
    try {
      await miniBroker.dispatch(
        { id: 'inv-big', sessionId: miniSess.id, taskId: 'task-big', principalId: 'p1',
          toolName: 'browser_doc_fetch', params: { url: 'https://docs.example.com/big' } },
        makePolicyCtx(miniPrincipal, miniSess),
        { capabilitySet: ['browser_doc_fetch'], sandboxClass: 'default' }
      );
    } finally {
      restore();
    }
    const records = miniAudit.queryBySession(miniSess.id);
    expect(records.find((r) => r.eventType === 'browser.body.too_large')).toBeDefined();

    miniAudit.close();
    miniSession.close();
    miniArtifacts.close();
    smallBroker; smallAudit.close(); smallSession.close();
  });

  it('emits browser.network.error on general network failure', async () => {
    const { session, principal } = makeSessionAndPrincipal(sessionStore);
    const restore = mockFetchWith(async () => {
      throw new TypeError('Failed to fetch: connection refused');
    });
    try {
      await broker.dispatch(
        { id: 'inv-net', sessionId: session.id, taskId: 'task-net', principalId: 'p1',
          toolName: 'browser_doc_fetch', params: { url: 'https://docs.example.com/page' } },
        makePolicyCtx(principal, session),
        { capabilitySet: ['browser_doc_fetch'], sandboxClass: 'default' }
      );
    } finally {
      restore();
    }
    const records = auditLog.queryBySession(session.id);
    expect(records.find((r) => r.eventType === 'browser.network.error')).toBeDefined();
  });

  it('emits browser.content_type.denied for binary content-type response', async () => {
    const { session, principal } = makeSessionAndPrincipal(sessionStore);
    const restore = mockFetchWith(async () => ({
      status: 200,
      headers: { get: (h: string) => h === 'content-type' ? 'application/octet-stream' : null },
      text: async () => 'binary data',
    }));
    try {
      await broker.dispatch(
        { id: 'inv-ct', sessionId: session.id, taskId: 'task-ct', principalId: 'p1',
          toolName: 'browser_doc_fetch', params: { url: 'https://docs.example.com/bin' } },
        makePolicyCtx(principal, session),
        { capabilitySet: ['browser_doc_fetch'], sandboxClass: 'default' }
      );
    } finally {
      restore();
    }
    const records = auditLog.queryBySession(session.id);
    expect(records.find((r) => r.eventType === 'browser.content_type.denied')).toBeDefined();
  });

  it('content-type text/html is accepted', async () => {
    const { session, principal } = makeSessionAndPrincipal(sessionStore);
    const restore = mockFetchWith(async () => ({
      status: 200,
      headers: { get: (h: string) => h === 'content-type' ? 'text/html; charset=utf-8' : null },
      text: async () => '<html>docs</html>',
    }));
    try {
      await broker.dispatch(
        { id: 'inv-html', sessionId: session.id, taskId: 'task-html', principalId: 'p1',
          toolName: 'browser_doc_fetch', params: { url: 'https://docs.example.com/guide' } },
        makePolicyCtx(principal, session),
        { capabilitySet: ['browser_doc_fetch'], sandboxClass: 'default' }
      );
    } finally {
      restore();
    }
    const records = auditLog.queryBySession(session.id);
    expect(records.find((r) => r.eventType === 'tool.finished')).toBeDefined();
    expect(records.find((r) => r.eventType === 'browser.content_type.denied')).toBeUndefined();
  });

  it('content-type application/json is accepted', async () => {
    const { session, principal } = makeSessionAndPrincipal(sessionStore);
    const restore = mockFetchWith(async () => ({
      status: 200,
      headers: { get: (h: string) => h === 'content-type' ? 'application/json' : null },
      text: async () => '{"key":"value"}',
    }));
    try {
      await broker.dispatch(
        { id: 'inv-json', sessionId: session.id, taskId: 'task-json', principalId: 'p1',
          toolName: 'browser_doc_fetch', params: { url: 'https://docs.example.com/data.json' } },
        makePolicyCtx(principal, session),
        { capabilitySet: ['browser_doc_fetch'], sandboxClass: 'default' }
      );
    } finally {
      restore();
    }
    const records = auditLog.queryBySession(session.id);
    expect(records.find((r) => r.eventType === 'tool.finished')).toBeDefined();
  });

  it('new browser failure events are counted in browserDenialCount in replay manifest', async () => {
    const { session, principal } = makeSessionAndPrincipal(sessionStore);
    // Trigger a timeout denial
    const restore = mockFetchWith(async () => {
      const err = new Error('The operation was aborted.');
      err.name = 'AbortError';
      throw err;
    });
    try {
      await broker.dispatch(
        { id: 'inv-timeout-m', sessionId: session.id, taskId: 't-timeout', principalId: 'p1',
          toolName: 'browser_doc_fetch', params: { url: 'https://docs.example.com/slow' } },
        makePolicyCtx(principal, session),
        { capabilitySet: ['browser_doc_fetch'], sandboxClass: 'default' }
      );
    } finally {
      restore();
    }
    const pack = buildReplayPack(session.id, auditLog);
    expect(pack.manifest.browserDenialCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// B. Replay determinism
// ---------------------------------------------------------------------------

describe('Phase 8B: replay determinism', () => {
  it('lastKnownBudgetRemaining in manifest reflects budget consumption', async () => {
    const policyEngine = new PolicyEngine();
    const auditLog = new AuditLog({ dbPath: ':memory:' });
    const sessionStore = new SessionStore({ dbPath: ':memory:' });
    const artifactStore = new ArtifactStore({ dbPath: ':memory:' });
    const broker = new ToolBroker(policyEngine, auditLog, undefined, artifactStore, sessionStore);
    const worker = new BrowserWorker({ allowedDomains: ['docs.example.com'] });
    broker.registerWorker(worker);
    broker.registerTool(BROWSER_DOC_FETCH_SCHEMA);

    const session = sessionStore.createSession({ principalId: 'p1', agentId: 'a1', budget: 50_000 });
    const principal = {
      id: 'p1', type: 'user' as const, trustLevel: 'high' as const,
      policyGroup: 'default', identities: {}, createdAt: new Date().toISOString(),
    };

    const body = 'hello documentation'; // 19 bytes
    const restore = mockFetchWith(async () => ({
      status: 200,
      headers: { get: (h: string) => h === 'content-type' ? 'text/plain' : null },
      text: async () => body,
    }));
    try {
      await broker.dispatch(
        { id: 'inv-bdr', sessionId: session.id, taskId: 't-bdr', principalId: 'p1',
          toolName: 'browser_doc_fetch', params: { url: 'https://docs.example.com/hello' } },
        makePolicyCtx(principal, session),
        { capabilitySet: ['browser_doc_fetch'], sandboxClass: 'default' }
      );
    } finally {
      restore();
    }

    const pack = buildReplayPack(session.id, auditLog);
    // The budget was decremented by body.length (19), so remaining = 50000 - 19 = 49981
    expect(pack.manifest.lastKnownBudgetRemaining).toBeDefined();
    expect(pack.manifest.lastKnownBudgetRemaining).toBe(50_000 - body.length);

    auditLog.close();
    sessionStore.close();
    artifactStore.close();
  });

  it('lastKnownBudgetRemaining is undefined when no budget events recorded', () => {
    const auditLog = new AuditLog({ dbPath: ':memory:' });
    const sessionStore = new SessionStore({ dbPath: ':memory:' });
    const session = sessionStore.createSession({ principalId: 'p1', agentId: 'a1', budget: 1000 });
    const pack = buildReplayPack(session.id, auditLog);
    expect(pack.manifest.lastKnownBudgetRemaining).toBeUndefined();
    auditLog.close();
    sessionStore.close();
  });

  it('replay summary header contains Budget line when lastKnownBudgetRemaining is set', async () => {
    const { broker, auditLog, sessionStore, artifactStore } = buildBroker(['docs.example.com']);
    const { session, principal } = makeSessionAndPrincipal(sessionStore);

    const restore = mockFetchWith(async () => ({
      status: 200,
      headers: { get: (h: string) => h === 'content-type' ? 'text/plain' : null },
      text: async () => 'doc content',
    }));
    try {
      await broker.dispatch(
        { id: 'inv-sum', sessionId: session.id, taskId: 't-sum', principalId: 'p1',
          toolName: 'browser_doc_fetch', params: { url: 'https://docs.example.com/x' } },
        makePolicyCtx(principal, session),
        { capabilitySet: ['browser_doc_fetch'], sandboxClass: 'default' }
      );
    } finally {
      restore();
    }

    const pack = buildReplayPack(session.id, auditLog);
    const summary = formatReplaySummary(pack);
    expect(summary).toContain('Budget');
    expect(summary).toContain('remaining');

    auditLog.close();
    sessionStore.close();
    artifactStore.close();
  });

  it('browserDenialCount covers all new denial event types', async () => {
    const { broker, auditLog, sessionStore } = buildBroker(['docs.example.com']);
    const { session, principal } = makeSessionAndPrincipal(sessionStore);

    // Trigger content-type denial
    const restore = mockFetchWith(async () => ({
      status: 200,
      headers: { get: (h: string) => h === 'content-type' ? 'image/png' : null },
      text: async () => 'png data',
    }));
    try {
      await broker.dispatch(
        { id: 'inv-ctd', sessionId: session.id, taskId: 't-ctd', principalId: 'p1',
          toolName: 'browser_doc_fetch', params: { url: 'https://docs.example.com/img.png' } },
        makePolicyCtx(principal, session),
        { capabilitySet: ['browser_doc_fetch'], sandboxClass: 'default' }
      );
    } finally {
      restore();
    }

    const pack = buildReplayPack(session.id, auditLog);
    expect(pack.manifest.browserDenialCount).toBe(1);
    auditLog.close();
    sessionStore.close();
  });
});

// ---------------------------------------------------------------------------
// C. Budget correctness
// ---------------------------------------------------------------------------

describe('Phase 8C: budget correctness', () => {
  it('tokensUsed is always defined on successful browser fetch receipt', async () => {
    const { broker, auditLog, sessionStore, artifactStore } = buildBroker(['docs.example.com']);
    const { session, principal } = makeSessionAndPrincipal(sessionStore);
    const docBody = 'This is the documentation page.';

    const restore = mockFetchWith(async () => ({
      status: 200,
      headers: { get: (h: string) => h === 'content-type' ? 'text/plain' : null },
      text: async () => docBody,
    }));
    try {
      const result = await broker.dispatch(
        { id: 'inv-tu', sessionId: session.id, taskId: 't-tu', principalId: 'p1',
          toolName: 'browser_doc_fetch', params: { url: 'https://docs.example.com/doc' } },
        makePolicyCtx(principal, session),
        { capabilitySet: ['browser_doc_fetch'], sandboxClass: 'default' }
      );

      expect(result.receipt).toBeDefined();
      expect(result.receipt!.tokensUsed).toBeDefined();
      expect(result.receipt!.tokensUsed).toBe(docBody.length);
    } finally {
      restore();
    }

    auditLog.close();
    sessionStore.close();
    artifactStore.close();
  });

  it('session budget is decremented by tokensUsed after successful fetch', async () => {
    const { broker, auditLog, sessionStore, artifactStore } = buildBroker(['docs.example.com']);
    const session = sessionStore.createSession({ principalId: 'p1', agentId: 'a1', budget: 1_000 });
    const principal = {
      id: 'p1', type: 'user' as const, trustLevel: 'high' as const,
      policyGroup: 'default', identities: {}, createdAt: new Date().toISOString(),
    };
    const docBody = 'x'.repeat(50); // 50 bytes

    const restore = mockFetchWith(async () => ({
      status: 200,
      headers: { get: (h: string) => h === 'content-type' ? 'text/plain' : null },
      text: async () => docBody,
    }));
    try {
      await broker.dispatch(
        { id: 'inv-bd', sessionId: session.id, taskId: 't-bd', principalId: 'p1',
          toolName: 'browser_doc_fetch', params: { url: 'https://docs.example.com/doc' } },
        makePolicyCtx(principal, session),
        { capabilitySet: ['browser_doc_fetch'], sandboxClass: 'default' }
      );
    } finally {
      restore();
    }

    const updated = sessionStore.getSession(session.id);
    expect(updated!.budget).toBe(1_000 - 50);

    auditLog.close();
    sessionStore.close();
    artifactStore.close();
  });

  it('budget check uses fresh DB read (stale snapshot does not bypass)', async () => {
    const { broker, auditLog, sessionStore, artifactStore } = buildBroker(['docs.example.com']);
    // Create session with budget 0
    const session = sessionStore.createSession({ principalId: 'p1', agentId: 'a1', budget: 0 });
    // Create principal with budget 100 in the snapshot (stale)
    const stalePrincipal = {
      id: 'p1', type: 'user' as const, trustLevel: 'high' as const,
      policyGroup: 'default', identities: {}, createdAt: new Date().toISOString(),
    };
    // Session snapshot says budget=100 (stale) but DB says 0 — broker should do fresh read
    const staleSession = { ...session, budget: 100 };

    const result = await broker.dispatch(
      { id: 'inv-fresh', sessionId: session.id, taskId: 't-fresh', principalId: 'p1',
        toolName: 'browser_doc_fetch', params: { url: 'https://docs.example.com/doc' } },
      { ...makePolicyCtx(stalePrincipal, staleSession), session: staleSession },
      { capabilitySet: ['browser_doc_fetch'], sandboxClass: 'default' }
    );

    // Should be denied due to fresh DB read showing budget=0
    expect(result.denied).toBe(true);
    const records = auditLog.queryBySession(session.id);
    expect(records.find((r) => r.eventType === 'budget.exhausted')).toBeDefined();

    auditLog.close();
    sessionStore.close();
    artifactStore.close();
  });
});

// ---------------------------------------------------------------------------
// D. Concurrency safety
// ---------------------------------------------------------------------------

describe('Phase 8D: concurrency safety', () => {
  it('budget never goes negative under parallel dispatches', async () => {
    const { broker, auditLog, sessionStore, artifactStore } = buildBroker(['docs.example.com']);
    const session = sessionStore.createSession({ principalId: 'p1', agentId: 'a1', budget: 200 });
    const principal = {
      id: 'p1', type: 'user' as const, trustLevel: 'high' as const,
      policyGroup: 'default', identities: {}, createdAt: new Date().toISOString(),
    };
    const docBody = 'x'.repeat(50); // 50 bytes each

    const restore = mockFetchWith(async () => ({
      status: 200,
      headers: { get: (h: string) => h === 'content-type' ? 'text/plain' : null },
      text: async () => docBody,
    }));

    try {
      // Fire 10 concurrent dispatches of 50 bytes each = 500 bytes total attempted
      // But budget is only 200, so some will be denied by budget exhaustion
      await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          broker.dispatch(
            { id: `inv-par-${i}`, sessionId: session.id, taskId: `task-par-${i}`, principalId: 'p1',
              toolName: 'browser_doc_fetch', params: { url: 'https://docs.example.com/doc' } },
            makePolicyCtx(principal, session),
            { capabilitySet: ['browser_doc_fetch'], sandboxClass: 'default' }
          )
        )
      );
    } finally {
      restore();
    }

    const updated = sessionStore.getSession(session.id);
    // Budget uses MAX(0, ...) so it can never go negative
    expect(updated!.budget).toBeGreaterThanOrEqual(0);
    expect(updated!.budget).toBeLessThanOrEqual(200);

    auditLog.close();
    sessionStore.close();
    artifactStore.close();
  });

  it('parallel dispatches produce consistent audit ordering (no duplicate IDs)', async () => {
    const { broker, auditLog, sessionStore, artifactStore } = buildBroker(['docs.example.com']);
    const session = sessionStore.createSession({ principalId: 'p1', agentId: 'a1', budget: 1_000_000 });
    const principal = {
      id: 'p1', type: 'user' as const, trustLevel: 'high' as const,
      policyGroup: 'default', identities: {}, createdAt: new Date().toISOString(),
    };

    const restore = mockFetchWith(async () => ({
      status: 200,
      headers: { get: (h: string) => h === 'content-type' ? 'text/plain' : null },
      text: async () => 'content',
    }));
    try {
      await Promise.all(
        Array.from({ length: 5 }, (_, i) =>
          broker.dispatch(
            { id: `inv-ord-${i}`, sessionId: session.id, taskId: `task-ord-${i}`, principalId: 'p1',
              toolName: 'browser_doc_fetch', params: { url: 'https://docs.example.com/doc' } },
            makePolicyCtx(principal, session),
            { capabilitySet: ['browser_doc_fetch'], sandboxClass: 'default' }
          )
        )
      );
    } finally {
      restore();
    }

    const records = auditLog.queryBySession(session.id);
    const ids = records.map((r) => r.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length); // no duplicate audit record IDs

    auditLog.close();
    sessionStore.close();
    artifactStore.close();
  });
});

// ---------------------------------------------------------------------------
// E. Input hardening
// ---------------------------------------------------------------------------

describe('Phase 8E: isPrivateOrInternalHost', () => {
  it.each([
    'localhost',
    '127.0.0.1',
    '10.0.0.1',
    '10.255.255.255',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '192.168.0.0',
    '169.254.1.2',
    '::1',
    'fe80::1',
    'fc00::1',
    'fd00::1',
  ])('%s is private/internal', (host) => {
    expect(isPrivateOrInternalHost(host)).toBe(true);
  });

  it.each([
    'docs.example.com',
    '8.8.8.8',
    '1.1.1.1',
    '172.32.0.1',
    '172.15.0.1',
    '11.0.0.1',
    '192.169.0.1',
  ])('%s is NOT private/internal', (host) => {
    expect(isPrivateOrInternalHost(host)).toBe(false);
  });
});

describe('Phase 8E: isIpLiteral', () => {
  it.each([
    '1.2.3.4',
    '192.168.1.1',
    '::1',
    '2001:db8::1',
    'fe80::1',
  ])('%s is an IP literal', (host) => {
    expect(isIpLiteral(host)).toBe(true);
  });

  it.each([
    'docs.example.com',
    'localhost',
    'api.trusted.org',
  ])('%s is NOT an IP literal', (host) => {
    expect(isIpLiteral(host)).toBe(false);
  });
});

describe('Phase 8E: isAcceptableContentType', () => {
  it.each([
    ['text/html', true],
    ['text/plain', true],
    ['text/html; charset=utf-8', true],
    ['application/json', true],
    ['application/json; charset=utf-8', true],
    [null, true],
    ['application/octet-stream', false],
    ['image/png', false],
    ['application/pdf', false],
    ['video/mp4', false],
  ])('content-type "%s" → acceptable=%s', (ct, expected) => {
    expect(isAcceptableContentType(ct)).toBe(expected);
  });
});

describe('Phase 8E: URL length enforcement in broker', () => {
  it('emits browser.url.denied for URLs exceeding max length', async () => {
    const policyEngine = new PolicyEngine();
    const auditLog = new AuditLog({ dbPath: ':memory:' });
    const sessionStore = new SessionStore({ dbPath: ':memory:' });
    const artifactStore = new ArtifactStore({ dbPath: ':memory:' });
    const broker = new ToolBroker(policyEngine, auditLog, undefined, artifactStore, sessionStore);
    const worker = new BrowserWorker({
      allowedDomains: ['docs.example.com'],
      maxUrlLength: 50, // very short for testing
    });
    broker.registerWorker(worker);
    broker.registerTool(BROWSER_DOC_FETCH_SCHEMA);

    const session = sessionStore.createSession({ principalId: 'p1', agentId: 'a1', budget: 10_000 });
    const principal = {
      id: 'p1', type: 'user' as const, trustLevel: 'high' as const,
      policyGroup: 'default', identities: {}, createdAt: new Date().toISOString(),
    };

    const longUrl = `https://docs.example.com/${'a'.repeat(100)}`;
    await broker.dispatch(
      { id: 'inv-long', sessionId: session.id, taskId: 't-long', principalId: 'p1',
        toolName: 'browser_doc_fetch', params: { url: longUrl } },
      makePolicyCtx(principal, session),
      { capabilitySet: ['browser_doc_fetch'], sandboxClass: 'default' }
    );

    const records = auditLog.queryBySession(session.id);
    expect(records.find((r) => r.eventType === 'browser.url.denied')).toBeDefined();

    auditLog.close();
    sessionStore.close();
    artifactStore.close();
  });

  it('emits browser.url.denied for localhost URL', async () => {
    const { broker, auditLog, sessionStore } = buildBroker(['localhost']);
    const { session, principal } = makeSessionAndPrincipal(sessionStore);

    await broker.dispatch(
      { id: 'inv-localhost', sessionId: session.id, taskId: 't-localhost', principalId: 'p1',
        toolName: 'browser_doc_fetch', params: { url: 'https://localhost/secret' } },
      makePolicyCtx(principal, session, 'localhost'),
      { capabilitySet: ['browser_doc_fetch'], sandboxClass: 'default' }
    );

    const records = auditLog.queryBySession(session.id);
    expect(records.find((r) => r.eventType === 'browser.url.denied')).toBeDefined();

    auditLog.close();
    sessionStore.close();
  });

  it('emits browser.url.denied for private IP URL even if on allowlist', async () => {
    const { broker, auditLog, sessionStore } = buildBroker(['192.168.1.1']);
    const { session, principal } = makeSessionAndPrincipal(sessionStore);

    await broker.dispatch(
      { id: 'inv-priv', sessionId: session.id, taskId: 't-priv', principalId: 'p1',
        toolName: 'browser_doc_fetch', params: { url: 'https://192.168.1.1/api' } },
      makePolicyCtx(principal, session, '192.168.1.1'),
      { capabilitySet: ['browser_doc_fetch'], sandboxClass: 'default' }
    );

    const records = auditLog.queryBySession(session.id);
    expect(records.find((r) => r.eventType === 'browser.url.denied')).toBeDefined();

    auditLog.close();
    sessionStore.close();
  });

  it('emits browser.url.denied for bare IP literal even if not private', async () => {
    const { broker, auditLog, sessionStore } = buildBroker(['8.8.8.8']);
    const { session, principal } = makeSessionAndPrincipal(sessionStore);

    await broker.dispatch(
      { id: 'inv-ip', sessionId: session.id, taskId: 't-ip', principalId: 'p1',
        toolName: 'browser_doc_fetch', params: { url: 'https://8.8.8.8/dns' } },
      makePolicyCtx(principal, session, '8.8.8.8'),
      { capabilitySet: ['browser_doc_fetch'], sandboxClass: 'default' }
    );

    const records = auditLog.queryBySession(session.id);
    expect(records.find((r) => r.eventType === 'browser.url.denied')).toBeDefined();

    auditLog.close();
    sessionStore.close();
  });
});

// ---------------------------------------------------------------------------
// F. Export bundle integrity
// ---------------------------------------------------------------------------

describe('Phase 8F: validateExportBundle', () => {
  it('returns valid for a fresh empty pack', () => {
    const auditLog = new AuditLog({ dbPath: ':memory:' });
    const sessionStore = new SessionStore({ dbPath: ':memory:' });
    const session = sessionStore.createSession({ principalId: 'p1', agentId: 'a1', budget: 1000 });
    const pack = buildReplayPack(session.id, auditLog);
    const result = validateExportBundle(pack);
    expect(result.valid).toBe(true);
    expect(result.violations).toHaveLength(0);
    auditLog.close();
    sessionStore.close();
  });

  it('catches record_count_mismatch when manifest and records diverge', () => {
    const auditLog = new AuditLog({ dbPath: ':memory:' });
    const sessionStore = new SessionStore({ dbPath: ':memory:' });
    const session = sessionStore.createSession({ principalId: 'p1', agentId: 'a1', budget: 1000 });
    const pack = buildReplayPack(session.id, auditLog);
    // Tamper: override manifest count without changing records array
    const tampered = {
      ...pack,
      manifest: { ...pack.manifest, recordCount: pack.manifest.recordCount + 5 },
    };
    const result = validateExportBundle(tampered);
    expect(result.valid).toBe(false);
    expect(result.violations.some((v) => v.kind === 'record_count_mismatch')).toBe(true);
    auditLog.close();
    sessionStore.close();
  });

  it('catches artifact_count_mismatch when manifest and artifacts array diverge', () => {
    const auditLog = new AuditLog({ dbPath: ':memory:' });
    const sessionStore = new SessionStore({ dbPath: ':memory:' });
    const artifactStore = new ArtifactStore({ dbPath: ':memory:' });
    const session = sessionStore.createSession({ principalId: 'p1', agentId: 'a1', budget: 1000 });
    const pack = buildReplayPack(session.id, auditLog, artifactStore);
    const tampered = {
      ...pack,
      manifest: { ...pack.manifest, artifactCount: pack.manifest.artifactCount + 3 },
    };
    const result = validateExportBundle(tampered);
    expect(result.valid).toBe(false);
    expect(result.violations.some((v) => v.kind === 'artifact_count_mismatch')).toBe(true);
    auditLog.close();
    sessionStore.close();
    artifactStore.close();
  });

  it('catches dangling_provenance for artifact with unknown taskId', async () => {
    const { broker, auditLog, sessionStore, artifactStore } = buildBroker(['docs.example.com']);
    const { session, principal } = makeSessionAndPrincipal(sessionStore);

    const restore = mockFetchWith(async () => ({
      status: 200,
      headers: { get: (h: string) => h === 'content-type' ? 'text/plain' : null },
      text: async () => 'doc body',
    }));
    try {
      await broker.dispatch(
        { id: 'inv-dp', sessionId: session.id, taskId: 'real-task-id', principalId: 'p1',
          toolName: 'browser_doc_fetch', params: { url: 'https://docs.example.com/page' } },
        makePolicyCtx(principal, session),
        { capabilitySet: ['browser_doc_fetch'], sandboxClass: 'default' }
      );
    } finally {
      restore();
    }

    const pack = buildReplayPack(session.id, auditLog, artifactStore);
    // Tamper: change artifact provenanceId to something not in audit records
    const tamperedArtifacts = pack.artifacts.map((a) => ({
      ...a,
      provenanceId: 'nonexistent-task-id',
    }));
    const tampered = { ...pack, artifacts: tamperedArtifacts };
    const result = validateExportBundle(tampered);
    expect(result.valid).toBe(false);
    expect(result.violations.some((v) => v.kind === 'dangling_provenance')).toBe(true);

    auditLog.close();
    sessionStore.close();
    artifactStore.close();
  });

  it('valid=true for a real pack with artifact after successful fetch', async () => {
    const { broker, auditLog, sessionStore, artifactStore } = buildBroker(['docs.example.com']);
    const { session, principal } = makeSessionAndPrincipal(sessionStore);

    const restore = mockFetchWith(async () => ({
      status: 200,
      headers: { get: (h: string) => h === 'content-type' ? 'text/plain' : null },
      text: async () => 'documentation content',
    }));
    try {
      await broker.dispatch(
        { id: 'inv-valid', sessionId: session.id, taskId: 'task-valid', principalId: 'p1',
          toolName: 'browser_doc_fetch', params: { url: 'https://docs.example.com/valid' } },
        makePolicyCtx(principal, session),
        { capabilitySet: ['browser_doc_fetch'], sandboxClass: 'default' }
      );
    } finally {
      restore();
    }

    const pack = buildReplayPack(session.id, auditLog, artifactStore);
    const result = validateExportBundle(pack);
    expect(result.valid).toBe(true);
    expect(result.violations).toHaveLength(0);

    auditLog.close();
    sessionStore.close();
    artifactStore.close();
  });

  it('export-bundle endpoint returns bundleValidation field', async () => {
    const { gateway, auditLog, sessionStore, artifactStore } = buildGateway(['docs.example.com']);
    const app = gateway.getApp();

    const principalRes = await request(app).post('/v1/auth/principals').send({
      type: 'user', trustLevel: 'high', policyGroup: 'default',
    });
    const principalId = principalRes.body.id;
    const sessionRes = await request(app).post('/v1/sessions').send({
      principalId, agentId: 'agent-1', mode: 'interactive', budget: 10_000,
    });
    const sessionId = sessionRes.body.id;

    const bundleRes = await request(app).get(`/v1/sessions/${sessionId}/export-bundle`);
    expect(bundleRes.status).toBe(200);
    expect(bundleRes.body.bundleValidation).toBeDefined();
    expect(bundleRes.body.bundleValidation.valid).toBe(true);
    expect(bundleRes.body.lastKnownBudgetRemaining).toBeUndefined(); // no budget events yet

    auditLog.close();
    sessionStore.close();
    artifactStore.close();
  });
});

// ---------------------------------------------------------------------------
// G. BrowserWorkerError unit tests for new event types
// ---------------------------------------------------------------------------

describe('BrowserWorkerError typed event types', () => {
  it.each([
    'browser.timeout',
    'browser.body.too_large',
    'browser.network.error',
    'browser.content_type.denied',
    'browser.url.denied',
  ])('BrowserWorkerError carries auditEventType "%s"', (eventType) => {
    const err = new BrowserWorkerError('test message', eventType);
    expect(err.auditEventType).toBe(eventType);
    expect(err.name).toBe('BrowserWorkerError');
  });
});
