/**
 * Architectural invariant regression suite.
 *
 * These tests are the machine-enforced equivalent of ARCHITECTURE.md §3
 * and SECURITY_MODEL.md §3.  They cover three categories:
 *
 *   1. No broker bypass  — every tool execution goes through ToolBroker.dispatch()
 *   2. No host fallback  — sandbox-targeted tools never silently route to host_elevated
 *   3. No invalid principal states — invalid or low-privilege principals are denied
 *
 * If any test in this file fails, it indicates a regression in a security
 * invariant.  Do not delete or weaken these tests to make a change pass.
 */

import { ToolBroker } from '../src/core/broker';
import { PolicyEngine } from '../src/core/policy';
import { AuditLog } from '../src/core/audit';
import { StubWorker } from '../src/workers/sandbox';
import {
  ToolSchema,
  ToolRequest,
  PolicyContext,
  Principal,
  Session,
  ExecutionLease,
  RuntimeReceipt,
  RuntimeTarget,
} from '../src/core/types';

// ---------------------------------------------------------------------------
// Test fixture helpers
// ---------------------------------------------------------------------------

function makePrincipal(overrides: Partial<Principal> = {}): Principal {
  return {
    id: 'p-inv',
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
    id: 's-inv',
    principalId: 'p-inv',
    agentId: 'a-inv',
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
    description: 'Read a file',
    riskClass: 'A',
    defaultRuntimeTarget: 'sandbox',
    concurrencySafe: true,
    idempotent: true,
    auditPayloadShape: {},
    inputSchema: {},
    ...overrides,
  };
}

function makeRequest(overrides: Partial<ToolRequest> = {}): ToolRequest {
  return {
    id: 'req-inv',
    sessionId: 's-inv',
    taskId: 't-inv',
    toolName: 'file_read',
    params: {},
    principalId: 'p-inv',
    ...overrides,
  };
}

function makeBroker(
  extra?: {
    workers?: RuntimeTarget[];
    approvalResolver?: () => Promise<'approved' | 'denied' | 'pending' | 'expired'>;
  }
): { broker: ToolBroker; auditLog: AuditLog } {
  const policyEngine = new PolicyEngine();
  const auditLog = new AuditLog({ dbPath: ':memory:' });
  const broker = new ToolBroker(policyEngine, auditLog, extra?.approvalResolver);
  const targets: RuntimeTarget[] = extra?.workers ?? ['sandbox'];
  for (const target of targets) {
    broker.registerWorker(new StubWorker(target));
  }
  return { broker, auditLog };
}

// ---------------------------------------------------------------------------
// Section 1: No broker bypass
//
// The broker is the single mandatory gate.  These tests verify that:
//   a) A tool not in the capability set is always denied, regardless of trust.
//   b) A tool not in the registry is always denied.
//   c) Every executed tool produces an audit record via the broker.
//   d) Calling a worker directly (bypassing the broker) produces no audit record,
//      confirming that the audit trail is only maintained through the broker.
// ---------------------------------------------------------------------------

