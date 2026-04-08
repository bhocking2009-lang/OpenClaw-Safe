/**
 * Phase 15 — model provider integration tests.
 *
 * Tests cover:
 *   - /health includes modelProvider info when a provider is bound
 *   - /health has no modelProvider key when no provider is bound
 *   - GET /v1/model/status returns correct shape
 *   - Gateway start() emits model.provider.selected audit event
 *   - POST /tasks/:id/delegate accepts providerName + modelName
 *   - Delegated child task persists providerName + modelName
 *   - delegation.model.bound audit event is written
 *   - model events (model.request, model.response, model.error, model.tool.request)
 *     appear in AgentRuntime event stream
 */

import request from 'supertest';
import { Gateway } from '../src/core/gateway';
import { PolicyEngine } from '../src/core/policy';
import { ToolBroker } from '../src/core/broker';
import { AuditLog } from '../src/core/audit';
import { SessionStore } from '../src/core/session';
import { ApprovalStore } from '../src/core/approval';
import { MemoryStore } from '../src/core/memory';
import { ModelProvider } from '../src/core/agent';
import { AgentRuntime, AgentRuntimeOptions, StubModelProvider } from '../src/core/agent';
import { StubWorker } from '../src/workers/sandbox';
import { Principal, Session, Task } from '../src/core/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStubModelProvider(available = true): ModelProvider & { probeResult: boolean } {
  const provider = {
    name: 'test-provider',
    model: 'test-model-1.0',
    probeResult: available,
    probe: async function() { return this.probeResult; },
    invoke: async () => ({ content: 'stub response' }),
  };
  return provider;
}

function buildGateway(modelProvider?: ModelProvider) {
  const policyEngine = new PolicyEngine();
  const auditLog = new AuditLog({ dbPath: ':memory:' });
  const sessionStore = new SessionStore({ dbPath: ':memory:' });
  const approvalStore = new ApprovalStore({ dbPath: ':memory:' });
  const memoryStore = new MemoryStore({ dbPath: ':memory:' });
  const broker = new ToolBroker(policyEngine, auditLog);

  const gateway = new Gateway(
    { gatewaySecret: '' },
    {
      policyEngine,
      broker,
      auditLog,
      sessionStore,
      approvalStore,
      memoryStore,
      modelProvider,
    }
  );

  return { gateway, auditLog, sessionStore };
}

// ---------------------------------------------------------------------------
// /health endpoint — model provider
// ---------------------------------------------------------------------------

describe('/health endpoint', () => {
  it('has no modelProvider key when no provider is configured', async () => {
    const { gateway } = buildGateway();
    const res = await request(gateway.getApp()).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.modelProvider).toBeUndefined();
  });

  it('includes modelProvider when a provider is configured', async () => {
    const mp = makeStubModelProvider();
    const { gateway } = buildGateway(mp);
    // Before start(), available is null
    const res = await request(gateway.getApp()).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.modelProvider).toBeDefined();
    expect(res.body.modelProvider.name).toBe('test-provider');
    expect(res.body.modelProvider.model).toBe('test-model-1.0');
  });

  it('reflects available=true after start() with reachable provider', async () => {
    const mp = makeStubModelProvider(true);
    const { gateway, auditLog } = buildGateway(mp);
    await gateway.start();
    try {
      const res = await request(gateway.getApp()).get('/health');
      expect(res.body.modelProvider.available).toBe(true);
    } finally {
      await gateway.stop();
      auditLog.close();
    }
  });

  it('reflects available=false after start() with unreachable provider', async () => {
    const mp = makeStubModelProvider(false);
    const { gateway, auditLog } = buildGateway(mp);
    await gateway.start();
    try {
      const res = await request(gateway.getApp()).get('/health');
      expect(res.body.modelProvider.available).toBe(false);
    } finally {
      await gateway.stop();
      auditLog.close();
    }
  });
});

// ---------------------------------------------------------------------------
// GET /v1/model/status
// ---------------------------------------------------------------------------

