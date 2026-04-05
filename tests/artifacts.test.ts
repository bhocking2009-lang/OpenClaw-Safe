/**
 * Tests for the ArtifactStore and broker artifact persistence.
 */

import { ArtifactStore } from '../src/core/artifacts';
import { ToolBroker } from '../src/core/broker';
import { PolicyEngine } from '../src/core/policy';
import { AuditLog } from '../src/core/audit';
import { ToolSchema, ToolRequest, PolicyContext, Principal, Session, ArtifactRef } from '../src/core/types';
import { WorkerExecutor } from '../src/core/broker';
import { ExecutionLease, RuntimeReceipt } from '../src/core/types';

// ---------------------------------------------------------------------------
// ArtifactStore unit tests
// ---------------------------------------------------------------------------

describe('ArtifactStore', () => {
  let store: ArtifactStore;

  beforeEach(() => {
    store = new ArtifactStore({ dbPath: ':memory:' });
  });

  afterEach(() => store.close());

  it('stores and retrieves an artifact by id', () => {
    const artifact = store.store({
      type: 'file',
      uri: '/workspace/out.txt',
      provenanceId: 'task-1',
      checksum: 'abc123',
    });

    expect(artifact.id).toBeTruthy();
    expect(artifact.type).toBe('file');
    expect(artifact.uri).toBe('/workspace/out.txt');
    expect(artifact.provenanceId).toBe('task-1');
    expect(artifact.checksum).toBe('abc123');
    expect(artifact.retentionClass).toBe('session'); // default

    const fetched = store.getById(artifact.id);
    expect(fetched).toEqual(artifact);
  });

  it('supports custom retentionClass', () => {
    const artifact = store.store({
      type: 'log',
      uri: '/logs/run.log',
      provenanceId: 'task-2',
      checksum: 'def456',
      retentionClass: 'permanent',
    });
    expect(artifact.retentionClass).toBe('permanent');
  });

  it('listByProvenance returns artifacts for a given provenanceId', () => {
    store.store({ type: 'file', uri: '/a', provenanceId: 'task-x', checksum: 'c1' });
    store.store({ type: 'diff', uri: '/b', provenanceId: 'task-x', checksum: 'c2' });
    store.store({ type: 'log', uri: '/c', provenanceId: 'task-y', checksum: 'c3' });

    const forX = store.listByProvenance('task-x');
    expect(forX).toHaveLength(2);
    expect(forX.map((a) => a.uri)).toContain('/a');
    expect(forX.map((a) => a.uri)).toContain('/b');
  });

  it('listAll returns all stored artifacts', () => {
    store.store({ type: 'file', uri: '/1', provenanceId: 'p1', checksum: 'c1' });
    store.store({ type: 'file', uri: '/2', provenanceId: 'p2', checksum: 'c2' });

    const all = store.listAll();
    expect(all.length).toBeGreaterThanOrEqual(2);
  });

  it('returns undefined for non-existent id', () => {
    expect(store.getById('no-such-id')).toBeUndefined();
  });

  it('deleteById removes the artifact', () => {
    const artifact = store.store({
      type: 'file',
      uri: '/del',
      provenanceId: 'p1',
      checksum: 'x',
    });
    store.deleteById(artifact.id);
    expect(store.getById(artifact.id)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Broker artifact persistence integration
// ---------------------------------------------------------------------------

/**
 * A worker that returns a receipt with artifacts.
 */
class ArtifactWorker implements WorkerExecutor {
  readonly runtimeTarget = 'sandbox' as const;

  async execute(
    _tool: ToolSchema,
    _params: Record<string, unknown>,
    lease: ExecutionLease
  ): Promise<RuntimeReceipt> {
    const now = new Date().toISOString();
    const artifactRef: ArtifactRef = {
      id: 'artifact-ref-1',
      uri: '/workspace/result.txt',
      checksum: 'sha256:deadbeef',
    };
    return {
      invocationId: lease.toolInvocationId,
      runtimeTarget: 'sandbox',
      sandboxId: lease.id,
      exitCode: 0,
      stdout: 'done',
      stderr: '',
      fileDiffs: ['+/workspace/result.txt'],
      artifacts: [artifactRef],
      startedAt: now,
      finishedAt: now,
    };
  }
}

describe('ToolBroker artifact persistence', () => {
  let artifactStore: ArtifactStore;
  let auditLog: AuditLog;
  let broker: ToolBroker;

  beforeEach(() => {
    artifactStore = new ArtifactStore({ dbPath: ':memory:' });
    auditLog = new AuditLog({ dbPath: ':memory:' });
    const policyEngine = new PolicyEngine();
    broker = new ToolBroker(policyEngine, auditLog, undefined, artifactStore);
    broker.registerWorker(new ArtifactWorker());
    broker.registerTool({
      name: 'build',
      description: 'Build project',
      riskClass: 'C',
      defaultRuntimeTarget: 'sandbox',
      concurrencySafe: false,
      idempotent: false,
      auditPayloadShape: {},
      inputSchema: {},
    });
  });

  afterEach(() => {
    auditLog.close();
    artifactStore.close();
  });

  function makePrincipal(): Principal {
    return {
      id: 'p-art',
      type: 'user',
      identities: {},
      trustLevel: 'high',
      policyGroup: 'default',
      createdAt: new Date().toISOString(),
    };
  }

  function makeSession(): Session {
    return {
      id: 's-art',
      principalId: 'p-art',
      agentId: 'a-art',
      mode: 'interactive',
      budget: 100_000,
      elevationState: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  it('persists artifacts from worker receipt into the artifact store', async () => {
    const request: ToolRequest = {
      id: 'req-art',
      sessionId: 's-art',
      taskId: 't-art',
      toolName: 'build',
      params: {},
      principalId: 'p-art',
    };
    const policyCtx: PolicyContext = {
      principal: makePrincipal(),
      session: makeSession(),
      toolName: 'build',
      toolRiskClass: 'C',
      runtimeTarget: 'sandbox',
      approvalState: 'pending',
    };

    const result = await broker.dispatch(request, policyCtx, {
      capabilitySet: ['build'],
      sandboxClass: 'workspace-write',
    });

    expect(result.denied).toBe(false);
    expect(result.receipt?.artifacts).toHaveLength(1);

    // The artifact should now be in the store
    const stored = artifactStore.listByProvenance('t-art');
    expect(stored).toHaveLength(1);
    expect(stored[0].uri).toBe('/workspace/result.txt');
    expect(stored[0].checksum).toBe('sha256:deadbeef');
  });

  it('does not persist artifacts when no artifact store is provided', async () => {
    // Broker without artifact store
    const plainBroker = new ToolBroker(new PolicyEngine(), auditLog);
    plainBroker.registerWorker(new ArtifactWorker());
    plainBroker.registerTool({
      name: 'build',
      description: 'Build',
      riskClass: 'C',
      defaultRuntimeTarget: 'sandbox',
      concurrencySafe: false,
      idempotent: false,
      auditPayloadShape: {},
      inputSchema: {},
    });

    const request: ToolRequest = {
      id: 'req-no-store',
      sessionId: 's-art',
      taskId: 't-no-store',
      toolName: 'build',
      params: {},
      principalId: 'p-art',
    };

    const result = await plainBroker.dispatch(
      request,
      {
        principal: makePrincipal(),
        session: makeSession(),
        toolName: 'build',
        toolRiskClass: 'C',
        runtimeTarget: 'sandbox',
        approvalState: 'pending',
      },
      { capabilitySet: ['build'], sandboxClass: 'workspace-write' }
    );

    // Execution succeeded
    expect(result.denied).toBe(false);
    expect(result.receipt?.artifacts).toHaveLength(1);
    // But nothing in our artifactStore (it was not wired)
    expect(artifactStore.listByProvenance('t-no-store')).toHaveLength(0);
  });
});