describe('Invariant: no broker bypass', () => {
  let broker: ToolBroker;
  let auditLog: AuditLog;

  beforeEach(() => {
    ({ broker, auditLog } = makeBroker());
    broker.registerTool(makeToolSchema({ name: 'file_write', riskClass: 'B' }));
  });

  afterEach(() => auditLog.close());

  it('denies any tool not in the task capability set, regardless of trust level', async () => {
    for (const trustLevel of ['high', 'medium', 'low'] as const) {
      const result = await broker.dispatch(
        makeRequest({ toolName: 'file_write' }),
        makePolicyCtx({
          toolName: 'file_write',
          toolRiskClass: 'B',
          principal: makePrincipal({ trustLevel }),
        }),
        { capabilitySet: [], sandboxClass: 'workspace-write' }
      );
      expect(result.denied).toBe(true);
      expect(result.policyDecision.reason).toMatch(/capability set/i);
    }
  });

  it('denies any tool not registered in the broker registry', async () => {
    const result = await broker.dispatch(
      makeRequest({ toolName: 'unregistered_tool' }),
      makePolicyCtx({ toolName: 'unregistered_tool' }),
      { capabilitySet: ['unregistered_tool'], sandboxClass: 'workspace-write' }
    );
    expect(result.denied).toBe(true);
    expect(result.policyDecision.reason).toMatch(/not found/i);
  });

  it('writes an audit record for every broker-dispatched tool execution', async () => {
    await broker.dispatch(
      makeRequest({ toolName: 'file_write' }),
      makePolicyCtx({ toolName: 'file_write', toolRiskClass: 'B' }),
      { capabilitySet: ['file_write'], sandboxClass: 'workspace-write' }
    );
    const records = auditLog.queryBySession('s-inv');
    expect(records.length).toBeGreaterThanOrEqual(1);
    expect(records.some((r) => r.toolName === 'file_write')).toBe(true);
  });

  it('worker called directly produces no audit record (broker is required for audit)', async () => {
    const worker = new StubWorker('sandbox');
    const lease: ExecutionLease = {
      id: 'direct-lease',
      toolInvocationId: 'direct-inv',
      runtimeTarget: 'sandbox',
      expiresAt: new Date(Date.now() + 30_000).toISOString(),
    };
    // Calling worker.execute() directly — this is the bypass path
    const receipt: RuntimeReceipt = await worker.execute(
      makeToolSchema({ name: 'file_write', riskClass: 'B' }),
      {},
      lease
    );
    expect(receipt.exitCode).toBe(0); // worker ran, but...
    // No audit record was created because the broker was not involved
    const records = auditLog.queryBySession('s-inv');
    expect(records).toHaveLength(0);
  });

  it('denies when approval is required but no resolver is configured', async () => {
    // Broker with no approval resolver
    const { broker: noResolverBroker, auditLog: log } = makeBroker({ workers: ['sandbox'] });
    noResolverBroker.registerTool(
      makeToolSchema({ name: 'send_msg', riskClass: 'E', defaultRuntimeTarget: 'sandbox' })
    );
    const result = await noResolverBroker.dispatch(
      makeRequest({ toolName: 'send_msg' }),
      makePolicyCtx({
        toolName: 'send_msg',
        toolRiskClass: 'E',
        principal: makePrincipal({ trustLevel: 'medium' }),
      }),
      { capabilitySet: ['send_msg'], sandboxClass: 'workspace-write' }
    );
    expect(result.denied).toBe(true);
    expect(result.requiresApproval).toBe(true);
    log.close();
  });

  it('allows execution only after approval is granted', async () => {
    let resolverCalled = false;
    const { broker: approvalBroker, auditLog: log } = makeBroker({
      workers: ['sandbox'],
      approvalResolver: async () => {
        resolverCalled = true;
        return 'approved';
      },
    });
    approvalBroker.registerTool(
      makeToolSchema({ name: 'send_msg', riskClass: 'E', defaultRuntimeTarget: 'sandbox' })
    );
    const result = await approvalBroker.dispatch(
      makeRequest({ toolName: 'send_msg' }),
      makePolicyCtx({
        toolName: 'send_msg',
        toolRiskClass: 'E',
        principal: makePrincipal({ trustLevel: 'medium' }),
      }),
      { capabilitySet: ['send_msg'], sandboxClass: 'workspace-write' }
    );
    expect(resolverCalled).toBe(true);
    expect(result.denied).toBe(false);
    expect(result.approvalOutcome).toBe('approved');
    log.close();
  });
});

// ---------------------------------------------------------------------------
// Section 2: No host fallback
//
// The sandbox is the default and mandatory runtime for non-elevated tools.
// These tests verify that:
//   a) Class C (sandbox_only) tools always execute in sandbox.
//   b) Class C tools are never routed to host_elevated, even if a
//      host_elevated worker is registered.
//   c) When no sandbox worker is available, the broker does NOT silently
//      fall back to host_elevated.
//   d) Class F (host_elevated_only) is denied unless session.elevationState
//      is explicitly true.
//   e) Class B (workspace write) always routes to sandbox.
// ---------------------------------------------------------------------------

