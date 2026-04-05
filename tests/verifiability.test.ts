/**
 * Phase 3 — Verifiability & Observability tests
 *
 * Covers:
 *   A. Replay diff and sequence validation
 *   B. Audit completeness enforcement
 *   C. Policy explainability
 *   D. Artifact visibility (label / invocationId / listByInvocation)
 */

import {
  buildReplayPack,
  diffReplayPacks,
  validateReplaySequence,
  checkAuditIntegrity,
  ReplayExpectedEvent,
} from '../src/core/replay';
import { PolicyEngine, DEFAULT_POLICY_RULES } from '../src/core/policy';
import { AuditLog } from '../src/core/audit';
import { ArtifactStore } from '../src/core/artifacts';
import { PolicyContext } from '../src/core/types';
import request from 'supertest';
import { Gateway } from '../src/core/gateway';
import { ToolBroker } from '../src/core/broker';
import { SessionStore } from '../src/core/session';
import { ApprovalStore } from '../src/core/approval';
import { MemoryStore } from '../src/core/memory';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCtx(overrides: Partial<PolicyContext> = {}): PolicyContext {
  return {
    principal: {
      id: 'p-1',
      type: 'user',
      identities: {},
      trustLevel: 'high',
      policyGroup: 'default',
      createdAt: new Date().toISOString(),
    },
    session: {
      id: 's-1',
      principalId: 'p-1',
      agentId: 'a-1',
      mode: 'interactive',
      budget: 100000,
      elevationState: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    toolName: 'file_read',
    toolRiskClass: 'A',
    runtimeTarget: 'sandbox',
    approvalState: 'pending',
    ...overrides,
  };
}

type App = Parameters<typeof request>[0];

function buildGateway() {
  const policyEngine = new PolicyEngine();
  const auditLog = new AuditLog({ dbPath: ':memory:' });
  const broker = new ToolBroker(policyEngine, auditLog);
  const sessionStore = new SessionStore({ dbPath: ':memory:' });
  const approvalStore = new ApprovalStore({ dbPath: ':memory:' });
  const memoryStore = new MemoryStore({ dbPath: ':memory:' });
  const gateway = new Gateway(
    { host: '127.0.0.1', port: 0, dbPath: ':memory:', gatewaySecret: '' },
    { policyEngine, broker, auditLog, sessionStore, approvalStore, memoryStore }
  );
  return { gateway, policyEngine, auditLog, sessionStore, approvalStore, memoryStore };
}

// ---------------------------------------------------------------------------
// A. Replay diff
// ---------------------------------------------------------------------------

describe('diffReplayPacks', () => {
  let auditLog: AuditLog;

  beforeEach(() => { auditLog = new AuditLog({ dbPath: ':memory:' }); });
  afterEach(() => { auditLog.close(); });

  it('reports identical=true for two empty packs from the same session', () => {
    const a = buildReplayPack('ses-a', auditLog);
    const b = buildReplayPack('ses-b', new AuditLog({ dbPath: ':memory:' }));
    const diff = diffReplayPacks(a, b);
    expect(diff.identical).toBe(true);
    b.manifest; // keep reference alive (b's auditLog is anonymous)
  });

  it('reports identical=true when both packs have the same events', () => {
    const alA = new AuditLog({ dbPath: ':memory:' });
    const alB = new AuditLog({ dbPath: ':memory:' });
    const ts = new Date().toISOString();
    for (const al of [alA, alB]) {
      al.write({ sessionId: 'ses', principalId: 'p', eventType: 'tool.started', toolName: 'file_read', startedAt: ts });
      al.write({ sessionId: 'ses', principalId: 'p', eventType: 'tool.finished', toolName: 'file_read', startedAt: ts });
    }
    const diff = diffReplayPacks(buildReplayPack('ses', alA), buildReplayPack('ses', alB));
    expect(diff.identical).toBe(true);
    alA.close(); alB.close();
  });

  it('detects an event present in A but missing from B (onlyInA)', () => {
    const alA = new AuditLog({ dbPath: ':memory:' });
    const alB = new AuditLog({ dbPath: ':memory:' });
    const ts = new Date().toISOString();
    alA.write({ sessionId: 'ses', principalId: 'p', eventType: 'tool.started', toolName: 'file_read', startedAt: ts });
    alA.write({ sessionId: 'ses', principalId: 'p', eventType: 'tool.finished', toolName: 'file_read', startedAt: ts });
    alB.write({ sessionId: 'ses', principalId: 'p', eventType: 'tool.started', toolName: 'file_read', startedAt: ts });
    // alB is missing tool.finished

    const diff = diffReplayPacks(buildReplayPack('ses', alA), buildReplayPack('ses', alB));
    expect(diff.identical).toBe(false);
    expect(diff.onlyInA.some((r) => r.eventType === 'tool.finished')).toBe(true);
    expect(diff.onlyInB).toHaveLength(0);
    alA.close(); alB.close();
  });

  it('detects an event present in B but missing from A (onlyInB)', () => {
    const alA = new AuditLog({ dbPath: ':memory:' });
    const alB = new AuditLog({ dbPath: ':memory:' });
    const ts = new Date().toISOString();
    alA.write({ sessionId: 'ses', principalId: 'p', eventType: 'tool.started', toolName: 'file_read', startedAt: ts });
    alB.write({ sessionId: 'ses', principalId: 'p', eventType: 'tool.started', toolName: 'file_read', startedAt: ts });
    alB.write({ sessionId: 'ses', principalId: 'p', eventType: 'tool.finished', toolName: 'file_read', startedAt: ts });

    const diff = diffReplayPacks(buildReplayPack('ses', alA), buildReplayPack('ses', alB));
    expect(diff.identical).toBe(false);
    expect(diff.onlyInB.some((r) => r.eventType === 'tool.finished')).toBe(true);
    alA.close(); alB.close();
  });

  it('detects changed semantics (different error message)', () => {
    const alA = new AuditLog({ dbPath: ':memory:' });
    const alB = new AuditLog({ dbPath: ':memory:' });
    const ts = new Date().toISOString();
    alA.write({ sessionId: 'ses', principalId: 'p', eventType: 'tool.error', toolName: 'file_read', error: 'disk full', startedAt: ts });
    alB.write({ sessionId: 'ses', principalId: 'p', eventType: 'tool.error', toolName: 'file_read', error: 'permission denied', startedAt: ts });

    const diff = diffReplayPacks(buildReplayPack('ses', alA), buildReplayPack('ses', alB));
    expect(diff.identical).toBe(false);
    expect(diff.changed.length).toBe(1);
    expect(diff.changed[0].fields).toContain('error');
    alA.close(); alB.close();
  });

  it('sessionA and sessionB are populated correctly', () => {
    const alA = new AuditLog({ dbPath: ':memory:' });
    const alB = new AuditLog({ dbPath: ':memory:' });
    const diff = diffReplayPacks(
      buildReplayPack('session-alpha', alA),
      buildReplayPack('session-beta', alB)
    );
    expect(diff.sessionA).toBe('session-alpha');
    expect(diff.sessionB).toBe('session-beta');
    alA.close(); alB.close();
  });

  it('multiple matching events are consumed pairwise (not cross-matched)', () => {
    const alA = new AuditLog({ dbPath: ':memory:' });
    const alB = new AuditLog({ dbPath: ':memory:' });
    const ts = new Date().toISOString();
    // A: 3 started events; B: only 2
    for (let i = 0; i < 3; i++) {
      alA.write({ sessionId: 'ses', principalId: 'p', eventType: 'tool.started', toolName: 'file_read', startedAt: ts });
    }
    for (let i = 0; i < 2; i++) {
      alB.write({ sessionId: 'ses', principalId: 'p', eventType: 'tool.started', toolName: 'file_read', startedAt: ts });
    }
    const diff = diffReplayPacks(buildReplayPack('ses', alA), buildReplayPack('ses', alB));
    expect(diff.onlyInA).toHaveLength(1);
    expect(diff.onlyInB).toHaveLength(0);
    alA.close(); alB.close();
  });
});

// ---------------------------------------------------------------------------
// A. Replay sequence validation
// ---------------------------------------------------------------------------

describe('validateReplaySequence', () => {
  let auditLog: AuditLog;

  beforeEach(() => { auditLog = new AuditLog({ dbPath: ':memory:' }); });
  afterEach(() => { auditLog.close(); });

  it('returns valid=true when pack exactly matches the expected sequence', () => {
    const ts = new Date().toISOString();
    auditLog.write({ sessionId: 'ses', principalId: 'p', eventType: 'tool.started', toolName: 'file_read', startedAt: ts });
    auditLog.write({ sessionId: 'ses', principalId: 'p', eventType: 'tool.finished', toolName: 'file_read', startedAt: ts });

    const expected: ReplayExpectedEvent[] = [
      { eventType: 'tool.started', toolName: 'file_read' },
      { eventType: 'tool.finished', toolName: 'file_read' },
    ];
    const result = validateReplaySequence(buildReplayPack('ses', auditLog), expected);
    expect(result.valid).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it('returns violation when eventType mismatches at a position', () => {
    const ts = new Date().toISOString();
    auditLog.write({ sessionId: 'ses', principalId: 'p', eventType: 'tool.started', toolName: 'file_read', startedAt: ts });
    auditLog.write({ sessionId: 'ses', principalId: 'p', eventType: 'tool.error', toolName: 'file_read', startedAt: ts });

    const expected: ReplayExpectedEvent[] = [
      { eventType: 'tool.started', toolName: 'file_read' },
      { eventType: 'tool.finished', toolName: 'file_read' }, // wrong — actual is tool.error
    ];
    const result = validateReplaySequence(buildReplayPack('ses', auditLog), expected);
    expect(result.valid).toBe(false);
    expect(result.violations[0].index).toBe(1);
    expect(result.violations[0].reason).toMatch(/eventType mismatch/i);
  });

  it('returns violation when toolName mismatches', () => {
    const ts = new Date().toISOString();
    auditLog.write({ sessionId: 'ses', principalId: 'p', eventType: 'tool.started', toolName: 'file_read', startedAt: ts });

    const expected: ReplayExpectedEvent[] = [
      { eventType: 'tool.started', toolName: 'file_write' }, // wrong tool
    ];
    const result = validateReplaySequence(buildReplayPack('ses', auditLog), expected);
    expect(result.valid).toBe(false);
    expect(result.violations[0].reason).toMatch(/toolName mismatch/i);
  });

  it('returns violation when pack is shorter than expected sequence', () => {
    const expected: ReplayExpectedEvent[] = [
      { eventType: 'tool.started' },
    ];
    const result = validateReplaySequence(buildReplayPack('ses-empty', auditLog), expected);
    expect(result.valid).toBe(false);
    expect(result.violations[0].actual).toBeUndefined();
    expect(result.violations[0].reason).toMatch(/no record at position/i);
  });

  it('validates only the first N records when expected is shorter than pack', () => {
    const ts = new Date().toISOString();
    auditLog.write({ sessionId: 'ses', principalId: 'p', eventType: 'tool.started', toolName: 'file_read', startedAt: ts });
    auditLog.write({ sessionId: 'ses', principalId: 'p', eventType: 'tool.error', toolName: 'file_read', startedAt: ts });
    auditLog.write({ sessionId: 'ses', principalId: 'p', eventType: 'approval.requested', startedAt: ts });

    const expected: ReplayExpectedEvent[] = [
      { eventType: 'tool.started' }, // only check first record
    ];
    const result = validateReplaySequence(buildReplayPack('ses', auditLog), expected);
    expect(result.valid).toBe(true); // only the first event was validated
  });

  it('returns valid=true for empty expected sequence', () => {
    const result = validateReplaySequence(buildReplayPack('ses-empty', auditLog), []);
    expect(result.valid).toBe(true);
  });

  it('can match on taskId', () => {
    const ts = new Date().toISOString();
    auditLog.write({ sessionId: 'ses', taskId: 't-99', principalId: 'p', eventType: 'tool.started', toolName: 'build', startedAt: ts });

    const resultOk = validateReplaySequence(
      buildReplayPack('ses', auditLog),
      [{ eventType: 'tool.started', toolName: 'build', taskId: 't-99' }]
    );
    expect(resultOk.valid).toBe(true);

    const auditLog2 = new AuditLog({ dbPath: ':memory:' });
    auditLog2.write({ sessionId: 'ses', taskId: 't-99', principalId: 'p', eventType: 'tool.started', toolName: 'build', startedAt: ts });
    const resultBad = validateReplaySequence(
      buildReplayPack('ses', auditLog2),
      [{ eventType: 'tool.started', toolName: 'build', taskId: 't-WRONG' }]
    );
    expect(resultBad.valid).toBe(false);
    auditLog2.close();
  });
});

// ---------------------------------------------------------------------------
// B. Audit integrity checking
// ---------------------------------------------------------------------------

describe('checkAuditIntegrity', () => {
  let auditLog: AuditLog;

  beforeEach(() => { auditLog = new AuditLog({ dbPath: ':memory:' }); });
  afterEach(() => { auditLog.close(); });

  it('reports valid=true for a well-formed started/finished pair', () => {
    const ts = new Date().toISOString();
    auditLog.write({ sessionId: 's', taskId: 't', principalId: 'p', eventType: 'tool.started', toolName: 'file_read', startedAt: ts });
    auditLog.write({ sessionId: 's', taskId: 't', principalId: 'p', eventType: 'tool.finished', toolName: 'file_read', startedAt: ts });
    const result = checkAuditIntegrity(buildReplayPack('s', auditLog));
    expect(result.valid).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it('detects unmatched_started when tool.started has no tool.finished', () => {
    const ts = new Date().toISOString();
    auditLog.write({ sessionId: 's', taskId: 't', principalId: 'p', eventType: 'tool.started', toolName: 'file_read', startedAt: ts });
    const result = checkAuditIntegrity(buildReplayPack('s', auditLog));
    expect(result.valid).toBe(false);
    expect(result.violations.some((v) => v.kind === 'unmatched_started')).toBe(true);
  });

  it('detects orphaned_finished when tool.finished has no prior tool.started', () => {
    const ts = new Date().toISOString();
    auditLog.write({ sessionId: 's', taskId: 't', principalId: 'p', eventType: 'tool.finished', toolName: 'file_read', startedAt: ts });
    const result = checkAuditIntegrity(buildReplayPack('s', auditLog));
    expect(result.valid).toBe(false);
    expect(result.violations.some((v) => v.kind === 'orphaned_finished')).toBe(true);
  });

  it('detects denial_without_policy when tool.denied has no policyDecision', () => {
    const ts = new Date().toISOString();
    auditLog.write({ sessionId: 's', principalId: 'p', eventType: 'tool.denied', toolName: 'file_write', startedAt: ts });
    // No policyDecision on the record
    const result = checkAuditIntegrity(buildReplayPack('s', auditLog));
    expect(result.valid).toBe(false);
    expect(result.violations.some((v) => v.kind === 'denial_without_policy')).toBe(true);
  });

  it('accepts denial that has a policyDecision', () => {
    const ts = new Date().toISOString();
    auditLog.write({
      sessionId: 's', principalId: 'p', eventType: 'tool.denied', toolName: 'file_write', startedAt: ts,
      policyDecision: { mode: 'deny', reason: 'low trust', requiresApproval: false, auditRequired: true },
    });
    const result = checkAuditIntegrity(buildReplayPack('s', auditLog));
    expect(result.valid).toBe(true);
  });

  it('detects approval_lifecycle_incomplete when approval.requested has no resolved', () => {
    const ts = new Date().toISOString();
    auditLog.write({ sessionId: 's', taskId: 't', principalId: 'p', eventType: 'approval.requested', startedAt: ts });
    const result = checkAuditIntegrity(buildReplayPack('s', auditLog));
    expect(result.valid).toBe(false);
    expect(result.violations.some((v) => v.kind === 'approval_lifecycle_incomplete')).toBe(true);
  });

  it('accepts complete approval lifecycle', () => {
    const ts = new Date().toISOString();
    auditLog.write({ sessionId: 's', taskId: 't', principalId: 'p', eventType: 'approval.requested', startedAt: ts });
    auditLog.write({ sessionId: 's', taskId: 't', principalId: 'p', eventType: 'approval.resolved', startedAt: ts });
    const result = checkAuditIntegrity(buildReplayPack('s', auditLog));
    expect(result.valid).toBe(true);
  });

  it('allows tool.error as a valid closer for tool.started', () => {
    const ts = new Date().toISOString();
    auditLog.write({ sessionId: 's', taskId: 't', principalId: 'p', eventType: 'tool.started', toolName: 'build', startedAt: ts });
    auditLog.write({ sessionId: 's', taskId: 't', principalId: 'p', eventType: 'tool.error', toolName: 'build', startedAt: ts });
    const result = checkAuditIntegrity(buildReplayPack('s', auditLog));
    expect(result.valid).toBe(true);
  });

  it('reports valid=true for an empty session', () => {
    const result = checkAuditIntegrity(buildReplayPack('empty', auditLog));
    expect(result.valid).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it('can accumulate multiple violations simultaneously', () => {
    const ts = new Date().toISOString();
    // unmatched start
    auditLog.write({ sessionId: 's', taskId: 't1', principalId: 'p', eventType: 'tool.started', toolName: 'a', startedAt: ts });
    // denial without policy
    auditLog.write({ sessionId: 's', principalId: 'p', eventType: 'tool.denied', toolName: 'b', startedAt: ts });
    // open approval
    auditLog.write({ sessionId: 's', taskId: 't2', principalId: 'p', eventType: 'approval.requested', startedAt: ts });

    const result = checkAuditIntegrity(buildReplayPack('s', auditLog));
    expect(result.valid).toBe(false);
    const kinds = result.violations.map((v) => v.kind);
    expect(kinds).toContain('unmatched_started');
    expect(kinds).toContain('denial_without_policy');
    expect(kinds).toContain('approval_lifecycle_incomplete');
  });
});

// ---------------------------------------------------------------------------
// B. Audit integrity API
// ---------------------------------------------------------------------------

describe('GET /v1/sessions/:id/audit-integrity', () => {
  let app: App;
  let auditLog: AuditLog;
  let sessionStore: SessionStore;
  let approvalStore: ApprovalStore;
  let memoryStore: MemoryStore;

  beforeEach(() => {
    const built = buildGateway();
    app = built.gateway.getApp();
    auditLog = built.auditLog;
    sessionStore = built.sessionStore;
    approvalStore = built.approvalStore;
    memoryStore = built.memoryStore;
  });

  afterEach(() => {
    auditLog.close(); sessionStore.close(); approvalStore.close(); memoryStore.close();
  });

  async function createSession(): Promise<string> {
    const p = await request(app).post('/v1/auth/principals').send({ type: 'user', trustLevel: 'high' });
    const a = await request(app).post('/v1/agents').send({});
    const s = await request(app).post('/v1/sessions').send({ principalId: p.body.id, agentId: a.body.id });
    return s.body.id as string;
  }

  it('returns 200 with valid=true for a clean session', async () => {
    const sessionId = await createSession();
    const res = await request(app).get(`/v1/sessions/${sessionId}/audit-integrity`);
    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(true);
    expect(Array.isArray(res.body.violations)).toBe(true);
  });

  it('returns 409 with valid=false when there are integrity violations', async () => {
    const sessionId = await createSession();
    // Inject an orphaned tool.finished directly into the audit log
    auditLog.write({
      sessionId,
      taskId: 'orphan-task',
      principalId: 'p-injected',
      eventType: 'tool.finished',
      toolName: 'phantom',
      startedAt: new Date().toISOString(),
    });
    const res = await request(app).get(`/v1/sessions/${sessionId}/audit-integrity`);
    expect(res.status).toBe(409);
    expect(res.body.valid).toBe(false);
    expect(res.body.violations.length).toBeGreaterThan(0);
  });

  it('returns 404 for a non-existent session', async () => {
    const res = await request(app).get('/v1/sessions/no-such-session/audit-integrity');
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// C. Policy explainability — pure unit tests
// ---------------------------------------------------------------------------

describe('PolicyEngine.explain', () => {
  const engine = new PolicyEngine();

  it('returns a decision with matchedRuleId', () => {
    const decision = engine.explain(makeCtx({ toolRiskClass: 'A' }));
    expect(decision.matchedRuleId).toBe('class-a-allow');
    expect(decision.mode).toBe('allow');
  });

  it('returns a decision with evaluationTrace', () => {
    const decision = engine.explain(makeCtx({ toolRiskClass: 'A' }));
    expect(Array.isArray(decision.evaluationTrace)).toBe(true);
    expect(decision.evaluationTrace!.length).toBeGreaterThan(0);
  });

  it('trace contains the matched rule at the end (last matched=true)', () => {
    const decision = engine.explain(makeCtx({ toolRiskClass: 'A' }));
    const trace = decision.evaluationTrace!;
    const matchedSteps = trace.filter((s) => s.matched);
    expect(matchedSteps).toHaveLength(1);
    expect(matchedSteps[0].ruleId).toBe('class-a-allow');
  });

  it('trace records failing matchers for skipped rules', () => {
    // For a Class A tool with a high-trust user, rules that restrict to
    // specific riskClasses before 'class-a-allow' should fail on riskClasses.
    const decision = engine.explain(makeCtx({ toolRiskClass: 'A', toolName: 'file_read' }));
    const trace = decision.evaluationTrace!;
    // system-allow should fail because principalType is 'user', not 'system'
    const systemStep = trace.find((s) => s.ruleId === 'system-allow');
    expect(systemStep).toBeDefined();
    expect(systemStep!.matched).toBe(false);
    expect(systemStep!.failedMatcher).toBe('principalTypes');
  });

  it('trace has all default rules represented', () => {
    const decision = engine.explain(makeCtx({ toolRiskClass: 'A' }));
    const traceIds = decision.evaluationTrace!.map((s) => s.ruleId);
    for (const rule of DEFAULT_POLICY_RULES) {
      // Only rules up to and including the matched one should be in the trace
      if (rule.id === decision.matchedRuleId) break;
      expect(traceIds).toContain(rule.id);
    }
    expect(traceIds).toContain(decision.matchedRuleId!);
  });

  it('low-trust principal trying Class B: trace shows denial with correct matchedRuleId', () => {
    const decision = engine.explain(makeCtx({
      principal: { id: 'p', type: 'user', identities: {}, trustLevel: 'low', policyGroup: 'default', createdAt: '' },
      toolRiskClass: 'B',
    }));
    expect(decision.mode).toBe('deny');
    expect(decision.matchedRuleId).toBe('low-trust-deny-non-readonly');
  });

  it('explain() result is identical to evaluate() in mode/reason/requiresApproval', () => {
    const ctx = makeCtx({ toolRiskClass: 'C' });
    const evaluated = engine.evaluate(ctx);
    const explained = engine.explain(ctx);
    expect(explained.mode).toBe(evaluated.mode);
    expect(explained.reason).toBe(evaluated.reason);
    expect(explained.requiresApproval).toBe(evaluated.requiresApproval);
    expect(explained.auditRequired).toBe(evaluated.auditRequired);
    expect(explained.matchedRuleId).toBe(evaluated.matchedRuleId);
  });

  it('explain() with no matching rules returns deny with full trace', () => {
    const emptyEngine = new PolicyEngine([]);
    const decision = emptyEngine.explain(makeCtx());
    expect(decision.mode).toBe('deny');
    expect(decision.evaluationTrace).toHaveLength(0);
    expect(decision.matchedRuleId).toBeUndefined();
  });

  it('evaluate() includes matchedRuleId in the standard decision (no side effects)', () => {
    const decision = engine.evaluate(makeCtx({ toolRiskClass: 'B' }));
    expect(decision.matchedRuleId).toBeDefined();
    // evaluate() should NOT include evaluationTrace (that's explain-only)
    expect(decision.evaluationTrace).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// C. Policy explain API
// ---------------------------------------------------------------------------

describe('POST /v1/policy/explain', () => {
  let app: App;
  let auditLog: AuditLog;
  let sessionStore: SessionStore;
  let approvalStore: ApprovalStore;
  let memoryStore: MemoryStore;

  beforeEach(() => {
    const built = buildGateway();
    app = built.gateway.getApp();
    auditLog = built.auditLog;
    sessionStore = built.sessionStore;
    approvalStore = built.approvalStore;
    memoryStore = built.memoryStore;
  });

  afterEach(() => {
    auditLog.close(); sessionStore.close(); approvalStore.close(); memoryStore.close();
  });

  async function createPrincipalAndSession() {
    const p = await request(app).post('/v1/auth/principals').send({ type: 'user', trustLevel: 'high' });
    const a = await request(app).post('/v1/agents').send({});
    const s = await request(app).post('/v1/sessions').send({ principalId: p.body.id, agentId: a.body.id });
    return { principalId: p.body.id as string, sessionId: s.body.id as string };
  }

  it('returns a decision with evaluationTrace', async () => {
    const { principalId, sessionId } = await createPrincipalAndSession();
    const res = await request(app).post('/v1/policy/explain').send({
      principalId,
      sessionId,
      toolName: 'file_read',
      toolRiskClass: 'A',
    });
    expect(res.status).toBe(200);
    expect(res.body.mode).toBeDefined();
    expect(Array.isArray(res.body.evaluationTrace)).toBe(true);
    expect(res.body.evaluationTrace.length).toBeGreaterThan(0);
    expect(res.body.matchedRuleId).toBeDefined();
  });

  it('returns 400 when toolName is missing', async () => {
    const { principalId, sessionId } = await createPrincipalAndSession();
    const res = await request(app).post('/v1/policy/explain').send({ principalId, sessionId, toolRiskClass: 'A' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/toolName/i);
  });

  it('returns 400 when toolRiskClass is missing', async () => {
    const { principalId, sessionId } = await createPrincipalAndSession();
    const res = await request(app).post('/v1/policy/explain').send({ principalId, sessionId, toolName: 'x' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/toolRiskClass/i);
  });

  it('returns 404 when principalId does not exist', async () => {
    const { sessionId } = await createPrincipalAndSession();
    const res = await request(app).post('/v1/policy/explain').send({
      principalId: 'no-such-principal',
      sessionId,
      toolName: 'x',
      toolRiskClass: 'A',
    });
    expect(res.status).toBe(404);
  });

  it('returns 404 when sessionId does not exist', async () => {
    const { principalId } = await createPrincipalAndSession();
    const res = await request(app).post('/v1/policy/explain').send({
      principalId,
      sessionId: 'no-such-session',
      toolName: 'x',
      toolRiskClass: 'A',
    });
    expect(res.status).toBe(404);
  });

  it('shows denial trace for low-trust Class B tool', async () => {
    const p = await request(app).post('/v1/auth/principals').send({ type: 'user', trustLevel: 'low' });
    const a = await request(app).post('/v1/agents').send({});
    const s = await request(app).post('/v1/sessions').send({ principalId: p.body.id, agentId: a.body.id });
    const res = await request(app).post('/v1/policy/explain').send({
      principalId: p.body.id,
      sessionId: s.body.id,
      toolName: 'file_write',
      toolRiskClass: 'B',
    });
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe('deny');
    expect(res.body.matchedRuleId).toBe('low-trust-deny-non-readonly');
  });
});

// ---------------------------------------------------------------------------
// D. Artifact visibility (label, invocationId, listByInvocation)
// ---------------------------------------------------------------------------

describe('ArtifactStore — label and invocationId', () => {
  let store: ArtifactStore;

  beforeEach(() => { store = new ArtifactStore({ dbPath: ':memory:' }); });
  afterEach(() => { store.close(); });

  it('stores and retrieves label', () => {
    const artifact = store.store({
      type: 'file',
      uri: '/out.bin',
      provenanceId: 'task-1',
      checksum: 'abc',
      label: 'Build output',
    });
    expect(artifact.label).toBe('Build output');
    const fetched = store.getById(artifact.id);
    expect(fetched?.label).toBe('Build output');
  });

  it('stores and retrieves invocationId', () => {
    const artifact = store.store({
      type: 'log',
      uri: '/build.log',
      provenanceId: 'task-2',
      checksum: 'def',
      invocationId: 'inv-42',
    });
    expect(artifact.invocationId).toBe('inv-42');
    const fetched = store.getById(artifact.id);
    expect(fetched?.invocationId).toBe('inv-42');
  });

  it('listByInvocation returns only artifacts for that invocationId', () => {
    store.store({ type: 'file', uri: '/a.out', provenanceId: 'p1', checksum: 'x', invocationId: 'inv-A' });
    store.store({ type: 'log',  uri: '/a.log', provenanceId: 'p1', checksum: 'y', invocationId: 'inv-A' });
    store.store({ type: 'file', uri: '/b.out', provenanceId: 'p2', checksum: 'z', invocationId: 'inv-B' });

    const forA = store.listByInvocation('inv-A');
    expect(forA).toHaveLength(2);
    expect(forA.every((a) => a.invocationId === 'inv-A')).toBe(true);

    const forB = store.listByInvocation('inv-B');
    expect(forB).toHaveLength(1);
    expect(forB[0].invocationId).toBe('inv-B');
  });

  it('listByInvocation returns empty array for unknown invocationId', () => {
    expect(store.listByInvocation('no-such-inv')).toHaveLength(0);
  });

  it('artifacts without invocationId have invocationId=undefined', () => {
    const a = store.store({ type: 'file', uri: '/x', provenanceId: 'p', checksum: 'q' });
    expect(a.invocationId).toBeUndefined();
    expect(store.getById(a.id)?.invocationId).toBeUndefined();
  });

  it('label and invocationId survive a round-trip through listByProvenance', () => {
    store.store({
      type: 'file', uri: '/out', provenanceId: 'prov', checksum: 'r',
      label: 'my label', invocationId: 'inv-999',
    });
    const results = store.listByProvenance('prov');
    expect(results[0].label).toBe('my label');
    expect(results[0].invocationId).toBe('inv-999');
  });
});

// ---------------------------------------------------------------------------
// D. Artifact summaries in formatExecutionTrace
// ---------------------------------------------------------------------------

describe('formatExecutionTrace with artifacts', () => {
  it('includes artifact summary lines for tool.finished events', () => {
    const auditLog = new AuditLog({ dbPath: ':memory:' });
    const artifactStore = new ArtifactStore({ dbPath: ':memory:' });
    const taskId = 'task-trace';

    auditLog.write({ sessionId: 'ses', taskId, principalId: 'p', eventType: 'tool.started', toolName: 'build', startedAt: new Date().toISOString() });
    auditLog.write({ sessionId: 'ses', taskId, principalId: 'p', eventType: 'tool.finished', toolName: 'build', startedAt: new Date().toISOString() });

    artifactStore.store({
      type: 'file', uri: '/workspace/out.bin', provenanceId: taskId, checksum: 'abc123def456',
      label: 'Binary output', invocationId: 'inv-1',
    });

    const pack = buildReplayPack('ses', auditLog, artifactStore);
    const trace = require('../src/core/replay').formatExecutionTrace(pack);

    expect(trace).toContain('artifact');
    expect(trace).toContain('/workspace/out.bin');
    auditLog.close();
    artifactStore.close();
  });
});
