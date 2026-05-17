/**
 * Phase 4 display formatting tests.
 */

import { formatReplaySummary, formatReplayDiff, formatPolicyExplanation, formatIntegrityReport } from '../src/core/display';
import { AuditLog } from '../src/core/audit';
import { ArtifactStore } from '../src/core/artifacts';
import { buildReplayPack, diffReplayPacks, checkAuditIntegrity } from '../src/core/replay';
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
// A. formatReplaySummary
// ---------------------------------------------------------------------------

describe('formatReplaySummary', () => {
  it('includes session ID in output', () => {
    const al = makeAuditLog();
    expect(formatReplaySummary(buildReplayPack('ses-xyz', al))).toContain('ses-xyz');
    al.close();
  });

  it('contains all four section headers for empty session', () => {
    const al = makeAuditLog();
    const out = formatReplaySummary(buildReplayPack('ses', al));
    expect(out).toContain('Decisions');
    expect(out).toContain('Approvals');
    expect(out).toContain('Executions');
    expect(out).toContain('Artifacts');
    al.close();
  });

  it('shows placeholder text for empty sections', () => {
    const al = makeAuditLog();
    const out = formatReplaySummary(buildReplayPack('ses', al));
    expect(out).toContain('no denials recorded');
    expect(out).toContain('no approval gates in this session');
    expect(out).toContain('no tool executions recorded');
    expect(out).toContain('no artifacts in this session');
    al.close();
  });

  it('shows a tool execution as success when started+finished', () => {
    const al = makeAuditLog();
    const t = new Date().toISOString();
    al.write({ sessionId: 'ses', taskId: 'task-1', principalId: 'p', eventType: 'tool.started', toolName: 'file_write', startedAt: t });
    al.write({ sessionId: 'ses', taskId: 'task-1', principalId: 'p', eventType: 'tool.finished', toolName: 'file_write', startedAt: t });
    const out = formatReplaySummary(buildReplayPack('ses', al));
    expect(out).toContain('file_write');
    expect(out).toContain('success');
    al.close();
  });

  it('marks errored execution with outcome=error and error message', () => {
    const al = makeAuditLog();
    const t = new Date().toISOString();
    al.write({ sessionId: 'ses', taskId: 't1', principalId: 'p', eventType: 'tool.started', toolName: 'build', startedAt: t });
    al.write({ sessionId: 'ses', taskId: 't1', principalId: 'p', eventType: 'tool.error', toolName: 'build', startedAt: t, error: 'oom error' });
    const out = formatReplaySummary(buildReplayPack('ses', al));
    expect(out).toContain('error');
    expect(out).toContain('oom error');
    al.close();
  });

  it('shows denial with reason and rule ID', () => {
    const al = makeAuditLog();
    const t = new Date().toISOString();
    al.write({
      sessionId: 'ses', principalId: 'p', eventType: 'tool.denied', toolName: 'file_write', startedAt: t,
      policyDecision: { mode: 'deny', reason: 'low trust', requiresApproval: false, auditRequired: true, matchedRuleId: 'low-trust-deny-non-readonly' },
    });
    const out = formatReplaySummary(buildReplayPack('ses', al));
    expect(out).toContain('low trust');
    expect(out).toContain('low-trust-deny-non-readonly');
    al.close();
  });

  it('shows resolved approval lifecycle', () => {
    const al = makeAuditLog();
    const t = new Date().toISOString();
    al.write({ sessionId: 'ses', taskId: 't2', principalId: 'p', eventType: 'approval.requested', startedAt: t });
    al.write({ sessionId: 'ses', taskId: 't2', principalId: 'p', eventType: 'approval.resolved', startedAt: t });
    const out = formatReplaySummary(buildReplayPack('ses', al));
    expect(out).toContain('approval.requested');
    expect(out).toContain('resolved');
    al.close();
  });

  it('marks unresolved approval as "not yet resolved"', () => {
    const al = makeAuditLog();
    const t = new Date().toISOString();
    al.write({ sessionId: 'ses', taskId: 't3', principalId: 'p', eventType: 'approval.requested', startedAt: t });
    const out = formatReplaySummary(buildReplayPack('ses', al));
    expect(out).toContain('not yet resolved');
    al.close();
  });

  it('includes artifact metadata in Artifacts section', () => {
    const al = makeAuditLog(); const artStore = makeArtifactStore();
    const t = new Date().toISOString();
    al.write({ sessionId: 'ses', taskId: 't4', principalId: 'p', eventType: 'tool.started', toolName: 'build', startedAt: t });
    al.write({ sessionId: 'ses', taskId: 't4', principalId: 'p', eventType: 'tool.finished', toolName: 'build', startedAt: t });
    artStore.store({ type: 'file', uri: '/out.bin', provenanceId: 't4', checksum: 'deadbeef', label: 'Binary output', invocationId: 'inv-1' });
    const out = formatReplaySummary(buildReplayPack('ses', al, artStore));
    expect(out).toContain('/out.bin');
    expect(out).toContain('Binary output');
    expect(out).toContain('inv-1');
    al.close(); artStore.close();
  });

  it('lists artifacts under execution block in Executions section', () => {
    const al = makeAuditLog(); const artStore = makeArtifactStore();
    const t = new Date().toISOString();
    al.write({ sessionId: 'ses', taskId: 't5', principalId: 'p', eventType: 'tool.started', toolName: 'compile', startedAt: t });
    al.write({ sessionId: 'ses', taskId: 't5', principalId: 'p', eventType: 'tool.finished', toolName: 'compile', startedAt: t });
    artStore.store({ type: 'log', uri: '/build.log', provenanceId: 't5', checksum: 'abc', label: 'Build log' });
    const out = formatReplaySummary(buildReplayPack('ses', al, artStore));
    const execSection = out.split('Executions')[1];
    expect(execSection).toContain('/build.log');
    al.close(); artStore.close();
  });

  it('shows stats counts', () => {
    const al = makeAuditLog();
    const t = new Date().toISOString();
    al.write({ sessionId: 'ses', taskId: 't', principalId: 'p', eventType: 'tool.started', toolName: 'x', startedAt: t });
    al.write({ sessionId: 'ses', taskId: 't', principalId: 'p', eventType: 'tool.finished', toolName: 'x', startedAt: t });
    al.write({ sessionId: 'ses', principalId: 'p', eventType: 'tool.denied', toolName: 'y', startedAt: t,
      policyDecision: { mode: 'deny', reason: 'r', requiresApproval: false, auditRequired: true } });
    const out = formatReplaySummary(buildReplayPack('ses', al));
    expect(out).toContain('1 execution');
    expect(out).toContain('1 denial');
    al.close();
  });
});