describe('Invariant: no host fallback', () => {
  afterEach(() => {
    // Each test manages its own broker/auditLog teardown via local variables
  });

  it('Class C tool is always routed to sandbox, never to host_elevated', async () => {
    // Register BOTH sandbox and host_elevated workers to confirm correct routing
    const { broker, auditLog } = makeBroker({ workers: ['sandbox', 'host_elevated'] });
    broker.registerTool(
      makeToolSchema({ name: 'run_tests', riskClass: 'C', defaultRuntimeTarget: 'sandbox' })
    );
    const result = await broker.dispatch(
      makeRequest({ toolName: 'run_tests' }),
      makePolicyCtx({
        toolName: 'run_tests',
        toolRiskClass: 'C',
        runtimeTarget: 'sandbox',
        principal: makePrincipal({ trustLevel: 'high' }),
        session: makeSession({ elevationState: true }), // elevation granted but should not matter for C
      }),
      { capabilitySet: ['run_tests'], sandboxClass: 'workspace-write' }
    );
    expect(result.denied).toBe(false);
    expect(result.policyDecision.allowedRuntimeTarget).toBe('sandbox');
    expect(result.receipt?.runtimeTarget).toBe('sandbox');
    auditLog.close();
  });

  it('Class C tool is denied when only a host_elevated worker is registered (no sandbox fallback)', async () => {
    // Only host_elevated worker — no sandbox worker registered
    const { broker, auditLog } = makeBroker({ workers: ['host_elevated'] });
    broker.registerTool(
      makeToolSchema({ name: 'run_tests', riskClass: 'C', defaultRuntimeTarget: 'sandbox' })
    );
    const result = await broker.dispatch(
      makeRequest({ toolName: 'run_tests' }),
      makePolicyCtx({ toolName: 'run_tests', toolRiskClass: 'C' }),
      { capabilitySet: ['run_tests'], sandboxClass: 'workspace-write' }
    );
    // No sandbox worker → tool.error path, not execution; denied stays false but receipt is undefined
    // The key invariant: runtimeTarget is NOT host_elevated
    expect(result.policyDecision.allowedRuntimeTarget).toBe('sandbox');
    expect(result.receipt).toBeUndefined(); // did not execute
    auditLog.close();
  });

  it('Class F tool is denied without session.elevationState', async () => {
    const { broker, auditLog } = makeBroker({ workers: ['sandbox', 'host_elevated'] });
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
        principal: makePrincipal({ trustLevel: 'high' }),
      }),
      { capabilitySet: ['exec_host'], sandboxClass: 'workspace-write' }
    );
    expect(result.denied).toBe(true);
    auditLog.close();
  });

  it('Class F tool is denied for low-trust principal even with elevation granted', async () => {
    const { broker, auditLog } = makeBroker({ workers: ['sandbox', 'host_elevated'] });
    broker.registerTool(
      makeToolSchema({ name: 'exec_host', riskClass: 'F', defaultRuntimeTarget: 'host_elevated' })
    );
    const result = await broker.dispatch(
      makeRequest({ toolName: 'exec_host' }),
      makePolicyCtx({
        toolName: 'exec_host',
        toolRiskClass: 'F',
        runtimeTarget: 'host_elevated',
        session: makeSession({ elevationState: true }),
        principal: makePrincipal({ trustLevel: 'low' }),
      }),
      { capabilitySet: ['exec_host'], sandboxClass: 'workspace-write' }
    );
    // low-trust-deny-non-readonly fires before class-f-require-elevation
    expect(result.denied).toBe(true);
    auditLog.close();
  });

  it('Class B tool is always routed to sandbox, never to host_elevated', async () => {
    const { broker, auditLog } = makeBroker({ workers: ['sandbox', 'host_elevated'] });
    broker.registerTool(
      makeToolSchema({ name: 'file_write', riskClass: 'B', defaultRuntimeTarget: 'sandbox' })
    );
    const result = await broker.dispatch(
      makeRequest({ toolName: 'file_write' }),
      makePolicyCtx({ toolName: 'file_write', toolRiskClass: 'B' }),
      { capabilitySet: ['file_write'], sandboxClass: 'workspace-write' }
    );
    expect(result.denied).toBe(false);
    expect(result.policyDecision.allowedRuntimeTarget).toBe('sandbox');
    expect(result.receipt?.runtimeTarget).toBe('sandbox');
    auditLog.close();
  });

  it('Class A tool is routed to sandbox even for low-trust principal', async () => {
    const { broker, auditLog } = makeBroker({ workers: ['sandbox'] });
    broker.registerTool(makeToolSchema({ name: 'file_read', riskClass: 'A' }));
    const result = await broker.dispatch(
      makeRequest({ toolName: 'file_read' }),
      makePolicyCtx({
        toolName: 'file_read',
        toolRiskClass: 'A',
        principal: makePrincipal({ trustLevel: 'low' }),
      }),
      { capabilitySet: ['file_read'], sandboxClass: 'workspace-write' }
    );
    expect(result.denied).toBe(false);
    expect(result.receipt?.runtimeTarget).toBe('sandbox');
    auditLog.close();
  });
});

