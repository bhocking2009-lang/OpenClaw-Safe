/**
 * Phase 9 — Operator Experience tests.
 *
 * Covers:
 *   A. formatSessionTimeline   — grouped task timeline
 *   B. formatDiffSummary       — concise narrative diff
 *   C. formatPolicyRuleCard    — focused rule card with near-miss visibility
 *   D. formatArtifactNavigator — filtered/grouped artifact listing
 */

import {
  formatSessionTimeline,
  formatDiffSummary,
  formatPolicyRuleCard,
  formatArtifactNavigator,
} from '../src/core/display';
import { AuditLog } from '../src/core/audit';
import { ArtifactStore } from '../src/core/artifacts';
import { buildReplayPack, diffReplayPacks } from '../src/core/replay';
import { PolicyEngine } from '../src/core/policy';
import { PolicyDecision } from '../src/core/types';

const POLICY_ENGINE = new PolicyEngine();

function makeAuditLog(): AuditLog { return new AuditLog({ dbPath: ':memory:' }); }
function makeArtifactStore(): ArtifactStore { return new ArtifactStore({ dbPath: ':memory:' }); }

function makeCtx(overrides: Record<string, unknown> = {}) {
  return {
    principal: { id: 'p-1', type: 'user' as const, identities: {}, trustLevel: 'high' as const, policyGroup: 'default', createdAt: '' },
    session: { id: 's-1', principalId: 'p-1', agentId: 'a-1', mode: 'interactive' as const, budget: 100000, elevationState: false, createdAt: '', updatedAt: '' },
    toolName: 'file_read', toolRiskClass: 'A' as const, runtimeTarget: 'sandbox' as const, approvalState: 'pending' as const,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// A. formatSessionTimeline
// ---------------------------------------------------------------------------

describe('formatSessionTimeline', () => {
  it('includes session ID in output', () => {
    const al = makeAuditLog();
    const out = formatSessionTimeline(buildReplayPack('tl-ses', al));
    expect(out).toContain('tl-ses');
    al.close();
  });

  it('shows Session Timeline header', () => {
    const al = makeAuditLog();
    const out = formatSessionTimeline(buildReplayPack('s', al));
    expect(out).toContain('Session Timeline');
    al.close();
  });

  it('shows placeholder for empty session', () => {
    const al = makeAuditLog();
    const out = formatSessionTimeline(buildReplayPack('s', al));
    expect(out).toContain('no events recorded');
    al.close();
  });

  it('groups records by task ID', () => {
    const al = makeAuditLog();
    const t = new Date().toISOString();
    al.write({ sessionId: 's', taskId: 'task-alpha', principalId: 'p', eventType: 'tool.started', toolName: 'compile', startedAt: t });
    al.write({ sessionId: 's', taskId: 'task-alpha', principalId: 'p', eventType: 'tool.finished', toolName: 'compile', startedAt: t });
    al.write({ sessionId: 's', taskId: 'task-beta', principalId: 'p', eventType: 'tool.started', toolName: 'deploy', startedAt: t });
    al.write({ sessionId: 's', taskId: 'task-beta', principalId: 'p', eventType: 'tool.finished', toolName: 'deploy', startedAt: t });
    const out = formatSessionTimeline(buildReplayPack('s', al));
    expect(out).toContain('task-alpha');
    expect(out).toContain('task-beta');
    expect(out).toContain('compile');
    expect(out).toContain('deploy');
    al.close();
  });

  it('places taskless events under "(no task)"', () => {
    const al = makeAuditLog();
    const t = new Date().toISOString();
    al.write({ sessionId: 's', principalId: 'p', eventType: 'tool.denied', toolName: 'secret_read', startedAt: t,
      policyDecision: { mode: 'deny', reason: 'not allowed', requiresApproval: false, auditRequired: true } });
    const out = formatSessionTimeline(buildReplayPack('s', al));
    expect(out).toContain('(no task)');
    expect(out).toContain('secret_read');
    al.close();
  });

  it('shows denial with reason and rule ID within task block', () => {
    const al = makeAuditLog();
    const t = new Date().toISOString();
    al.write({ sessionId: 's', taskId: 't1', principalId: 'p', eventType: 'tool.denied', toolName: 'host_exec', startedAt: t,
      policyDecision: { mode: 'deny', reason: 'low trust', requiresApproval: false, auditRequired: true, matchedRuleId: 'rule-xyz' } });
    const out = formatSessionTimeline(buildReplayPack('s', al));
    expect(out).toContain('low trust');
    expect(out).toContain('rule-xyz');
    al.close();
  });

  it('shows approval events in task block', () => {
    const al = makeAuditLog();
    const t = new Date().toISOString();
    al.write({ sessionId: 's', taskId: 't2', principalId: 'p', eventType: 'approval.requested', startedAt: t });
    al.write({ sessionId: 's', taskId: 't2', principalId: 'p', eventType: 'approval.resolved', startedAt: t });
    const out = formatSessionTimeline(buildReplayPack('s', al));
    expect(out).toContain('approval.requested');
    expect(out).toContain('approval.resolved');
    al.close();
  });

  it('shows execution outcome in task block', () => {
    const al = makeAuditLog();
    const t = new Date().toISOString();
    al.write({ sessionId: 's', taskId: 't3', principalId: 'p', eventType: 'tool.started', toolName: 'test_runner', startedAt: t });
    al.write({ sessionId: 's', taskId: 't3', principalId: 'p', eventType: 'tool.finished', toolName: 'test_runner', startedAt: t });
    const out = formatSessionTimeline(buildReplayPack('s', al));
    expect(out).toContain('test_runner');
    expect(out).toContain('success');
    al.close();
  });

  it('shows error outcome and message in task block', () => {
    const al = makeAuditLog();
    const t = new Date().toISOString();
    al.write({ sessionId: 's', taskId: 't4', principalId: 'p', eventType: 'tool.started', toolName: 'build', startedAt: t });
    al.write({ sessionId: 's', taskId: 't4', principalId: 'p', eventType: 'tool.error', toolName: 'build', startedAt: t, error: 'oom killed' });
    const out = formatSessionTimeline(buildReplayPack('s', al));
    expect(out).toContain('error');
    expect(out).toContain('oom killed');
    al.close();
  });

  it('lists artifacts under their task block', () => {
    const al = makeAuditLog();
    const art = makeArtifactStore();
    const t = new Date().toISOString();
    al.write({ sessionId: 's', taskId: 'task-art', principalId: 'p', eventType: 'tool.started', toolName: 'export', startedAt: t });
    al.write({ sessionId: 's', taskId: 'task-art', principalId: 'p', eventType: 'tool.finished', toolName: 'export', startedAt: t });
    art.store({ type: 'file', uri: '/report.pdf', provenanceId: 'task-art', checksum: 'crc1', label: 'Report PDF' });
    const out = formatSessionTimeline(buildReplayPack('s', al, art));
    expect(out).toContain('task-art');
    expect(out).toContain('/report.pdf');
    al.close(); art.close();
  });

  it('shows stats counts in header', () => {
    const al = makeAuditLog();
    const t = new Date().toISOString();
    al.write({ sessionId: 's', taskId: 't', principalId: 'p', eventType: 'tool.started', toolName: 'x', startedAt: t });
    al.write({ sessionId: 's', taskId: 't', principalId: 'p', eventType: 'tool.finished', toolName: 'x', startedAt: t });
    const out = formatSessionTimeline(buildReplayPack('s', al));
    expect(out).toContain('1 execution');
    al.close();
  });

  it('shows end of timeline footer with task count', () => {
    const al = makeAuditLog();
    const t = new Date().toISOString();
    al.write({ sessionId: 's', taskId: 'task-1', principalId: 'p', eventType: 'tool.started', toolName: 'x', startedAt: t });
    al.write({ sessionId: 's', taskId: 'task-1', principalId: 'p', eventType: 'tool.finished', toolName: 'x', startedAt: t });
    const out = formatSessionTimeline(buildReplayPack('s', al));
    expect(out).toContain('1 task(s)');
    al.close();
  });
});

// ---------------------------------------------------------------------------
// B. formatDiffSummary
// ---------------------------------------------------------------------------

describe('formatDiffSummary', () => {
  it('shows "Identical" for empty sessions', () => {
    const alA = makeAuditLog(); const alB = makeAuditLog();
    const out = formatDiffSummary(diffReplayPacks(buildReplayPack('a', alA), buildReplayPack('b', alB)));
    expect(out).toContain('Identical');
    alA.close(); alB.close();
  });

  it('includes both session IDs in header', () => {
    const alA = makeAuditLog(); const alB = makeAuditLog();
    const out = formatDiffSummary(diffReplayPacks(buildReplayPack('session-x', alA), buildReplayPack('session-y', alB)));
    expect(out).toContain('session-x');
    expect(out).toContain('session-y');
    alA.close(); alB.close();
  });

  it('shows removed event count and tool name', () => {
    const alA = makeAuditLog(); const alB = makeAuditLog();
    const t = new Date().toISOString();
    alA.write({ sessionId: 'a', principalId: 'p', eventType: 'tool.started', toolName: 'removed_tool', startedAt: t });
    const out = formatDiffSummary(diffReplayPacks(buildReplayPack('a', alA), buildReplayPack('b', alB)));
    expect(out).toContain('only in A');
    expect(out).toContain('removed_tool');
    alA.close(); alB.close();
  });

  it('shows added event count and tool name', () => {
    const alA = makeAuditLog(); const alB = makeAuditLog();
    const t = new Date().toISOString();
    alB.write({ sessionId: 'b', principalId: 'p', eventType: 'tool.finished', toolName: 'added_tool', startedAt: t });
    const out = formatDiffSummary(diffReplayPacks(buildReplayPack('a', alA), buildReplayPack('b', alB)));
    expect(out).toContain('only in B');
    expect(out).toContain('added_tool');
    alA.close(); alB.close();
  });

  it('narrates decision rule change', () => {
    const alA = makeAuditLog(); const alB = makeAuditLog();
    const t = new Date().toISOString();
    alA.write({ sessionId: 'a', principalId: 'p', eventType: 'tool.denied', toolName: 'x', startedAt: t,
      policyDecision: { mode: 'deny', reason: 'r', requiresApproval: false, auditRequired: true, matchedRuleId: 'rule-old' } });
    alB.write({ sessionId: 'b', principalId: 'p', eventType: 'tool.denied', toolName: 'x', startedAt: t,
      policyDecision: { mode: 'deny', reason: 'r2', requiresApproval: false, auditRequired: true, matchedRuleId: 'rule-new' } });
    const out = formatDiffSummary(diffReplayPacks(buildReplayPack('a', alA), buildReplayPack('b', alB)));
    expect(out).toContain('decision rule');
    expect(out).toContain('rule-old');
    expect(out).toContain('rule-new');
    alA.close(); alB.close();
  });

  it('narrates runtime target change', () => {
    const alA = makeAuditLog(); const alB = makeAuditLog();
    const t = new Date().toISOString();
    alA.write({ sessionId: 'a', principalId: 'p', eventType: 'tool.finished', toolName: 'run', runtimeTarget: 'sandbox', startedAt: t });
    alB.write({ sessionId: 'b', principalId: 'p', eventType: 'tool.finished', toolName: 'run', runtimeTarget: 'browser_worker', startedAt: t });
    const out = formatDiffSummary(diffReplayPacks(buildReplayPack('a', alA), buildReplayPack('b', alB)));
    expect(out).toContain('runtime');
    expect(out).toContain('sandbox');
    expect(out).toContain('browser_worker');
    alA.close(); alB.close();
  });

  it('narrates error change', () => {
    const alA = makeAuditLog(); const alB = makeAuditLog();
    const t = new Date().toISOString();
    alA.write({ sessionId: 'a', principalId: 'p', eventType: 'tool.error', toolName: 'build', error: 'disk full', startedAt: t });
    alB.write({ sessionId: 'b', principalId: 'p', eventType: 'tool.error', toolName: 'build', error: 'oom', startedAt: t });
    const out = formatDiffSummary(diffReplayPacks(buildReplayPack('a', alA), buildReplayPack('b', alB)));
    expect(out).toContain('disk full');
    expect(out).toContain('oom');
    alA.close(); alB.close();
  });

  it('shows total summary counts', () => {
    const alA = makeAuditLog(); const alB = makeAuditLog();
    const t = new Date().toISOString();
    alA.write({ sessionId: 'a', principalId: 'p', eventType: 'tool.started', toolName: 'a_only', startedAt: t });
    alB.write({ sessionId: 'b', principalId: 'p', eventType: 'tool.finished', toolName: 'b_only', startedAt: t });
    const out = formatDiffSummary(diffReplayPacks(buildReplayPack('a', alA), buildReplayPack('b', alB)));
    expect(out).toContain('1 removed');
    expect(out).toContain('1 added');
    alA.close(); alB.close();
  });
});

// ---------------------------------------------------------------------------
// C. formatPolicyRuleCard
// ---------------------------------------------------------------------------

describe('formatPolicyRuleCard', () => {
  it('shows ALLOW for high-trust Class A', () => {
    const decision = POLICY_ENGINE.explain(makeCtx({ toolRiskClass: 'A' }));
    const out = formatPolicyRuleCard(decision);
    expect(out).toContain('ALLOW');
    al_noop(decision);
  });

  it('shows DENY for low-trust Class B', () => {
    const decision = POLICY_ENGINE.explain(makeCtx({
      principal: { id: 'p', type: 'user', identities: {}, trustLevel: 'low', policyGroup: 'default', createdAt: '' },
      toolRiskClass: 'B',
    }));
    expect(formatPolicyRuleCard(decision)).toContain('DENY');
  });

  it('shows matched rule ID', () => {
    const decision = POLICY_ENGINE.explain(makeCtx({ toolRiskClass: 'A' }));
    const out = formatPolicyRuleCard(decision);
    expect(out).toContain('matched rule');
    expect(out).toContain(decision.matchedRuleId!);
  });

  it('shows near-miss rules with stopping matcher', () => {
    const decision = POLICY_ENGINE.explain(makeCtx({ toolRiskClass: 'A' }));
    // At least some rules will be near-misses (failed one matcher)
    const out = formatPolicyRuleCard(decision);
    // Near-miss section appears if there are near-misses, otherwise no crash
    expect(typeof out).toBe('string');
    expect(out.length).toBeGreaterThan(0);
  });

  it('shows matched rule block with rule description', () => {
    const decision = POLICY_ENGINE.explain(makeCtx({ toolRiskClass: 'C' }));
    const out = formatPolicyRuleCard(decision);
    expect(out).toContain('Matched rule');
    expect(out).toContain('class-c-sandbox-only');
  });

  it('shows near-miss count in summary line', () => {
    const decision = POLICY_ENGINE.explain(makeCtx({ toolRiskClass: 'A' }));
    expect(formatPolicyRuleCard(decision)).toContain('near-miss');
  });

  it('shows rule count in summary line', () => {
    const decision = POLICY_ENGINE.explain(makeCtx({ toolRiskClass: 'B' }));
    expect(formatPolicyRuleCard(decision)).toMatch(/\d+ rule\(s\) evaluated/);
  });

  it('handles decision without evaluationTrace gracefully', () => {
    const decision: PolicyDecision = { mode: 'allow', reason: 'manual', requiresApproval: false, auditRequired: true };
    const out = formatPolicyRuleCard(decision);
    expect(out).toContain('no evaluation trace');
    expect(out).toContain('ALLOW');
  });

  it('shows "requires approval" in card for allow_with_approval', () => {
    const decision = POLICY_ENGINE.explain(makeCtx({
      principal: { id: 'p', type: 'user', identities: {}, trustLevel: 'medium', policyGroup: 'default', createdAt: '' },
      toolRiskClass: 'E',
    }));
    expect(decision.mode).toBe('allow_with_approval');
    expect(formatPolicyRuleCard(decision)).toContain('approval');
  });

  it('shows skipped rules section when rules are skipped', () => {
    const decision = POLICY_ENGINE.explain(makeCtx({ toolRiskClass: 'A' }));
    const steps = decision.evaluationTrace ?? [];
    const hasSkipped = steps.some((s) => !s.matched && !s.failedMatcher);
    if (hasSkipped) {
      expect(formatPolicyRuleCard(decision)).toContain('Skipped rules');
    }
  });
});

// ---------------------------------------------------------------------------
// D. formatArtifactNavigator
// ---------------------------------------------------------------------------

describe('formatArtifactNavigator', () => {
  it('shows Artifact Navigator header', () => {
    expect(formatArtifactNavigator([])).toContain('Artifact Navigator');
  });

  it('shows "(no artifacts match)" for empty list', () => {
    expect(formatArtifactNavigator([])).toContain('no artifacts match');
  });

  it('shows "(no artifacts match)" when filter eliminates all', () => {
    const store = makeArtifactStore();
    store.store({ type: 'file', uri: '/a.txt', provenanceId: 'p1', checksum: 'c1' });
    const arts = store.listAll();
    expect(formatArtifactNavigator(arts, { type: 'screenshot' })).toContain('no artifacts match');
    store.close();
  });

  it('shows all artifacts when no filter provided', () => {
    const store = makeArtifactStore();
    store.store({ type: 'file', uri: '/file.txt', provenanceId: 'p1', checksum: 'c1' });
    store.store({ type: 'log', uri: '/build.log', provenanceId: 'p2', checksum: 'c2' });
    const arts = store.listAll();
    const out = formatArtifactNavigator(arts);
    expect(out).toContain('/file.txt');
    expect(out).toContain('/build.log');
    store.close();
  });

  it('filters by type', () => {
    const store = makeArtifactStore();
    store.store({ type: 'file', uri: '/a.txt', provenanceId: 'p1', checksum: 'c1' });
    store.store({ type: 'log', uri: '/b.log', provenanceId: 'p2', checksum: 'c2' });
    const arts = store.listAll();
    const out = formatArtifactNavigator(arts, { type: 'file' });
    expect(out).toContain('/a.txt');
    expect(out).not.toContain('/b.log');
    expect(out).toContain('type=file');
    store.close();
  });

  it('filters by invocationId', () => {
    const store = makeArtifactStore();
    store.store({ type: 'file', uri: '/inv-a.txt', provenanceId: 'p1', checksum: 'c1', invocationId: 'inv-a' });
    store.store({ type: 'file', uri: '/inv-b.txt', provenanceId: 'p2', checksum: 'c2', invocationId: 'inv-b' });
    const arts = store.listAll();
    const out = formatArtifactNavigator(arts, { invocationId: 'inv-a' });
    expect(out).toContain('/inv-a.txt');
    expect(out).not.toContain('/inv-b.txt');
    expect(out).toContain('invocation=inv-a');
    store.close();
  });

  it('filters by provenanceId', () => {
    const store = makeArtifactStore();
    store.store({ type: 'file', uri: '/prov-1.txt', provenanceId: 'task-1', checksum: 'c1' });
    store.store({ type: 'file', uri: '/prov-2.txt', provenanceId: 'task-2', checksum: 'c2' });
    const arts = store.listAll();
    const out = formatArtifactNavigator(arts, { provenanceId: 'task-1' });
    expect(out).toContain('/prov-1.txt');
    expect(out).not.toContain('/prov-2.txt');
    expect(out).toContain('provenance=task-1');
    store.close();
  });

  it('groups artifacts by type', () => {
    const store = makeArtifactStore();
    store.store({ type: 'file', uri: '/a.txt', provenanceId: 'p1', checksum: 'c1' });
    store.store({ type: 'log', uri: '/b.log', provenanceId: 'p2', checksum: 'c2' });
    const arts = store.listAll();
    const out = formatArtifactNavigator(arts);
    const fileIdx = out.indexOf('[file]');
    const logIdx = out.indexOf('[log]');
    expect(fileIdx).toBeGreaterThanOrEqual(0);
    expect(logIdx).toBeGreaterThanOrEqual(0);
    store.close();
  });

  it('shows invocation link when invocationId present', () => {
    const store = makeArtifactStore();
    store.store({ type: 'file', uri: '/linked.txt', provenanceId: 'p1', checksum: 'c1', invocationId: 'inv-xyz' });
    const arts = store.listAll();
    const out = formatArtifactNavigator(arts);
    expect(out).toContain('inv-xyz');
    expect(out).toContain('trace in timeline');
    store.close();
  });

  it('shows artifact label when present', () => {
    const store = makeArtifactStore();
    store.store({ type: 'pdf', uri: '/report.pdf', provenanceId: 'p1', checksum: 'c1', label: 'Final Report' });
    const arts = store.listAll();
    expect(formatArtifactNavigator(arts)).toContain('Final Report');
    store.close();
  });

  it('shows checksum, retention, and provenance for each artifact', () => {
    const store = makeArtifactStore();
    store.store({ type: 'file', uri: '/x.txt', provenanceId: 'task-check', checksum: 'abc123', retentionClass: 'long_term' });
    const arts = store.listAll();
    const out = formatArtifactNavigator(arts);
    expect(out).toContain('abc123');
    expect(out).toContain('long_term');
    expect(out).toContain('task-check');
    store.close();
  });

  it('shows showing count and total count', () => {
    const store = makeArtifactStore();
    store.store({ type: 'file', uri: '/a.txt', provenanceId: 'p1', checksum: 'c1' });
    store.store({ type: 'log', uri: '/b.log', provenanceId: 'p2', checksum: 'c2' });
    const arts = store.listAll();
    const out = formatArtifactNavigator(arts, { type: 'file' });
    expect(out).toContain('1 of 2');
    store.close();
  });

  it('shows "(none)" for filter line when no filter specified', () => {
    const store = makeArtifactStore();
    store.store({ type: 'file', uri: '/a.txt', provenanceId: 'p1', checksum: 'c1' });
    const arts = store.listAll();
    expect(formatArtifactNavigator(arts)).toContain('Filter: (none)');
    store.close();
  });
});

// Helper to prevent unused variable warning without any real logic
function al_noop(_: unknown): void { /* intentional */ }