// ---------------------------------------------------------------------------
// B. formatReplayDiff
// ---------------------------------------------------------------------------

describe('formatReplayDiff', () => {
  it('reports identical when both packs are empty', () => {
    const alA = makeAuditLog(); const alB = makeAuditLog();
    const out = formatReplayDiff(diffReplayPacks(buildReplayPack('a', alA), buildReplayPack('b', alB)));
    expect(out).toContain('identical');
    alA.close(); alB.close();
  });

  it('includes both session IDs', () => {
    const alA = makeAuditLog(); const alB = makeAuditLog();
    const out = formatReplayDiff(diffReplayPacks(buildReplayPack('alpha', alA), buildReplayPack('beta', alB)));
    expect(out).toContain('alpha');
    expect(out).toContain('beta');
    alA.close(); alB.close();
  });

  it('shows Only in A section for events removed', () => {
    const alA = makeAuditLog(); const alB = makeAuditLog();
    const t = new Date().toISOString();
    alA.write({ sessionId: 'a', principalId: 'p', eventType: 'tool.started', toolName: 'extra', startedAt: t });
    const out = formatReplayDiff(diffReplayPacks(buildReplayPack('a', alA), buildReplayPack('b', alB)));
    expect(out).toContain('Only in A');
    expect(out).toContain('extra');
    alA.close(); alB.close();
  });

  it('shows Only in B section for events added', () => {
    const alA = makeAuditLog(); const alB = makeAuditLog();
    const t = new Date().toISOString();
    alB.write({ sessionId: 'b', principalId: 'p', eventType: 'tool.finished', toolName: 'new_tool', startedAt: t });
    const out = formatReplayDiff(diffReplayPacks(buildReplayPack('a', alA), buildReplayPack('b', alB)));
    expect(out).toContain('Only in B');
    expect(out).toContain('new_tool');
    alA.close(); alB.close();
  });

  it('shows Changed section with error fields highlighted', () => {
    const alA = makeAuditLog(); const alB = makeAuditLog();
    const t = new Date().toISOString();
    alA.write({ sessionId: 'a', principalId: 'p', eventType: 'tool.error', toolName: 'build', error: 'disk full', startedAt: t });
    alB.write({ sessionId: 'b', principalId: 'p', eventType: 'tool.error', toolName: 'build', error: 'oom', startedAt: t });
    const out = formatReplayDiff(diffReplayPacks(buildReplayPack('a', alA), buildReplayPack('b', alB)));
    expect(out).toContain('Changed');
    expect(out).toContain('disk full');
    expect(out).toContain('oom');
    alA.close(); alB.close();
  });

  it('shows changed runtimeTarget values', () => {
    const alA = makeAuditLog(); const alB = makeAuditLog();
    const t = new Date().toISOString();
    alA.write({ sessionId: 'a', principalId: 'p', eventType: 'tool.finished', toolName: 'run', runtimeTarget: 'sandbox', startedAt: t });
    alB.write({ sessionId: 'b', principalId: 'p', eventType: 'tool.finished', toolName: 'run', runtimeTarget: 'browser_worker', startedAt: t });
    const out = formatReplayDiff(diffReplayPacks(buildReplayPack('a', alA), buildReplayPack('b', alB)));
    expect(out).toContain('sandbox');
    expect(out).toContain('browser_worker');
    alA.close(); alB.close();
  });

  it('shows policyDecision rule IDs when decision changed', () => {
    const alA = makeAuditLog(); const alB = makeAuditLog();
    const t = new Date().toISOString();
    alA.write({ sessionId: 'a', principalId: 'p', eventType: 'tool.denied', toolName: 'x', startedAt: t,
      policyDecision: { mode: 'deny', reason: 'r', requiresApproval: false, auditRequired: true, matchedRuleId: 'rule-old' } });
    alB.write({ sessionId: 'b', principalId: 'p', eventType: 'tool.denied', toolName: 'x', startedAt: t,
      policyDecision: { mode: 'deny', reason: 'r2', requiresApproval: false, auditRequired: true, matchedRuleId: 'rule-new' } });
    const out = formatReplayDiff(diffReplayPacks(buildReplayPack('a', alA), buildReplayPack('b', alB)));
    expect(out).toContain('rule-old');
    expect(out).toContain('rule-new');
    alA.close(); alB.close();
  });

  it('summary line shows numeric counts', () => {
    const alA = makeAuditLog(); const alB = makeAuditLog();
    const t = new Date().toISOString();
    alA.write({ sessionId: 'a', principalId: 'p', eventType: 'tool.started', toolName: 'removed', startedAt: t });
    alB.write({ sessionId: 'b', principalId: 'p', eventType: 'tool.finished', toolName: 'added', startedAt: t });
    const out = formatReplayDiff(diffReplayPacks(buildReplayPack('a', alA), buildReplayPack('b', alB)));
    expect(out).toMatch(/\d+ removed/);
    expect(out).toMatch(/\d+ added/);
    alA.close(); alB.close();
  });
});

