/**
 * Phase 12 — Plugin / Extension Platform tests.
 *
 * Covers:
 *   A. Manifest validation         — schema, riskClass, version format, break-glass warning
 *   B. Version compatibility       — same major compat, major change rejection
 *   C. Plugin lifecycle via API    — install, enable, disable, remove (GET/POST/PATCH/DELETE)
 *   D. Permission enforcement      — broker-mediated invocation, capability check
 *   E. Isolation                   — plugins cannot invoke broker directly; invocation only via gateway
 *   F. Audit visibility            — plugin.installed, plugin.enabled, plugin.disabled,
 *                                     plugin.removed, plugin.action, plugin.capability.denied
 *   G. Denial paths                — invalid manifest, undeclared capability, disabled plugin,
 *                                     unknown plugin, missing session
 *   H. PluginStore unit tests      — install, get, list, setState, remove
 *   I. PluginRegistry new methods  — enable, disable, remove, version compatibility
 */

import request from 'supertest';
import { Gateway } from '../src/core/gateway';
import { PolicyEngine } from '../src/core/policy';
import { ToolBroker } from '../src/core/broker';
import { AuditLog } from '../src/core/audit';
import { AuditRecord } from '../src/core/types';
import { SessionStore } from '../src/core/session';
import { ApprovalStore } from '../src/core/approval';
import { MemoryStore } from '../src/core/memory';
import { ArtifactStore } from '../src/core/artifacts';
import { PolicyRuleStore } from '../src/core/policy-store';
import { PluginStore } from '../src/core/plugin-store';
import { PluginRegistry, isVersionCompatible, PluginManifestSchema } from '../src/plugins/registry';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type App = Parameters<typeof request>[0];

interface GwSetup {
  app: App;
  auditLog: AuditLog;
  sessionStore: SessionStore;
  pluginStore: PluginStore;
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
  const pluginStore = new PluginStore({ dbPath: ':memory:' });
  const gateway = new Gateway(
    { host: '127.0.0.1', port: 0, dbPath: ':memory:', gatewaySecret: '' },
    {
      policyEngine,
      broker,
      auditLog,
      sessionStore,
      approvalStore,
      memoryStore,
      artifactStore,
      policyRuleStore,
      pluginStore,
    }
  );
  return {
    app: gateway.getApp(),
    auditLog,
    sessionStore,
    pluginStore,
    close: () => {
      auditLog.close();
      sessionStore.close();
      approvalStore.close();
      memoryStore.close();
      artifactStore.close();
      policyRuleStore.close();
      pluginStore.close();
    },
  };
}

const VALID_MANIFEST = {
  id: 'plugin-search',
  name: 'Web Search Plugin',
  version: '1.0.0',
  description: 'Provides web search capabilities',
  capabilities: ['web_search', 'summarize'],
  allowedNetworkDomains: ['api.example.com'],
  declaredSecretNeeds: ['SEARCH_API_KEY'],
  executionMode: 'isolated_process' as const,
  packageHash: 'sha256:abc123def456',
  pinnedVersion: '1.0.0',
  installedAt: new Date().toISOString(),
  riskClass: 'A' as const,  // Class A: read-only, always allowed
};

// ---------------------------------------------------------------------------
// A. Manifest validation
// ---------------------------------------------------------------------------

