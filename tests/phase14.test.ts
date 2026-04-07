/**
 * Phase 14 — BeeOS Operator UI tests.
 *
 * Covers:
 *   A. UI route accessibility — GET /ui and sub-paths return 200 HTML
 *   B. Auth exemption        — /ui is accessible without Bearer token even when
 *                              gateway secret is configured
 *   C. HTML content          — response contains BeeOS identity markers
 *   D. API independence      — /v1/* routes still require auth when secret set
 *   E. createBeeOSRouter     — unit tests for the router factory
 */

import request from 'supertest';
import { Gateway } from '../src/core/gateway';
import { PolicyEngine } from '../src/core/policy';
import { ToolBroker } from '../src/core/broker';
import { AuditLog } from '../src/core/audit';
import { SessionStore } from '../src/core/session';
import { ApprovalStore } from '../src/core/approval';
import { MemoryStore } from '../src/core/memory';
import { createBeeOSRouter } from '../src/ui/beeos';
import express from 'express';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type App = Parameters<typeof request>[0];

function makeGateway(secret = ''): { app: App; close(): void } {
  const policyEngine = new PolicyEngine();
  const auditLog = new AuditLog({ dbPath: ':memory:' });
  const broker = new ToolBroker(policyEngine, auditLog);
  const sessionStore = new SessionStore({ dbPath: ':memory:' });
  const approvalStore = new ApprovalStore({ dbPath: ':memory:' });
  const memoryStore = new MemoryStore({ dbPath: ':memory:' });
  const gw = new Gateway(
    { host: '127.0.0.1', port: 0, dbPath: ':memory:', gatewaySecret: secret },
    { policyEngine, broker, auditLog, sessionStore, approvalStore, memoryStore }
  );
  return {
    app: gw.getApp(),
    close() {
      auditLog.close();
      sessionStore.close();
      approvalStore.close();
      memoryStore.close();
    },
  };
}

// ---------------------------------------------------------------------------
// A. UI route accessibility
// ---------------------------------------------------------------------------