// ---------------------------------------------------------------------------
// C. formatPolicyExplanation
// ---------------------------------------------------------------------------

describe('formatPolicyExplanation', () => {
  it('shows Policy Explanation header', () => {
    const decision = POLICY_ENGINE.explain(makeCtx({ toolRiskClass: 'A' }));
    expect(formatPolicyExplanation(decision)).toContain('Policy Explanation');
  });

  it('shows ALLOW for high-trust Class A', () => {
    const decision = POLICY_ENGINE.explain(makeCtx({ toolRiskClass: 'A' }));
    expect(formatPolicyExplanation(decision)).toContain('ALLOW');
  });

  it('shows DENY for low-trust Class B', () => {
    const decision = POLICY_ENGINE.explain(makeCtx({
      principal: { id: 'p', type: 'user', identities: {}, trustLevel: 'low', policyGroup: 'default', createdAt: '' },
      toolRiskClass: 'B',
    }));
    const out = formatPolicyExplanation(decision);
    expect(out).toContain('DENY');
    expect(out).toContain('low-trust-deny-non-readonly');
  });

  it('marks matched rule with MATCHED marker', () => {
    const decision = POLICY_ENGINE.explain(makeCtx({ toolRiskClass: 'C' }));
    const out = formatPolicyExplanation(decision);
    expect(out).toContain('MATCHED');
    expect(out).toContain('class-c-sandbox-only');
  });

  it('shows "skipped" for rules before the match', () => {
    expect(formatPolicyExplanation(POLICY_ENGINE.explain(makeCtx({ toolRiskClass: 'A' })))).toContain('skipped');
  });

  it('shows failedMatcher reason for skipped rules', () => {
    const out = formatPolicyExplanation(POLICY_ENGINE.explain(makeCtx({ toolRiskClass: 'A' })));
    expect(out).toContain('principalTypes');
  });

  it('shows allowed runtime target', () => {
    const out = formatPolicyExplanation(POLICY_ENGINE.explain(makeCtx({ toolRiskClass: 'C' })));
    expect(out).toContain('sandbox');
  });

  it('shows "requires approval" for allow_with_approval decisions', () => {
    const decision = POLICY_ENGINE.explain(makeCtx({
      principal: { id: 'p', type: 'user', identities: {}, trustLevel: 'medium', policyGroup: 'default', createdAt: '' },
      toolRiskClass: 'E',
    }));
    expect(decision.mode).toBe('allow_with_approval');
    expect(formatPolicyExplanation(decision)).toContain('approval');
  });

  it('handles decision without evaluationTrace gracefully', () => {
    const decision: PolicyDecision = { mode: 'allow', reason: 'manual', requiresApproval: false, auditRequired: true };
    const out = formatPolicyExplanation(decision);
    expect(out).toContain('no evaluation trace');
    expect(out).toContain('ALLOW');
  });

  it('shows rule count in summary line', () => {
    expect(formatPolicyExplanation(POLICY_ENGINE.explain(makeCtx({ toolRiskClass: 'B' })))).toMatch(/\d+ rule\(s\) evaluated/);
  });

  it('shows matched: 1 in summary line', () => {
    expect(formatPolicyExplanation(POLICY_ENGINE.explain(makeCtx({ toolRiskClass: 'A' })))).toContain('matched: 1');
  });

  it('shows Rule Evaluation Trace section header', () => {
    expect(formatPolicyExplanation(POLICY_ENGINE.explain(makeCtx({ toolRiskClass: 'B' })))).toContain('Rule Evaluation Trace');
  });
});