describe('Manifest validation (PluginManifestSchema)', () => {
  it('accepts a valid manifest', () => {
    const r = PluginManifestSchema.safeParse(VALID_MANIFEST);
    expect(r.success).toBe(true);
  });

  it('rejects missing id', () => {
    const r = PluginManifestSchema.safeParse({ ...VALID_MANIFEST, id: '' });
    expect(r.success).toBe(false);
  });

  it('rejects invalid version format', () => {
    const r = PluginManifestSchema.safeParse({ ...VALID_MANIFEST, version: 'v1.0' });
    expect(r.success).toBe(false);
  });

  it('rejects invalid riskClass', () => {
    const r = PluginManifestSchema.safeParse({ ...VALID_MANIFEST, riskClass: 'Z' });
    expect(r.success).toBe(false);
  });

  it('rejects invalid executionMode', () => {
    const r = PluginManifestSchema.safeParse({ ...VALID_MANIFEST, executionMode: 'raw' });
    expect(r.success).toBe(false);
  });

  it('accepts in_process_trusted execution mode', () => {
    const r = PluginManifestSchema.safeParse({ ...VALID_MANIFEST, executionMode: 'in_process_trusted' });
    expect(r.success).toBe(true);
  });

  it('riskClass is required', () => {
    const { riskClass: _, ...noRisk } = VALID_MANIFEST;
    const r = PluginManifestSchema.safeParse(noRisk);
    expect(r.success).toBe(false);
  });

  it('warns on in_process_trusted via PluginRegistry', () => {
    const registry = new PluginRegistry();
    const spy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    registry.register({ ...VALID_MANIFEST, executionMode: 'in_process_trusted' });
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('in_process_trusted'));
    spy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// B. Version compatibility
// ---------------------------------------------------------------------------

describe('Version compatibility', () => {
  it('isVersionCompatible: same major, higher minor is compatible', () => {
    expect(isVersionCompatible('1.0.0', '1.1.0')).toBe(true);
  });

  it('isVersionCompatible: same version is compatible', () => {
    expect(isVersionCompatible('1.2.3', '1.2.3')).toBe(true);
  });

  it('isVersionCompatible: different major is incompatible', () => {
    expect(isVersionCompatible('1.0.0', '2.0.0')).toBe(false);
  });

  it('isVersionCompatible: lower minor is incompatible (downgrade)', () => {
    expect(isVersionCompatible('1.2.0', '1.1.0')).toBe(false);
  });

  it('PluginRegistry rejects major version change on re-register', () => {
    const registry = new PluginRegistry();
    registry.register(VALID_MANIFEST); // 1.0.0
    expect(() => registry.register({ ...VALID_MANIFEST, version: '2.0.0', pinnedVersion: '2.0.0' }))
      .toThrow(/major version/i);
  });

  it('PluginRegistry allows minor version update', () => {
    const registry = new PluginRegistry();
    registry.register(VALID_MANIFEST); // 1.0.0
    const updated = registry.register({ ...VALID_MANIFEST, version: '1.1.0', pinnedVersion: '1.1.0' });
    expect(updated.version).toBe('1.1.0');
  });
});

// ---------------------------------------------------------------------------
// C. Plugin lifecycle via API
// ---------------------------------------------------------------------------

describe('Plugin lifecycle via API', () => {
  it('POST /v1/plugins installs a plugin and returns 201', async () => {
    const gw = makeGateway();
    const res = await request(gw.app).post('/v1/plugins').send(VALID_MANIFEST);
    expect(res.status).toBe(201);
    expect(res.body.id).toBe(VALID_MANIFEST.id);
    expect(res.body.state).toBe('installed');
    gw.close();
  });

  it('GET /v1/plugins lists installed plugins', async () => {
    const gw = makeGateway();
    await request(gw.app).post('/v1/plugins').send(VALID_MANIFEST);
    const res = await request(gw.app).get('/v1/plugins');
    expect(res.status).toBe(200);
    expect(res.body.plugins).toHaveLength(1);
    gw.close();
  });

  it('GET /v1/plugins/:id returns the plugin', async () => {
    const gw = makeGateway();
    await request(gw.app).post('/v1/plugins').send(VALID_MANIFEST);
    const res = await request(gw.app).get(`/v1/plugins/${VALID_MANIFEST.id}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(VALID_MANIFEST.id);
    gw.close();
  });

  it('GET /v1/plugins/:id returns 404 for unknown plugin', async () => {
    const gw = makeGateway();
    const res = await request(gw.app).get('/v1/plugins/no-such-plugin');
    expect(res.status).toBe(404);
    gw.close();
  });

  it('PATCH /v1/plugins/:id/state enables a plugin', async () => {
    const gw = makeGateway();
    await request(gw.app).post('/v1/plugins').send(VALID_MANIFEST);
    const res = await request(gw.app)
      .patch(`/v1/plugins/${VALID_MANIFEST.id}/state`)
      .send({ state: 'enabled' });
    expect(res.status).toBe(200);
    expect(res.body.state).toBe('enabled');
    gw.close();
  });

  it('PATCH /v1/plugins/:id/state disables a plugin', async () => {
    const gw = makeGateway();
    await request(gw.app).post('/v1/plugins').send(VALID_MANIFEST);
    await request(gw.app).patch(`/v1/plugins/${VALID_MANIFEST.id}/state`).send({ state: 'enabled' });
    const res = await request(gw.app)
      .patch(`/v1/plugins/${VALID_MANIFEST.id}/state`)
      .send({ state: 'disabled' });
    expect(res.status).toBe(200);
    expect(res.body.state).toBe('disabled');
    gw.close();
  });

  it('PATCH /v1/plugins/:id/state rejects invalid state value', async () => {
    const gw = makeGateway();
    await request(gw.app).post('/v1/plugins').send(VALID_MANIFEST);
    const res = await request(gw.app)
      .patch(`/v1/plugins/${VALID_MANIFEST.id}/state`)
      .send({ state: 'running' });
    expect(res.status).toBe(400);
    gw.close();
  });

  it('DELETE /v1/plugins/:id removes the plugin', async () => {
    const gw = makeGateway();
    await request(gw.app).post('/v1/plugins').send(VALID_MANIFEST);
    const res = await request(gw.app).delete(`/v1/plugins/${VALID_MANIFEST.id}`);
    expect(res.status).toBe(200);
    expect(res.body.removed).toBe(true);
    const getRes = await request(gw.app).get(`/v1/plugins/${VALID_MANIFEST.id}`);
    expect(getRes.status).toBe(404);
    gw.close();
  });

  it('DELETE /v1/plugins/:id returns 404 for unknown plugin', async () => {
    const gw = makeGateway();
    const res = await request(gw.app).delete('/v1/plugins/no-such-plugin');
    expect(res.status).toBe(404);
    gw.close();
  });
});

// ---------------------------------------------------------------------------
// D. Permission enforcement (broker-mediated invocation)
// ---------------------------------------------------------------------------

describe('Permission enforcement', () => {
  async function setupEnabledPlugin(gw: GwSetup) {
    await request(gw.app).post('/v1/plugins').send(VALID_MANIFEST);
    await request(gw.app).patch(`/v1/plugins/${VALID_MANIFEST.id}/state`).send({ state: 'enabled' });
    const sessRes = await request(gw.app)
      .post('/v1/sessions')
      .send({ principalId: 'p-1', agentId: 'a-1', mode: 'task' });
    return sessRes.body as { id: string };
  }

  it('POST /plugins/:id/invoke succeeds for declared capability', async () => {
    const gw = makeGateway();
    const sess = await setupEnabledPlugin(gw);
    const res = await request(gw.app)
      .post(`/v1/plugins/${VALID_MANIFEST.id}/invoke`)
      .send({ sessionId: sess.id, capability: 'web_search', params: { query: 'test' } });
    expect(res.status).toBe(200);
    expect(res.body.audited).toBe(true);
    expect(res.body.capability).toBe('web_search');
    gw.close();
  });

  it('POST /plugins/:id/invoke denies undeclared capability with 403', async () => {
    const gw = makeGateway();
    const sess = await setupEnabledPlugin(gw);
    const res = await request(gw.app)
      .post(`/v1/plugins/${VALID_MANIFEST.id}/invoke`)
      .send({ sessionId: sess.id, capability: 'exec', params: {} });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/not declared/i);
    gw.close();
  });

  it('POST /plugins/:id/invoke denies when plugin is not enabled', async () => {
    const gw = makeGateway();
    await request(gw.app).post('/v1/plugins').send(VALID_MANIFEST); // state=installed, not enabled
    const sessRes = await request(gw.app).post('/v1/sessions').send({ principalId: 'p-1', agentId: 'a-1', mode: 'task' });
    const res = await request(gw.app)
      .post(`/v1/plugins/${VALID_MANIFEST.id}/invoke`)
      .send({ sessionId: sessRes.body.id, capability: 'web_search', params: {} });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/not enabled/i);
    gw.close();
  });

  it('POST /plugins/:id/invoke returns 404 for unknown plugin', async () => {
    const gw = makeGateway();
    const sessRes = await request(gw.app).post('/v1/sessions').send({ principalId: 'p-1', agentId: 'a-1', mode: 'task' });
    const res = await request(gw.app)
      .post('/v1/plugins/no-such-plugin/invoke')
      .send({ sessionId: sessRes.body.id, capability: 'web_search' });
    expect(res.status).toBe(404);
    gw.close();
  });

  it('POST /plugins/:id/invoke returns 400 when sessionId is missing', async () => {
    const gw = makeGateway();
    await request(gw.app).post('/v1/plugins').send(VALID_MANIFEST);
    await request(gw.app).patch(`/v1/plugins/${VALID_MANIFEST.id}/state`).send({ state: 'enabled' });
    const res = await request(gw.app)
      .post(`/v1/plugins/${VALID_MANIFEST.id}/invoke`)
      .send({ capability: 'web_search' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/sessionId/i);
    gw.close();
  });

  it('POST /plugins/:id/invoke returns 400 when capability is missing', async () => {
    const gw = makeGateway();
    await request(gw.app).post('/v1/plugins').send(VALID_MANIFEST);
    await request(gw.app).patch(`/v1/plugins/${VALID_MANIFEST.id}/state`).send({ state: 'enabled' });
    const sessRes = await request(gw.app).post('/v1/sessions').send({ principalId: 'p-1', agentId: 'a-1', mode: 'task' });
    const res = await request(gw.app)
      .post(`/v1/plugins/${VALID_MANIFEST.id}/invoke`)
      .send({ sessionId: sessRes.body.id });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/capability/i);
    gw.close();
  });

  it('POST /plugins/:id/invoke returns 404 when session does not exist', async () => {
    const gw = makeGateway();
    await request(gw.app).post('/v1/plugins').send(VALID_MANIFEST);
    await request(gw.app).patch(`/v1/plugins/${VALID_MANIFEST.id}/state`).send({ state: 'enabled' });
    const res = await request(gw.app)
      .post(`/v1/plugins/${VALID_MANIFEST.id}/invoke`)
      .send({ sessionId: 'nonexistent-session', capability: 'web_search' });
    expect(res.status).toBe(404);
    gw.close();
  });
});

// ---------------------------------------------------------------------------
// E. Isolation — plugins cannot directly call broker, DB, or audit
// ---------------------------------------------------------------------------

describe('Plugin isolation', () => {
  it('PluginStore has no access to AuditLog (no auditLog property)', () => {
    const store = new PluginStore({ dbPath: ':memory:' });
    expect((store as unknown as Record<string, unknown>)['auditLog']).toBeUndefined();
    store.close();
  });

  it('PluginStore has no access to ToolBroker (no broker property)', () => {
    const store = new PluginStore({ dbPath: ':memory:' });
    expect((store as unknown as Record<string, unknown>)['broker']).toBeUndefined();
    store.close();
  });

  it('PluginRegistry has no access to SessionStore (no sessionStore property)', () => {
    const registry = new PluginRegistry();
    expect((registry as unknown as Record<string, unknown>)['sessionStore']).toBeUndefined();
  });

  it('plugin invocation goes through gateway (audit events emitted)', async () => {
    const gw = makeGateway();
    await request(gw.app).post('/v1/plugins').send(VALID_MANIFEST);
    await request(gw.app).patch(`/v1/plugins/${VALID_MANIFEST.id}/state`).send({ state: 'enabled' });
    const sessRes = await request(gw.app).post('/v1/sessions').send({ principalId: 'p-1', agentId: 'a-1', mode: 'task' });
    await request(gw.app)
      .post(`/v1/plugins/${VALID_MANIFEST.id}/invoke`)
      .send({ sessionId: sessRes.body.id, capability: 'web_search', params: { query: 'test' } });
    const records = gw.auditLog.queryBySession(sessRes.body.id);
    const actionEvt = records.find((r: AuditRecord) => r.eventType === 'plugin.action');
    expect(actionEvt).toBeDefined();
    gw.close();
  });
});

// ---------------------------------------------------------------------------
// F. Audit visibility
// ---------------------------------------------------------------------------

describe('Audit visibility', () => {
  it('plugin.installed audit event emitted on install', async () => {
    const gw = makeGateway();
    await request(gw.app).post('/v1/plugins').send(VALID_MANIFEST);
    const records = gw.auditLog.queryBySession('system');
    const evt = records.find((r: AuditRecord) => r.eventType === 'plugin.installed');
    expect(evt).toBeDefined();
    expect((evt?.params as { pluginId: string }).pluginId).toBe(VALID_MANIFEST.id);
    gw.close();
  });

  it('plugin.enabled audit event emitted on enable', async () => {
    const gw = makeGateway();
    await request(gw.app).post('/v1/plugins').send(VALID_MANIFEST);
    await request(gw.app).patch(`/v1/plugins/${VALID_MANIFEST.id}/state`).send({ state: 'enabled' });
    const records = gw.auditLog.queryBySession('system');
    expect(records.some((r: AuditRecord) => r.eventType === 'plugin.enabled')).toBe(true);
    gw.close();
  });

  it('plugin.disabled audit event emitted on disable', async () => {
    const gw = makeGateway();
    await request(gw.app).post('/v1/plugins').send(VALID_MANIFEST);
    await request(gw.app).patch(`/v1/plugins/${VALID_MANIFEST.id}/state`).send({ state: 'disabled' });
    const records = gw.auditLog.queryBySession('system');
    expect(records.some((r: AuditRecord) => r.eventType === 'plugin.disabled')).toBe(true);
    gw.close();
  });

  it('plugin.removed audit event emitted on remove', async () => {
    const gw = makeGateway();
    await request(gw.app).post('/v1/plugins').send(VALID_MANIFEST);
    await request(gw.app).delete(`/v1/plugins/${VALID_MANIFEST.id}`);
    const records = gw.auditLog.queryBySession('system');
    expect(records.some((r: AuditRecord) => r.eventType === 'plugin.removed')).toBe(true);
    gw.close();
  });

  it('plugin.action audit event contains pluginId and capability', async () => {
    const gw = makeGateway();
    await request(gw.app).post('/v1/plugins').send(VALID_MANIFEST);
    await request(gw.app).patch(`/v1/plugins/${VALID_MANIFEST.id}/state`).send({ state: 'enabled' });
    const sessRes = await request(gw.app).post('/v1/sessions').send({ principalId: 'p-1', agentId: 'a-1', mode: 'task' });
    await request(gw.app)
      .post(`/v1/plugins/${VALID_MANIFEST.id}/invoke`)
      .send({ sessionId: sessRes.body.id, capability: 'web_search', params: { q: 'cats' } });
    const records = gw.auditLog.queryBySession(sessRes.body.id);
    const evt = records.find((r: AuditRecord) => r.eventType === 'plugin.action');
    expect(evt).toBeDefined();
    const delta = evt?.params as { pluginId: string; capability: string };
    expect(delta.pluginId).toBe(VALID_MANIFEST.id);
    expect(delta.capability).toBe('web_search');
    gw.close();
  });

  it('plugin.capability.denied audit event emitted for undeclared capability', async () => {
    const gw = makeGateway();
    await request(gw.app).post('/v1/plugins').send(VALID_MANIFEST);
    await request(gw.app).patch(`/v1/plugins/${VALID_MANIFEST.id}/state`).send({ state: 'enabled' });
    const sessRes = await request(gw.app).post('/v1/sessions').send({ principalId: 'p-1', agentId: 'a-1', mode: 'task' });
    await request(gw.app)
      .post(`/v1/plugins/${VALID_MANIFEST.id}/invoke`)
      .send({ sessionId: sessRes.body.id, capability: 'exec_shell', params: {} });
    const records = gw.auditLog.queryBySession(sessRes.body.id);
    const evt = records.find((r: AuditRecord) => r.eventType === 'plugin.capability.denied');
    expect(evt).toBeDefined();
    gw.close();
  });

  it('plugin.action event is visible in session audit log (replayable)', async () => {
    const gw = makeGateway();
    await request(gw.app).post('/v1/plugins').send(VALID_MANIFEST);
    await request(gw.app).patch(`/v1/plugins/${VALID_MANIFEST.id}/state`).send({ state: 'enabled' });
    const sessRes = await request(gw.app).post('/v1/sessions').send({ principalId: 'p-1', agentId: 'a-1', mode: 'task' });
    await request(gw.app)
      .post(`/v1/plugins/${VALID_MANIFEST.id}/invoke`)
      .send({ sessionId: sessRes.body.id, capability: 'summarize', params: { text: 'hello' } });

    // Replay pack should include the plugin.action record
    const replayRes = await request(gw.app).get(`/v1/sessions/${sessRes.body.id}/replay-export`);
    expect(replayRes.status).toBe(200);
    const auditRecords = (replayRes.body as { auditRecords: Array<{ eventType: string }> }).auditRecords;
    expect(auditRecords.some((r: { eventType: string }) => r.eventType === 'plugin.action')).toBe(true);
    gw.close();
  });
});

// ---------------------------------------------------------------------------
// G. Denial paths
// ---------------------------------------------------------------------------

describe('Denial paths', () => {
  it('POST /v1/plugins rejects invalid manifest (missing riskClass)', async () => {
    const gw = makeGateway();
    const { riskClass: _, ...noRisk } = VALID_MANIFEST;
    const res = await request(gw.app).post('/v1/plugins').send(noRisk);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid plugin manifest/i);
    gw.close();
  });

  it('POST /v1/plugins rejects invalid version string', async () => {
    const gw = makeGateway();
    const res = await request(gw.app).post('/v1/plugins').send({ ...VALID_MANIFEST, version: 'bad' });
    expect(res.status).toBe(400);
    gw.close();
  });

  it('invoke on disabled plugin returns 403', async () => {
    const gw = makeGateway();
    await request(gw.app).post('/v1/plugins').send(VALID_MANIFEST);
    await request(gw.app).patch(`/v1/plugins/${VALID_MANIFEST.id}/state`).send({ state: 'enabled' });
    await request(gw.app).patch(`/v1/plugins/${VALID_MANIFEST.id}/state`).send({ state: 'disabled' });
    const sessRes = await request(gw.app).post('/v1/sessions').send({ principalId: 'p-1', agentId: 'a-1', mode: 'task' });
    const res = await request(gw.app)
      .post(`/v1/plugins/${VALID_MANIFEST.id}/invoke`)
      .send({ sessionId: sessRes.body.id, capability: 'web_search' });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/not enabled/i);
    gw.close();
  });

  it('invoke on freshly-installed (not enabled) plugin returns 403', async () => {
    const gw = makeGateway();
    await request(gw.app).post('/v1/plugins').send(VALID_MANIFEST);
    const sessRes = await request(gw.app).post('/v1/sessions').send({ principalId: 'p-1', agentId: 'a-1', mode: 'task' });
    const res = await request(gw.app)
      .post(`/v1/plugins/${VALID_MANIFEST.id}/invoke`)
      .send({ sessionId: sessRes.body.id, capability: 'web_search' });
    expect(res.status).toBe(403);
    gw.close();
  });

  it('PATCH /plugins/:id/state returns 404 for unknown plugin', async () => {
    const gw = makeGateway();
    const res = await request(gw.app).patch('/v1/plugins/no-such/state').send({ state: 'enabled' });
    expect(res.status).toBe(404);
    gw.close();
  });
});

// ---------------------------------------------------------------------------
// H. PluginStore unit tests
// ---------------------------------------------------------------------------

describe('PluginStore unit tests', () => {
  it('installs a plugin with state=installed', () => {
    const store = new PluginStore({ dbPath: ':memory:' });
    const m = store.install({ ...VALID_MANIFEST, state: 'installed' });
    expect(m.state).toBe('installed');
    store.close();
  });

  it('get returns undefined for unknown id', () => {
    const store = new PluginStore({ dbPath: ':memory:' });
    expect(store.get('no-such')).toBeUndefined();
    store.close();
  });

  it('list returns all installed plugins', () => {
    const store = new PluginStore({ dbPath: ':memory:' });
    store.install({ ...VALID_MANIFEST, state: 'installed' });
    store.install({ ...VALID_MANIFEST, id: 'plugin-2', name: 'P2', state: 'installed' });
    expect(store.list()).toHaveLength(2);
    store.close();
  });

  it('setState enables a plugin', () => {
    const store = new PluginStore({ dbPath: ':memory:' });
    store.install({ ...VALID_MANIFEST, state: 'installed' });
    const updated = store.setState(VALID_MANIFEST.id, 'enabled');
    expect(updated?.state).toBe('enabled');
    expect(store.get(VALID_MANIFEST.id)?.state).toBe('enabled');
    store.close();
  });

  it('setState returns undefined for unknown plugin', () => {
    const store = new PluginStore({ dbPath: ':memory:' });
    expect(store.setState('no-such', 'enabled')).toBeUndefined();
    store.close();
  });

  it('remove deletes the plugin and returns true', () => {
    const store = new PluginStore({ dbPath: ':memory:' });
    store.install({ ...VALID_MANIFEST, state: 'installed' });
    expect(store.remove(VALID_MANIFEST.id)).toBe(true);
    expect(store.get(VALID_MANIFEST.id)).toBeUndefined();
    store.close();
  });

  it('remove returns false for unknown plugin', () => {
    const store = new PluginStore({ dbPath: ':memory:' });
    expect(store.remove('no-such')).toBe(false);
    store.close();
  });

  it('capabilities are serialized and deserialized correctly', () => {
    const store = new PluginStore({ dbPath: ':memory:' });
    store.install({ ...VALID_MANIFEST, state: 'installed' });
    const retrieved = store.get(VALID_MANIFEST.id);
    expect(retrieved?.capabilities).toEqual(VALID_MANIFEST.capabilities);
    expect(retrieved?.allowedNetworkDomains).toEqual(VALID_MANIFEST.allowedNetworkDomains);
    store.close();
  });
});

// ---------------------------------------------------------------------------
// I. PluginRegistry new methods
// ---------------------------------------------------------------------------

describe('PluginRegistry lifecycle methods', () => {
  it('enable sets state to enabled', () => {
    const registry = new PluginRegistry();
    registry.register(VALID_MANIFEST);
    const m = registry.enable(VALID_MANIFEST.id);
    expect(m?.state).toBe('enabled');
  });

  it('disable sets state to disabled', () => {
    const registry = new PluginRegistry();
    registry.register(VALID_MANIFEST);
    registry.enable(VALID_MANIFEST.id);
    const m = registry.disable(VALID_MANIFEST.id);
    expect(m?.state).toBe('disabled');
  });

  it('enable returns undefined for unknown plugin', () => {
    const registry = new PluginRegistry();
    expect(registry.enable('no-such')).toBeUndefined();
  });

  it('disable returns undefined for unknown plugin', () => {
    const registry = new PluginRegistry();
    expect(registry.disable('no-such')).toBeUndefined();
  });

  it('remove deletes the plugin', () => {
    const registry = new PluginRegistry();
    registry.register(VALID_MANIFEST);
    expect(registry.remove(VALID_MANIFEST.id)).toBe(true);
    expect(registry.get(VALID_MANIFEST.id)).toBeUndefined();
  });

  it('remove returns false for unknown plugin', () => {
    const registry = new PluginRegistry();
    expect(registry.remove('no-such')).toBe(false);
  });

  it('registered plugin starts with state=installed', () => {
    const registry = new PluginRegistry();
    const m = registry.register(VALID_MANIFEST);
    expect(m.state).toBe('installed');
  });
});
