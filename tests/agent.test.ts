/**
 * Tests for the agent runtime.
 */

import { AgentRuntime, StubModelProvider } from '../src/core/agent';
import { ToolBroker } from '../src/core/broker';
import { PolicyEngine } from '../src/core/policy';
import { AuditLog } from '../src/core/audit';
import { StubWorker } from '../src/workers/sandbox';
import { Principal, Session, Task, ToolSchema } from '../src/core/types';

// ---------------------------------------------------------------------------
// Helpers
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

function makeTask(capabilitySet: string[] = []): Task {
  return {
    id: 't-1',
    sessionId: 's-1',
    title: 'Test task',
    state: 'running',
    ownerId: 'p-1',
    dependencyIds: [],
    sandboxClass: 'workspace-write',
    capabilitySet,
    retryCount: 3,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function makeToolSchema(name: string, riskClass: ToolSchema['riskClass'] = 'A'): ToolSchema {
  return {
    name,
    description: `Tool ${name}`,
    riskClass,
    defaultRuntimeTarget: 'sandbox',
    concurrencySafe: true,
    idempotent: true,
    auditPayloadShape: {},
    inputSchema: {},
  };
}

function buildBroker() {
  const policyEngine = new PolicyEngine();
  const auditLog = new AuditLog({ dbPath: ':memory:' });
  const broker = new ToolBroker(policyEngine, auditLog);
  broker.registerWorker(new StubWorker('sandbox'));
  return { broker, policyEngine, auditLog };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AgentRuntime', () => {
  it('processes a user message and returns a response', async () => {
    const { broker, policyEngine, auditLog } = buildBroker();
    const modelProvider = new StubModelProvider([
      { content: 'Hello, I can help you with that!' },
    ]);

    const runtime = new AgentRuntime({
      principal: makePrincipal(),
      session: makeSession(),
      task: makeTask(),
      modelProvider,
      broker,
      policyEngine,
    });

    const turn = await runtime.process('What can you do?');
    expect(turn.assistantMessage).toBe('Hello, I can help you with that!');
    expect(turn.toolInvocations).toHaveLength(0);

    auditLog.close();
  });

  it('dispatches tool calls from the model', async () => {
    const { broker, policyEngine, auditLog } = buildBroker();
    broker.registerTool(makeToolSchema('file_read', 'A'));

    const modelProvider = new StubModelProvider([
      // First response: a tool call
      {
        content: '',
        toolCalls: [{ id: 'tc-1', name: 'file_read', params: { path: '/foo.txt' } }],
      },
      // Second response: final answer after tool result
      { content: 'Here is the content of the file.' },
    ]);

    const runtime = new AgentRuntime({
      principal: makePrincipal(),
      session: makeSession(),
      task: makeTask(['file_read']),
      modelProvider,
      broker,
      policyEngine,
    });

    const turn = await runtime.process('Read /foo.txt for me.');
    expect(turn.toolInvocations).toHaveLength(1);
    expect(turn.toolInvocations[0].toolName).toBe('file_read');
    expect(turn.toolInvocations[0].denied).toBe(false);
    expect(turn.assistantMessage).toBe('Here is the content of the file.');

    auditLog.close();
  });

  it('reports denied tool calls in turn output', async () => {
    const { broker, policyEngine, auditLog } = buildBroker();
    broker.registerTool(makeToolSchema('file_read', 'A'));

    const modelProvider = new StubModelProvider([
      {
        content: '',
        // Tool not in capability set
        toolCalls: [{ id: 'tc-1', name: 'file_read', params: {} }],
      },
      { content: 'Could not read the file.' },
    ]);

    const runtime = new AgentRuntime({
      principal: makePrincipal(),
      session: makeSession(),
      task: makeTask([]), // empty capability set
      modelProvider,
      broker,
      policyEngine,
    });

    const turn = await runtime.process('Try to read a file.');
    expect(turn.toolInvocations[0].denied).toBe(true);

    auditLog.close();
  });

  it('emits events for tool execution', async () => {
    const { broker, policyEngine, auditLog } = buildBroker();
    broker.registerTool(makeToolSchema('file_read', 'A'));

    const events: string[] = [];
    const modelProvider = new StubModelProvider([
      { content: '', toolCalls: [{ id: 'tc-1', name: 'file_read', params: {} }] },
      { content: 'Done.' },
    ]);

    const runtime = new AgentRuntime({
      principal: makePrincipal(),
      session: makeSession(),
      task: makeTask(['file_read']),
      modelProvider,
      broker,
      policyEngine,
      onEvent: (event) => events.push(event.type),
    });

    await runtime.process('Read a file.');
    expect(events).toContain('tool.finished');

    auditLog.close();
  });

  it('turn includes remainingBudget equal to starting budget when no usage reported', async () => {
    const { broker, policyEngine, auditLog } = buildBroker();
    const session = makeSession(); // budget: 100_000

    const modelProvider = new StubModelProvider([
      { content: 'No token usage reported.' },
    ]);

    const runtime = new AgentRuntime({
      principal: makePrincipal(),
      session,
      task: makeTask(),
      modelProvider,
      broker,
      policyEngine,
    });

    const turn = await runtime.process('Hello.');
    expect(turn.remainingBudget).toBe(100_000);

    auditLog.close();
  });

  it('turn remainingBudget decreases when usage is reported and onBudgetUpdate is called', async () => {
    const { broker, policyEngine, auditLog } = buildBroker();
    const session = makeSession(); // budget: 100_000

    const modelProvider = new StubModelProvider([
      { content: 'Token-consuming response.', usage: { promptTokens: 10, completionTokens: 50 } },
    ]);

    const budgetUpdates: number[] = [];
    const runtime = new AgentRuntime({
      principal: makePrincipal(),
      session,
      task: makeTask(),
      modelProvider,
      broker,
      policyEngine,
      onBudgetUpdate: (remaining) => budgetUpdates.push(remaining),
    });

    const turn = await runtime.process('Count tokens.');
    expect(turn.remainingBudget).toBe(100_000 - 50);
    expect(budgetUpdates).toContain(100_000 - 50);

    auditLog.close();
  });
});

describe('StubModelProvider', () => {
  it('cycles through responses', async () => {
    const provider = new StubModelProvider([
      { content: 'First' },
      { content: 'Second' },
    ]);

    const r1 = await provider.invoke([], []);
    const r2 = await provider.invoke([], []);
    const r3 = await provider.invoke([], []);

    expect(r1.content).toBe('First');
    expect(r2.content).toBe('Second');
    expect(r3.content).toBe('First'); // cycles
  });

  it('has a default response when no responses provided', async () => {
    const provider = new StubModelProvider();
    const r = await provider.invoke([], []);
    expect(r.content).toBeTruthy();
  });
});