// ---------------------------------------------------------------------------
// D. formatIntegrityReport
// ---------------------------------------------------------------------------

describe('formatIntegrityReport', () => {
  it('shows Audit Integrity Report header', () => {
    const al = makeAuditLog();
    expect(formatIntegrityReport(checkAuditIntegrity(buildReplayPack('s', al)))).toContain('Audit Integrity Report');
    al.close();
  });

  it('shows "passed" for a clean session', () => {
    const al = makeAuditLog();
    const t = new Date().toISOString();
    al.write({ sessionId: 's', taskId: 't', principalId: 'p', eventType: 'tool.started', toolName: 'x', startedAt: t });
    al.write({ sessionId: 's', taskId: 't', principalId: 'p', eventType: 'tool.finished', toolName: 'x', startedAt: t });
    expect(formatIntegrityReport(checkAuditIntegrity(buildReplayPack('s', al)))).toContain('passed');
    al.close();
  });

  it('reports unmatched_started under Lifecycle Errors', () => {
    const al = makeAuditLog();
    const t = new Date().toISOString();
    al.write({ sessionId: 's', taskId: 't', principalId: 'p', eventType: 'tool.started', toolName: 'build', startedAt: t });
    const out = formatIntegrityReport(checkAuditIntegrity(buildReplayPack('s', al)));
    expect(out).toContain('Lifecycle Errors');
    expect(out).toContain('lifecycle error');
    al.close();
  });

  it('reports denial_without_policy under Policy Gaps', () => {
    const al = makeAuditLog();
    const t = new Date().toISOString();
    al.write({ sessionId: 's', principalId: 'p', eventType: 'tool.denied', toolName: 'x', startedAt: t });
    const out = formatIntegrityReport(checkAuditIntegrity(buildReplayPack('s', al)));
    expect(out).toContain('Policy Gaps');
    expect(out).toContain('policy gap');
    al.close();
  });

  it('reports approval_lifecycle_incomplete under Missing Events', () => {
    const al = makeAuditLog();
    const t = new Date().toISOString();
    al.write({ sessionId: 's', taskId: 't', principalId: 'p', eventType: 'approval.requested', startedAt: t });
    const out = formatIntegrityReport(checkAuditIntegrity(buildReplayPack('s', al)));
    expect(out).toContain('Missing Events');
    expect(out).toContain('missing event');
    al.close();
  });

  it('shows total violation count', () => {
    const al = makeAuditLog();
    const t = new Date().toISOString();
    al.write({ sessionId: 's', taskId: 't1', principalId: 'p', eventType: 'tool.started', toolName: 'a', startedAt: t });
    al.write({ sessionId: 's', principalId: 'p', eventType: 'tool.denied', toolName: 'b', startedAt: t });
    expect(formatIntegrityReport(checkAuditIntegrity(buildReplayPack('s', al)))).toContain('Total violations: 2');
    al.close();
  });

  it('shows violating tool name', () => {
    const al = makeAuditLog();
    const t = new Date().toISOString();
    al.write({ sessionId: 's', taskId: 't', principalId: 'p', eventType: 'tool.started', toolName: 'orphan_tool', startedAt: t });
    expect(formatIntegrityReport(checkAuditIntegrity(buildReplayPack('s', al)))).toContain('orphan_tool');
    al.close();
  });

  it('shows the violation message text', () => {
    const al = makeAuditLog();
    const t = new Date().toISOString();
    al.write({ sessionId: 's', taskId: 't', principalId: 'p', eventType: 'tool.started', toolName: 'x', startedAt: t });
    const result = checkAuditIntegrity(buildReplayPack('s', al));
    expect(formatIntegrityReport(result)).toContain(result.violations[0].message);
    al.close();
  });

  it('groups all three violation categories when all three present', () => {
    const al = makeAuditLog();
    const t = new Date().toISOString();
    al.write({ sessionId: 's', taskId: 't1', principalId: 'p', eventType: 'tool.started', toolName: 'a', startedAt: t });
    al.write({ sessionId: 's', principalId: 'p', eventType: 'tool.denied', toolName: 'b', startedAt: t });
    al.write({ sessionId: 's', taskId: 't2', principalId: 'p', eventType: 'approval.requested', startedAt: t });
    const out = formatIntegrityReport(checkAuditIntegrity(buildReplayPack('s', al)));
    expect(out).toContain('Lifecycle Errors');
    expect(out).toContain('Policy Gaps');
    expect(out).toContain('Missing Events');
    al.close();
  });

  it('shows per-category count in summary', () => {
    const al = makeAuditLog();
    const t = new Date().toISOString();
    al.write({ sessionId: 's', principalId: 'p', eventType: 'tool.denied', toolName: 'x', startedAt: t });
    expect(formatIntegrityReport(checkAuditIntegrity(buildReplayPack('s', al)))).toContain('Policy Gaps: 1');
    al.close();
  });
});