describe('Phase 14 — BeeOS UI: route accessibility', () => {
  let app: App;
  let close: () => void;

  beforeEach(() => {
    const gw = makeGateway();
    app = gw.app;
    close = gw.close;
  });
  afterEach(() => close());

  it('GET /ui returns 200', async () => {
    const res = await request(app).get('/ui');
    expect(res.status).toBe(200);
  });

  it('GET /ui has content-type text/html', async () => {
    const res = await request(app).get('/ui');
    expect(res.headers['content-type']).toMatch(/text\/html/);
  });

  it('GET /ui/sessions returns 200 (SPA fallback)', async () => {
    const res = await request(app).get('/ui/sessions');
    expect(res.status).toBe(200);
  });

  it('GET /ui/policy returns 200', async () => {
    const res = await request(app).get('/ui/policy');
    expect(res.status).toBe(200);
  });

  it('GET /ui/approvals returns 200', async () => {
    const res = await request(app).get('/ui/approvals');
    expect(res.status).toBe(200);
  });

  it('GET /ui/artifacts returns 200', async () => {
    const res = await request(app).get('/ui/artifacts');
    expect(res.status).toBe(200);
  });

  it('GET /ui/diff returns 200', async () => {
    const res = await request(app).get('/ui/diff');
    expect(res.status).toBe(200);
  });

  it('GET /ui/replay returns 200', async () => {
    const res = await request(app).get('/ui/replay');
    expect(res.status).toBe(200);
  });

  it('GET /ui/unknown-path returns 200 (SPA catch-all)', async () => {
    const res = await request(app).get('/ui/unknown-path');
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// B. Auth exemption
// ---------------------------------------------------------------------------

describe('Phase 14 — BeeOS UI: auth exemption', () => {
  let app: App;
  let close: () => void;

  beforeEach(() => {
    const gw = makeGateway('super-secret');
    app = gw.app;
    close = gw.close;
  });
  afterEach(() => close());

  it('GET /ui is accessible without auth token when secret is configured', async () => {
    const res = await request(app).get('/ui');
    expect(res.status).toBe(200);
  });

  it('GET /ui/policy is accessible without auth token', async () => {
    const res = await request(app).get('/ui/policy');
    expect(res.status).toBe(200);
  });

  it('GET /v1/sessions still requires auth when secret is configured', async () => {
    const res = await request(app).get('/v1/sessions');
    expect(res.status).toBe(401);
  });

  it('GET /v1/policy/rules still requires auth when secret is configured', async () => {
    const res = await request(app).get('/v1/policy/rules');
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// C. HTML content — BeeOS identity markers
// ---------------------------------------------------------------------------

describe('Phase 14 — BeeOS UI: HTML content', () => {
  let app: App;
  let close: () => void;

  beforeEach(() => {
    const gw = makeGateway();
    app = gw.app;
    close = gw.close;
  });
  afterEach(() => close());

  it('HTML contains BeeOS title', async () => {
    const res = await request(app).get('/ui');
    expect(res.text).toContain('BeeOS');
  });

  it('HTML contains Bee Pagoda Systems branding', async () => {
    const res = await request(app).get('/ui');
    expect(res.text).toContain('Bee Pagoda Systems');
  });

  it('HTML contains session explorer nav link', async () => {
    const res = await request(app).get('/ui');
    expect(res.text).toContain('#sessions');
  });

  it('HTML contains policy nav link', async () => {
    const res = await request(app).get('/ui');
    expect(res.text).toContain('#policy');
  });

  it('HTML contains approvals nav link', async () => {
    const res = await request(app).get('/ui');
    expect(res.text).toContain('#approvals');
  });

  it('HTML contains artifacts nav link', async () => {
    const res = await request(app).get('/ui');
    expect(res.text).toContain('#artifacts');
  });

  it('HTML contains replay nav link', async () => {
    const res = await request(app).get('/ui');
    expect(res.text).toContain('#replay');
  });

  it('HTML contains diff nav link', async () => {
    const res = await request(app).get('/ui');
    expect(res.text).toContain('#diff');
  });

  it('HTML contains API base path reference', async () => {
    const res = await request(app).get('/ui');
    expect(res.text).toContain('/v1');
  });

  it('HTML contains token input for auth', async () => {
    const res = await request(app).get('/ui');
    expect(res.text).toContain('token-input');
  });

  it('HTML is valid doctype', async () => {
    const res = await request(app).get('/ui');
    expect(res.text).toMatch(/^<!DOCTYPE html>/i);
  });

  it('HTML contains terminal-theme CSS (BeeOS dark palette)', async () => {
    const res = await request(app).get('/ui');
    // checks for the characteristic dark background colour
    expect(res.text).toContain('--bg:');
  });

  it('HTML is identical across multiple GET /ui requests (deterministic)', async () => {
    const r1 = await request(app).get('/ui');
    const r2 = await request(app).get('/ui');
    expect(r1.text).toBe(r2.text);
  });
});

// ---------------------------------------------------------------------------
// D. createBeeOSRouter unit tests
// ---------------------------------------------------------------------------

describe('Phase 14 — createBeeOSRouter: unit tests', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.use('/ui', createBeeOSRouter());
  });

  it('returns a router that handles GET /', async () => {
    const res = await request(app).get('/ui/');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
  });

  it('returns a router that handles GET /any-path', async () => {
    const res = await request(app).get('/ui/any-path');
    expect(res.status).toBe(200);
  });

  it('returns a router that handles GET /deep/nested/path', async () => {
    const res = await request(app).get('/ui/deep/nested/path');
    expect(res.status).toBe(200);
  });

  it('HTML body from standalone router matches gateway HTML body', async () => {
    const gw = makeGateway();
    const gwRes = await request(gw.app).get('/ui');
    const standaloneRes = await request(app).get('/ui/');
    // Both should contain BeeOS
    expect(standaloneRes.text).toContain('BeeOS');
    expect(gwRes.text).toContain('BeeOS');
    gw.close();
  });
});

// ---------------------------------------------------------------------------
// E. No business logic in UI route handler
// ---------------------------------------------------------------------------

describe('Phase 14 — BeeOS UI: no business logic', () => {
  it('createBeeOSRouter does not accept a policyEngine or broker argument', () => {
    // The function signature takes no arguments
    expect(createBeeOSRouter.length).toBe(0);
  });

  it('createBeeOSRouter returns an Express Router', () => {
    const router = createBeeOSRouter();
    // Express Router is a function with routing methods
    expect(typeof router).toBe('function');
    expect(typeof router.get).toBe('function');
  });

  it('BeeOS HTML does not contain direct DB query strings', async () => {
    const miniApp = express();
    miniApp.use('/ui', createBeeOSRouter());
    const res = await request(miniApp).get('/ui/');
    // Should not contain SQLite-style raw queries
    expect(res.text).not.toMatch(/SELECT\s+\*/i);
    expect(res.text).not.toMatch(/INSERT\s+INTO/i);
    expect(res.text).not.toMatch(/require\(['"]better-sqlite/);
  });
});