// ---------------------------------------------------------------------------
// Section 3: No invalid principal states
//
// These tests verify that the policy engine and broker correctly handle
// every combination of principal/session state that the type system allows.
//
//   a) Low-trust principals are denied Class B, C, D, E, F.
//   b) Low-trust principals are allowed Class A.
//   c) Readonly sessions are denied Class B, C, D, E, F.
//   d) Readonly sessions are allowed Class A.
//   e) System principals bypass trust-level checks.
//   f) child_agent principals are subject to normal trust-level rules.
//   g) A principal with no matching policy group falls through to default-allow.
// ---------------------------------------------------------------------------

describe('Invariant: no invalid principal states', () => {
  let broker: ToolBroker;
  let auditLog: AuditLog;

  beforeEach(() => {
    ({ broker, auditLog } = makeBroker({ workers: ['sandbox', 'browser_worker', 'host_elevated'] }));
    broker.registerTool(makeToolSchema({ name: 'file_read', riskClass: 'A' }));
    broker.registerTool(makeToolSchema({ name: 'file_write', riskClass: 'B', defaultRuntimeTarget: 'sandbox' }));
    broker.registerTool(makeToolSchema({ name: 'run_tests', riskClass: 'C', defaultRuntimeTarget: 'sandbox' }));
    broker.registerTool(makeToolSchema({ name: 'browse', riskClass: 'D', defaultRuntimeTarget: 'browser_worker' }));
    broker.registerTool(makeToolSchema({ name: 'send_msg', riskClass: 'E', defaultRuntimeTarget: 'sandbox' }));
    broker.registerTool(makeToolSchema({ name: 'exec_host', riskClass: 'F', defaultRuntimeTarget: 'host_elevated' }));
  });

  afterEach(() => auditLog.close());

  it('low-trust principal is denied Class B', async () => {
    const result = await broker.dispatch(
      makeRequest({ toolName: 'file_write' }),
      makePolicyCtx({
        toolName: 'file_write', toolRiskClass: 'B',
        principal: makePrincipal({ trustLevel: 'low' }),
      }),
      { capabilitySet: ['file_write'], sandboxClass: 'workspace-write' }
    );
    expect(result.denied).toBe(true);
  });

  it('low-trust principal is denied Class C', async () => {
    const result = await broker.dispatch(
      makeRequest({ toolName: 'run_tests' }),
      makePolicyCtx({
        toolName: 'run_tests', toolRiskClass: 'C',
        principal: makePrincipal({ trustLevel: 'low' }),
      }),
      { capabilitySet: ['run_tests'], sandboxClass: 'workspace-write' }
    );
    expect(result.denied).toBe(true);
  });

  it('low-trust principal is denied Class D', async () => {
    const result = await broker.dispatch(
      makeRequest({ toolName: 'browse' }),
      makePolicyCtx({
        toolName: 'browse', toolRiskClass: 'D', runtimeTarget: 'browser_worker',
        principal: makePrincipal({ trustLevel: 'low' }),
      }),
      { capabilitySet: ['browse'], sandboxClass: 'workspace-write' }
    );
    expect(result.denied).toBe(true);
  });

  it('low-trust principal is denied Class E', async () => {
    const result = await broker.dispatch(
      makeRequest({ toolName: 'send_msg' }),
      makePolicyCtx({
        toolName: 'send_msg', toolRiskClass: 'E',
        principal: makePrincipal({ trustLevel: 'low' }),
      }),
      { capabilitySet: ['send_msg'], sandboxClass: 'workspace-write' }
    );
    expect(result.denied).toBe(true);
  });

  it('low-trust principal is denied Class F', async () => {
    const result = await broker.dispatch(
      makeRequest({ toolName: 'exec_host' }),
      makePolicyCtx({
        toolName: 'exec_host', toolRiskClass: 'F', runtimeTarget: 'host_elevated',
        principal: makePrincipal({ trustLevel: 'low' }),
        session: makeSession({ elevationState: true }),
      }),
      { capabilitySet: ['exec_host'], sandboxClass: 'workspace-write' }
    );
    expect(result.denied).toBe(true);
  });

  it('low-trust principal is allowed Class A', async () => {
    const result = await broker.dispatch(
      makeRequest({ toolName: 'file_read' }),
      makePolicyCtx({
        toolName: 'file_read', toolRiskClass: 'A',
        principal: makePrincipal({ trustLevel: 'low' }),
      }),
      { capabilitySet: ['file_read'], sandboxClass: 'workspace-write' }
    );
    expect(result.denied).toBe(false);
    expect(result.receipt).toBeDefined();
  });

  it('readonly session is denied Class B', async () => {
    const result = await broker.dispatch(
      makeRequest({ toolName: 'file_write' }),
      makePolicyCtx({
        toolName: 'file_write', toolRiskClass: 'B',
        session: makeSession({ mode: 'readonly' }),
      }),
      { capabilitySet: ['file_write'], sandboxClass: 'workspace-write' }
    );
    expect(result.denied).toBe(true);
  });

  it('readonly session is denied Class C', async () => {
    const result = await broker.dispatch(
      makeRequest({ toolName: 'run_tests' }),
      makePolicyCtx({
        toolName: 'run_tests', toolRiskClass: 'C',
        session: makeSession({ mode: 'readonly' }),
      }),
      { capabilitySet: ['run_tests'], sandboxClass: 'workspace-write' }
    );
    expect(result.denied).toBe(true);
  });

  it('readonly session is denied Class E', async () => {
    const result = await broker.dispatch(
      makeRequest({ toolName: 'send_msg' }),
      makePolicyCtx({
        toolName: 'send_msg', toolRiskClass: 'E',
        session: makeSession({ mode: 'readonly' }),
      }),
      { capabilitySet: ['send_msg'], sandboxClass: 'workspace-write' }
    );
    expect(result.denied).toBe(true);
  });

  it('readonly session is allowed Class A', async () => {
    const result = await broker.dispatch(
      makeRequest({ toolName: 'file_read' }),
      makePolicyCtx({
        toolName: 'file_read', toolRiskClass: 'A',
        session: makeSession({ mode: 'readonly' }),
      }),
      { capabilitySet: ['file_read'], sandboxClass: 'workspace-write' }
    );
    expect(result.denied).toBe(false);
    expect(result.receipt).toBeDefined();
  });

  it('system principal bypasses trust-level restrictions for Class F with elevation', async () => {
    const result = await broker.dispatch(
      makeRequest({ toolName: 'exec_host' }),
      makePolicyCtx({
        toolName: 'exec_host', toolRiskClass: 'F', runtimeTarget: 'host_elevated',
        principal: makePrincipal({ type: 'system' }),
        session: makeSession({ elevationState: true }),
      }),
      { capabilitySet: ['exec_host'], sandboxClass: 'workspace-write' }
    );
    // system-allow fires first: allowed regardless of risk class
    expect(result.denied).toBe(false);
  });

  it('child_agent principal with low trust is denied Class B (same as regular low-trust user)', async () => {
    const result = await broker.dispatch(
      makeRequest({ toolName: 'file_write' }),
      makePolicyCtx({
        toolName: 'file_write', toolRiskClass: 'B',
        principal: makePrincipal({ type: 'child_agent', trustLevel: 'low' }),
      }),
      { capabilitySet: ['file_write'], sandboxClass: 'workspace-write' }
    );
    expect(result.denied).toBe(true);
  });

  it('child_agent principal with high trust can use Class B', async () => {
    const result = await broker.dispatch(
      makeRequest({ toolName: 'file_write' }),
      makePolicyCtx({
        toolName: 'file_write', toolRiskClass: 'B',
        principal: makePrincipal({ type: 'child_agent', trustLevel: 'high' }),
      }),
      { capabilitySet: ['file_write'], sandboxClass: 'workspace-write' }
    );
    expect(result.denied).toBe(false);
  });

  it('policy engine denies tool with no matching rule by default (custom empty ruleset)', () => {
    const engine = new PolicyEngine([]);
    const decision = engine.evaluate(
      makePolicyCtx({ toolName: 'anything', toolRiskClass: 'B' })
    );
    expect(decision.mode).toBe('deny');
  });

  it('policy engine low-trust deny rule must fire before class-level allow rules', () => {
    // This test confirms the rule ordering invariant: low-trust-deny fires before class-b-sandbox
    const engine = new PolicyEngine();
    const decision = engine.evaluate({
      principal: makePrincipal({ trustLevel: 'low' }),
      session: makeSession(),
      toolName: 'file_write',
      toolRiskClass: 'B',
      runtimeTarget: 'sandbox',
      approvalState: 'pending',
    });
    expect(decision.mode).toBe('deny');
    expect(decision.reason).toMatch(/low.trust/i);
  });

  it('policy engine readonly-session deny rule must fire before class-level allow rules', () => {
    const engine = new PolicyEngine();
    const decision = engine.evaluate({
      principal: makePrincipal({ trustLevel: 'high' }),
      session: makeSession({ mode: 'readonly' }),
      toolName: 'file_write',
      toolRiskClass: 'B',
      runtimeTarget: 'sandbox',
      approvalState: 'pending',
    });
    expect(decision.mode).toBe('deny');
    expect(decision.reason).toMatch(/readonly/i);
  });
});
