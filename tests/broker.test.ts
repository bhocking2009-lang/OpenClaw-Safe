/**
 * Tests for the tool broker.
 */

import { ToolBroker } from '../src/core/broker';
import { PolicyEngine } from '../src/core/policy';
import { AuditLog } from '../src/core/audit';
import { StubWorker } from '../src/workers/sandbox';
import { ToolSchema, ToolRequest, PolicyContext, Principal, Session } from '../src/core/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePrincipal(overrides: Partial<Principal> = {}): Principal {
  return {
    id: 'p-1',
    type: 'user',
    identities: {},
    trustLevel: 'high',
    policyGroup: 'default',
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 's-1',
    principalId: 'p-1',
    agentId: 'a-1',
    mode: 'interactive',
    budget: 100_000,
    elevationState: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makePolicyCtx(overrides: Partial<PolicyContext> = {}): PolicyContext {
  return {
    principal: makePrincipal(),
    session: makeSession(),
    toolName: 'file_read',
    toolRiskClass: 'A',
    runtimeTarget: 'sandbox',
    approvalState: 'pending',
    ...overrides,
  };
}

function makeToolSchema(overrides: Partial<ToolSchema> = {}): ToolSchema {
  return {
    name: 'file_read',
    description: 'Read a file from the workspace',
    riskClass: 'A',
    defaultRuntimeTarget: 'sandbox',
    concurrencySafe: true,
    idempotent: true,
    auditPayloadShape: { path: 'string' },
    inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
    ...overrides,
  };
}

function makeRequest(overrides: Partial<ToolRequest> = {}): ToolRequest {
  return {
    id: 'req-1',
    sessionId: 's-1',
    taskId: 't-1',
    toolName: 'file_read',
    params: { path: '/workspace/foo.txt' },
    principalId: 'p-1',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ToolBroker', () => {
  let broker: ToolBroker;
  let auditLog: AuditLog;

  beforeEach(() => {
    const policyEngine = new PolicyEngine();
    auditLog = new AuditLog({ dbPath: ':memory:' });
    broker = new ToolBroker(policyEngine, auditLog);
    broker.registerWorker(new StubWorker('sandbox'));
    broker.registerWorker(new StubWorker('browser_worker'));
    broker.registerWorker(new StubWorker('host_elevated'));
  });

  afterEach(() => {
    auditLog.close();
  });

  it('returns denied when tool is not in registry', async () => {
    const result = await broker.dispatch(
      makeRequest({ toolName: 'unknown_tool' }),
      makePolicyCtx({ toolName: 'unknown_tool' }),
      { capabilitySet: ['unknown_tool'], sandboxClass: 'workspace-write' }
    );
    expect(result.denied).toBe(true);
    expect(result.policyDecision.reason).toMatch(/not found/i);
  });

  it('returns denied when tool is not in task capability set', async () => {
    broker.registerTool(makeToolSchema());
    const result = await broker.dispatch(
      makeRequest(),
      makePolicyCtx(),
      { capabilitySet: [], sandboxClass: 'workspace-write' }  // empty capability set
    );
    expect(result.denied).toBe(true);
    expect(result.policyDecision.reason).toMatch(/capability set/i);
  });

  it('executes allowed Class A tool via sandbox worker', async () => {
    broker.registerTool(makeToolSchema());
    const result = await broker.dispatch(
      makeRequest(),
      makePolicyCtx(),
      { capabilitySet: ['file_read'], sandboxClass: 'workspace-write' }
    );
    expect(result.denied).toBe(false);
    expect(result.receipt).toBeDefined();
    expect(result.receipt?.exitCode).toBe(0);
  });

  it('routes Class C tool to sandbox runtime target', async () => {
    broker.registerTool(
      makeToolSchema({ name: 'run_tests', riskClass: 'C', defaultRuntimeTarget: 'sandbox' })
    );
    const result = await broker.dispatch(
      makeRequest({ toolName: 'run_tests' }),
      makePolicyCtx({ toolName: 'run_tests', toolRiskClass: 'C', runtimeTarget: 'sandbox' }),
      { capabilitySet: ['run_tests'], sandboxClass: 'workspace-write' }
    );
    expect(result.denied).toBe(false);
    expect(result.policyDecision.allowedRuntimeTarget).toBe('sandbox');
  });

  it('denies Class F without host elevation', async () => {
    broker.registerTool(
      makeToolSchema({ name: 'exec_host', riskClass: 'F', defaultRuntimeTarget: 'host_elevated' })
    );
    const result = await broker.dispatch(
      makeRequest({ toolName: 'exec_host' }),
      makePolicyCtx({
        toolName: 'exec_host',
        toolRiskClass: 'F',
        runtimeTarget: 'host_elevated',
        session: makeSession({ elevationState: false }),
      }),
      { capabilitySet: ['exec_host'], sandboxClass: 'workspace-write' }
    );
    expect(result.denied).toBe(true);
  });

  it('allows Class F with host elevation granted', async () => {
    broker.registerTool(
      makeToolSchema({ name: 'exec_host', riskClass: 'F', defaultRuntimeTarget: 'host_elevated' })
    );
    const result = await broker.dispatch(
      makeRequest({ toolName: 'exec_host' }),
      makePolicyCtx({
        toolName: 'exec_host',
        toolRiskClass: 'F',
        runtimeTarget: 'host_elevated',
        principal: makePrincipal({ type: 'system' }),
        session: makeSession({ elevationState: true }),
      }),
      { capabilitySet: ['exec_host'], sandboxClass: 'workspace-write' }
    );
    // System principal triggers system-allow rule first
    expect(result.denied).toBe(false);
  });

  it('requires approval and calls resolver for Class E medium-trust', async () => {
    broker.registerTool(
      makeToolSchema({ name: 'send_message', riskClass: 'E', defaultRuntimeTarget: 'sandbox' })
    );

    let resolverCalled = false;
    const approvalResolver = async () => {
      resolverCalled = true;
      return 'approved' as const;
    };

    const policyEngine = new PolicyEngine();
    const localLog = new AuditLog({ dbPath: ':memory:' });
    const localBroker = new ToolBroker(policyEngine, localLog, approvalResolver);
    localBroker.registerWorker(new StubWorker('sandbox'));
    localBroker.registerTool(
      makeToolSchema({ name: 'send_message', riskClass: 'E', defaultRuntimeTarget: 'sandbox' })
    );

    const result = await localBroker.dispatch(
      makeRequest({ toolName: 'send_message' }),
      makePolicyCtx({
        toolName: 'send_message',
        toolRiskClass: 'E',
        runtimeTarget: 'sandbox',
        principal: makePrincipal({ trustLevel: 'medium' }),
      }),
      { capabilitySet: ['send_message'], sandboxClass: 'workspace-write' }
    );

    expect(resolverCalled).toBe(true);
    expect(result.denied).toBe(false);
    expect(result.approvalOutcome).toBe('approved');
    localLog.close();
  });

  it('denies when approval is rejected', async () => {
    const approvalResolver = async () => 'denied' as const;

    const policyEngine = new PolicyEngine();
    const localLog = new AuditLog({ dbPath: ':memory:' });
    const localBroker = new ToolBroker(policyEngine, localLog, approvalResolver);
    localBroker.registerWorker(new StubWorker('sandbox'));
    localBroker.registerTool(
      makeToolSchema({ name: 'send_message', riskClass: 'E', defaultRuntimeTarget: 'sandbox' })
    );

    const result = await localBroker.dispatch(
      makeRequest({ toolName: 'send_message' }),
      makePolicyCtx({
        toolName: 'send_message',
        toolRiskClass: 'E',
        runtimeTarget: 'sandbox',
        principal: makePrincipal({ trustLevel: 'medium' }),
      }),
      { capabilitySet: ['send_message'], sandboxClass: 'workspace-write' }
    );

    expect(result.denied).toBe(true);
    expect(result.approvalOutcome).toBe('denied');
    localLog.close();
  });

  it('writes audit records for tool execution', async () => {
    broker.registerTool(makeToolSchema({ name: 'file_write', riskClass: 'B', defaultRuntimeTarget: 'sandbox' }));
    await broker.dispatch(
      makeRequest({ toolName: 'file_write' }),
      makePolicyCtx({ toolName: 'file_write', toolRiskClass: 'B' }),
      { capabilitySet: ['file_write'], sandboxClass: 'workspace-write' }
    );

    const records = auditLog.queryBySession('s-1');
    expect(records.length).toBeGreaterThanOrEqual(1);
    expect(records.some((r) => r.toolName === 'file_write')).toBe(true);
  });

  it('listTools returns registered schemas', () => {
    broker.registerTool(makeToolSchema());
    broker.registerTool(makeToolSchema({ name: 'file_write', riskClass: 'B' }));
    expect(broker.listTools()).toHaveLength(2);
  });

  it('visibleTools filters by policy', () => {
    broker.registerTool(makeToolSchema({ name: 'file_read', riskClass: 'A' }));
    broker.registerTool(makeToolSchema({ name: 'exec_host', riskClass: 'F', defaultRuntimeTarget: 'host_elevated' }));

    const visible = broker.visibleTools({
      principal: makePrincipal({ trustLevel: 'low' }),
      session: makeSession(),
      approvalState: 'pending',
    });
    // file_read (Class A) should be visible; exec_host (Class F) → host_elevated_only (not deny)
    const names = visible.map((t) => t.name);
    expect(names).toContain('file_read');
  });
});