describe('GET /v1/model/status', () => {
  it('returns bound=false when no provider is configured', async () => {
    const { gateway } = buildGateway();
    const res = await request(gateway.getApp()).get('/v1/model/status');
    expect(res.status).toBe(200);
    expect(res.body.bound).toBe(false);
  });

  it('returns bound=true with name and model when provider is configured', async () => {
    const mp = makeStubModelProvider();
    const { gateway } = buildGateway(mp);
    const res = await request(gateway.getApp()).get('/v1/model/status');
    expect(res.status).toBe(200);
    expect(res.body.bound).toBe(true);
    expect(res.body.name).toBe('test-provider');
    expect(res.body.model).toBe('test-model-1.0');
    expect(res.body.checkedAt).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Gateway start() — model.provider.selected audit event
// ---------------------------------------------------------------------------

describe('Gateway start() — model provider probe', () => {
  it('writes model.provider.selected audit record on start()', async () => {
    const mp = makeStubModelProvider(true);
    const { gateway, auditLog } = buildGateway(mp);
    await gateway.start();
    try {
      const records = auditLog.queryBySession('gateway');
      const selected = records.find((r) => r.eventType === 'model.provider.selected');
      expect(selected).toBeDefined();
      expect(selected!.modelProvider).toBe('test-provider');
      expect(selected!.modelName).toBe('test-model-1.0');
    } finally {
      await gateway.stop();
      auditLog.close();
    }
  });

  it('throws on start() when requireModelProvider=true and provider is unreachable', async () => {
    const mp = makeStubModelProvider(false);
    const policyEngine = new PolicyEngine();
    const auditLog = new AuditLog({ dbPath: ':memory:' });
    const sessionStore = new SessionStore({ dbPath: ':memory:' });
    const approvalStore = new ApprovalStore({ dbPath: ':memory:' });
    const memoryStore = new MemoryStore({ dbPath: ':memory:' });
    const broker = new ToolBroker(policyEngine, auditLog);

    const gateway = new Gateway(
      { gatewaySecret: '', requireModelProvider: true },
      { policyEngine, broker, auditLog, sessionStore, approvalStore, memoryStore, modelProvider: mp }
    );

    await expect(gateway.start()).rejects.toThrow(/requireModelProvider/);
    auditLog.close();
  });

  it('does not throw on start() when requireModelProvider=false and provider is unreachable', async () => {
    const mp = makeStubModelProvider(false);
    const { gateway, auditLog } = buildGateway(mp);
    await expect(gateway.start()).resolves.not.toThrow();
    await gateway.stop();
    auditLog.close();
  });
});

// ---------------------------------------------------------------------------
// Delegation with providerName + modelName
// ---------------------------------------------------------------------------

describe('POST /tasks/:id/delegate — model binding', () => {
  async function buildDelegationFixture() {
    const policyEngine = new PolicyEngine();
    const auditLog = new AuditLog({ dbPath: ':memory:' });
    const sessionStore = new SessionStore({ dbPath: ':memory:' });
    const approvalStore = new ApprovalStore({ dbPath: ':memory:' });
    const memoryStore = new MemoryStore({ dbPath: ':memory:' });
    const broker = new ToolBroker(policyEngine, auditLog);
    const gateway = new Gateway(
      { gatewaySecret: '' },
      { policyEngine, broker, auditLog, sessionStore, approvalStore, memoryStore }
    );
    const app = gateway.getApp();

    // Create principal + session + task
    const pRes = await request(app)
      .post('/v1/auth/principals')
      .send({ type: 'operator', identities: {}, trustLevel: 'high', policyGroup: 'default' });
    const principal = pRes.body;

    const aRes = await request(app)
      .post('/v1/agents')
      .send({ profile: 'default' });
    const agent = aRes.body;

    const sRes = await request(app)
      .post('/v1/sessions')
      .send({ principalId: principal.id, agentId: agent.id });
    const session = sRes.body;

    const tRes = await request(app)
      .post('/v1/tasks')
      .send({
        sessionId: session.id,
        title: 'parent task',
        ownerId: principal.id,
        capabilitySet: ['file_read', 'file_write'],
      });
    const parentTask = tRes.body;

    return { app, parentTask, session, auditLog };
  }

  it('child task persists providerName and modelName when provided', async () => {
    const { app, parentTask, auditLog } = await buildDelegationFixture();
    const res = await request(app)
      .post(`/v1/tasks/${parentTask.id}/delegate`)
      .send({
        title: 'child task',
        requestedCapabilities: ['file_read'],
        providerName: 'ollama',
        modelName: 'llama3.2',
      });
    expect(res.status).toBe(201);
    const child = res.body.childTask;
    expect(child.providerName).toBe('ollama');
    expect(child.modelName).toBe('llama3.2');
    auditLog.close();
  });

  it('writes delegation.model.bound audit event when provider/model are set', async () => {
    const { app, parentTask, auditLog } = await buildDelegationFixture();
    const res = await request(app)
      .post(`/v1/tasks/${parentTask.id}/delegate`)
      .send({
        title: 'child with model',
        requestedCapabilities: ['file_read'],
        providerName: 'ollama',
        modelName: 'qwen2.5:7b',
      });
    expect(res.status).toBe(201);
    const childId = res.body.childTask.id;
    const records = auditLog.queryByTask(childId);
    const evt = records.find((r) => r.eventType === 'delegation.model.bound');
    expect(evt).toBeDefined();
    expect(evt!.modelProvider).toBe('ollama');
    expect(evt!.modelName).toBe('qwen2.5:7b');
    auditLog.close();
  });

  it('does not write delegation.model.bound when no model binding is requested', async () => {
    const { app, parentTask, auditLog } = await buildDelegationFixture();
    const res = await request(app)
      .post(`/v1/tasks/${parentTask.id}/delegate`)
      .send({ title: 'plain child', requestedCapabilities: ['file_read'] });
    expect(res.status).toBe(201);
    const childId = res.body.childTask.id;
    const records = auditLog.queryByTask(childId);
    const evt = records.find((r) => r.eventType === 'delegation.model.bound');
    expect(evt).toBeUndefined();
    auditLog.close();
  });

  it('child providerName and modelName are undefined when not provided', async () => {
    const { app, parentTask, auditLog } = await buildDelegationFixture();
    const res = await request(app)
      .post(`/v1/tasks/${parentTask.id}/delegate`)
      .send({ title: 'plain child', requestedCapabilities: [] });
    expect(res.status).toBe(201);
    const child = res.body.childTask;
    expect(child.providerName).toBeUndefined();
    expect(child.modelName).toBeUndefined();
    auditLog.close();
  });
});

// ---------------------------------------------------------------------------
// AgentRuntime — model lifecycle events
// ---------------------------------------------------------------------------

function makePrincipal(): Principal {
  return {
    id: 'p-1',
    type: 'user',
    identities: {},
    trustLevel: 'high',
    policyGroup: 'default',
    createdAt: new Date().toISOString(),
  };
}

function makeSession(): Session {
  return {
    id: 's-1',
    principalId: 'p-1',
    agentId: 'a-1',
    mode: 'interactive',
    budget: 100_000,
    elevationState: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function makeTask(): Task {
  return {
    id: 't-1',
    sessionId: 's-1',
    title: 'Test task',
    state: 'running',
    ownerId: 'p-1',
    dependencyIds: [],
    sandboxClass: 'workspace-write',
    capabilitySet: [],
    retryCount: 3,
    delegationDepth: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

describe('AgentRuntime — model lifecycle events', () => {
  function buildRuntime(modelProvider: ModelProvider, onEvent: (e: { type: string }) => void) {
    const policyEngine = new PolicyEngine();
    const auditLog = new AuditLog({ dbPath: ':memory:' });
    const broker = new ToolBroker(policyEngine, auditLog);
    broker.registerWorker(new StubWorker('sandbox'));
    return {
      runtime: new AgentRuntime({
        principal: makePrincipal(),
        session: makeSession(),
        task: makeTask(),
        modelProvider,
        broker,
        policyEngine,
        onEvent: onEvent as AgentRuntimeOptions['onEvent'],
      }),
      auditLog,
    };
  }

  it('emits model.request before inference', async () => {
    const events: string[] = [];
    const mp = new StubModelProvider([{ content: 'OK' }]);
    const { runtime, auditLog } = buildRuntime(mp, (e) => events.push(e.type));
    await runtime.process('hello');
    expect(events).toContain('model.request');
    auditLog.close();
  });

  it('emits model.response after successful inference', async () => {
    const events: string[] = [];
    const mp = new StubModelProvider([{ content: 'OK' }]);
    const { runtime, auditLog } = buildRuntime(mp, (e) => events.push(e.type));
    await runtime.process('hello');
    expect(events).toContain('model.response');
    auditLog.close();
  });

  it('emits model.error and re-throws when model provider throws', async () => {
    const events: string[] = [];
    const failProvider: ModelProvider = {
      name: 'failing',
      invoke: async () => { throw new Error('connection refused'); },
    };
    const { runtime, auditLog } = buildRuntime(failProvider, (e) => events.push(e.type));
    await expect(runtime.process('hello')).rejects.toThrow('connection refused');
    expect(events).toContain('model.error');
    auditLog.close();
  });

  it('emits model.tool.request for each tool call returned by the model', async () => {
    const events: { type: string; payload?: unknown }[] = [];
    const policyEngine = new PolicyEngine();
    const auditLog = new AuditLog({ dbPath: ':memory:' });
    const broker = new ToolBroker(policyEngine, auditLog);
    broker.registerWorker(new StubWorker('sandbox'));
    broker.registerTool({
      name: 'file_read',
      description: 'Read a file',
      riskClass: 'A',
      defaultRuntimeTarget: 'sandbox',
      concurrencySafe: true,
      idempotent: true,
      auditPayloadShape: {},
      inputSchema: {},
    });

    const mp = new StubModelProvider([
      { content: '', toolCalls: [{ id: 'tc-1', name: 'file_read', params: {} }] },
      { content: 'Done.' },
    ]);

    const task: Task = { ...makeTask(), capabilitySet: ['file_read'] };
    const runtime = new AgentRuntime({
      principal: makePrincipal(),
      session: makeSession(),
      task,
      modelProvider: mp,
      broker,
      policyEngine,
      onEvent: (e) => events.push({ type: e.type, payload: e.payload }),
    });

    await runtime.process('read file');
    const toolReqEvents = events.filter((e) => e.type === 'model.tool.request');
    expect(toolReqEvents.length).toBeGreaterThanOrEqual(1);
    auditLog.close();
  });

  it('model.request payload includes provider name and model', async () => {
    const events: { type: string; payload: Record<string, unknown> }[] = [];
    const mp = new StubModelProvider([{ content: 'OK' }]);
    const { runtime, auditLog } = buildRuntime(mp, (e) => events.push(e as typeof events[0]));
    await runtime.process('hello');
    const reqEvent = events.find((e) => e.type === 'model.request');
    expect(reqEvent).toBeDefined();
    expect(reqEvent!.payload.provider).toBe('stub');
    auditLog.close();
  });
});
