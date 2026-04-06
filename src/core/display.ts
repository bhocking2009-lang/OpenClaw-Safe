/**
 * Display layer for OpenClaw Secure — Phase 4: Operator Trust Surface.
 *
 * All functions in this module are pure formatters.  They convert the
 * machine-readable Phase 3 verification structures into human-readable text
 * summaries without any side effects, DB access, or changes to execution
 * semantics.
 *
 * Intended audience: operators, auditors, and developers reviewing sessions
 * without having to read raw JSON logs.
 */

import { AuditRecord, Artifact, PolicyDecision, PolicyEvaluationStep } from './types';
import { ReplayPack } from './replay';
import { ReplayDiffResult } from './replay';
import { AuditIntegrityResult, AuditIntegrityViolationKind } from './replay';

// ---------------------------------------------------------------------------
// Internal utilities
// ---------------------------------------------------------------------------

const HR_THIN  = '─'.repeat(60);
const HR_THICK = '═'.repeat(60);

function section(title: string): string {
  const pad = Math.max(0, 58 - title.length);
  const left = Math.floor(pad / 2);
  const right = pad - left;
  return `╔${'═'.repeat(left + 1)} ${title} ${'═'.repeat(right + 1)}╗`;
}

function indent(s: string, n = 2): string {
  const prefix = ' '.repeat(n);
  return s.split('\n').map((l) => prefix + l).join('\n');
}

function ts(iso: string): string {
  return iso.slice(0, 19) + 'Z';
}

const POLICY_MODE_LABEL: Record<string, string> = {
  allow:               'ALLOW',
  allow_with_approval: 'ALLOW (requires approval)',
  sandbox_only:        'ALLOW (sandbox only)',
  host_elevated_only:  'ALLOW (host elevated only)',
  readonly_visibility: 'ALLOW (read-only visibility)',
  deny:                'DENY',
};

const VIOLATION_KIND_LABEL: Record<AuditIntegrityViolationKind, string> = {
  unmatched_started:             'lifecycle error    ',
  orphaned_finished:             'lifecycle error    ',
  denial_without_policy:         'policy gap         ',
  approval_lifecycle_incomplete: 'missing event      ',
};

// ---------------------------------------------------------------------------
// A. Replay UX — human-readable session summary grouped by task / invocation
// ---------------------------------------------------------------------------

/**
 * One logical invocation block: a tool.started → tool.finished/error pair
 * plus any associated artifacts and approval steps.
 */
interface InvocationBlock {
  tool: string;
  taskId?: string;
  principalId: string;
  startedAt: string;
  finishedAt?: string;
  outcome: 'success' | 'error' | 'pending';
  errorMessage?: string;
  networkSummary?: string;
  artifacts: Artifact[];
}

/**
 * Format a replay pack as a human-readable operator summary.
 *
 * Events are grouped into four sections:
 *   1. Decisions   — tool.denied, policy.denied
 *   2. Approvals   — approval.requested / approval.resolved pairs
 *   3. Executions  — tool.started → tool.finished / tool.error invocations
 *   4. Artifacts   — all artifacts linked to this session
 *
 * This is a pure function: reads the pack, returns text, no side effects.
 */
export function formatReplaySummary(pack: ReplayPack): string {
  const { manifest, auditRecords, artifacts } = pack;

  const lines: string[] = [];

  // ── Header ──────────────────────────────────────────────────────────────
  lines.push(HR_THICK);
  lines.push(`  OpenClaw Session Summary`);
  lines.push(HR_THICK);
  lines.push(`  Session   : ${manifest.sessionId}`);
  lines.push(`  Exported  : ${manifest.exportedAt}`);
  lines.push(`  Duration  : ${manifest.durationMs !== null ? (manifest.durationMs / 1000).toFixed(2) + 's' : 'n/a'}`);
  lines.push(`  Records   : ${manifest.recordCount}`);
  lines.push(`  Tools     : ${manifest.toolsInvoked.join(', ') || '(none)'}`);
  lines.push(`  Principals: ${manifest.principalsInvolved.join(', ') || '(none)'}`);
  if (manifest.lastKnownBudgetRemaining !== undefined) {
    lines.push(`  Budget    : ${manifest.lastKnownBudgetRemaining} remaining`);
  }
  lines.push(`  Stats     : ${manifest.executionCount} execution(s)  ·  ${manifest.denialCount} denial(s)  ·  ${manifest.approvalCount} approval event(s)  ·  ${manifest.budgetExhaustedCount} budget-exhausted event(s)  ·  ${manifest.browserFetchCount} browser fetch(es)  ·  ${manifest.browserDenialCount} browser denial(s)`);
  lines.push('');

  // ── Section 1: Decisions ─────────────────────────────────────────────────
  const denials = auditRecords.filter(
    (r) => r.eventType === 'tool.denied' || r.eventType === 'policy.denied' ||
           r.eventType === 'budget.exhausted' || r.eventType === 'delegation.depth.exceeded' ||
           r.eventType === 'browser.allowlist.denied' || r.eventType === 'browser.protocol.denied' ||
           r.eventType === 'browser.redirect.denied' || r.eventType === 'browser.timeout' ||
           r.eventType === 'browser.body.too_large' || r.eventType === 'browser.network.error' ||
           r.eventType === 'browser.content_type.denied' || r.eventType === 'browser.url.denied'
  );

  lines.push(section('Decisions'));
  if (denials.length === 0) {
    lines.push(indent('(no denials recorded)'));
  } else {
    for (const r of denials) {
      const isBudget = r.eventType === 'budget.exhausted';
      const isDelegation = r.eventType === 'delegation.depth.exceeded';
      const isBrowserDenial =
        r.eventType === 'browser.allowlist.denied' ||
        r.eventType === 'browser.protocol.denied' ||
        r.eventType === 'browser.redirect.denied' ||
        r.eventType === 'browser.timeout' ||
        r.eventType === 'browser.body.too_large' ||
        r.eventType === 'browser.network.error' ||
        r.eventType === 'browser.content_type.denied' ||
        r.eventType === 'browser.url.denied';
      const icon = isBudget ? '💰' : isDelegation ? '🚫' : isBrowserDenial ? '🔒' : '⛔';
      const reason  = r.policyDecision?.reason ?? r.error ?? 'unknown';
      const ruleId  = r.policyDecision?.matchedRuleId ? ` [rule: ${r.policyDecision.matchedRuleId}]` : '';
      const tool    = r.toolName ? ` → ${r.toolName}` : '';
      lines.push(indent(`${ts(r.startedAt)}  ${icon} ${r.eventType}${tool}`));
      lines.push(indent(`   reason : ${reason}${ruleId}`, 4));
      lines.push(indent(`   actor  : ${r.principalId}`, 4));
      if (isBudget && r.budgetRemaining !== undefined) {
        lines.push(indent(`   budget : remaining=${r.budgetRemaining}`, 4));
      }
    }
  }
  lines.push('');

  // ── Section 2: Approvals ─────────────────────────────────────────────────
  const approvalRequested = auditRecords.filter((r) => r.eventType === 'approval.requested');
  const approvalResolved  = auditRecords.filter((r) => r.eventType === 'approval.resolved');

  lines.push(section('Approvals'));
  if (approvalRequested.length === 0) {
    lines.push(indent('(no approval gates in this session)'));
  } else {
    for (const req of approvalRequested) {
      const approvalKey = `${req.sessionId}::${req.taskId ?? ''}`;
      const resolved = approvalResolved.find(
        (r) => `${r.sessionId}::${r.taskId ?? ''}` === approvalKey
      );
      lines.push(indent(`${ts(req.startedAt)}  ⏳ approval.requested`));
      lines.push(indent(`   task   : ${req.taskId ?? '(none)'}`, 4));
      lines.push(indent(`   actor  : ${req.principalId}`, 4));
      if (resolved) {
        lines.push(indent(`   ${ts(resolved.startedAt)}  ✅ resolved`, 4));
      } else {
        lines.push(indent(`   (not yet resolved)`, 4));
      }
    }
  }
  lines.push('');

  // ── Section 3: Executions ────────────────────────────────────────────────
  const artifactsByProvenance = new Map<string, Artifact[]>();
  for (const art of artifacts) {
    const list = artifactsByProvenance.get(art.provenanceId) ?? [];
    list.push(art);
    artifactsByProvenance.set(art.provenanceId, list);
  }

  const blocks = buildInvocationBlocks(auditRecords, artifactsByProvenance);

  lines.push(section('Executions'));
  if (blocks.length === 0) {
    lines.push(indent('(no tool executions recorded)'));
  } else {
    for (const block of blocks) {
      const outcomeIcon = block.outcome === 'success' ? '✓' : block.outcome === 'error' ? '✗' : '…';
      const duration = block.finishedAt
        ? ` (${Math.max(0, Date.parse(block.finishedAt) - Date.parse(block.startedAt))}ms)`
        : '';
      lines.push(indent(`${ts(block.startedAt)}  ${outcomeIcon} ${block.tool}${duration}`));
      lines.push(indent(`   outcome : ${block.outcome}`, 4));
      lines.push(indent(`   actor   : ${block.principalId}`, 4));
      if (block.taskId) {
        lines.push(indent(`   task    : ${block.taskId}`, 4));
      }
      if (block.errorMessage) {
        lines.push(indent(`   error   : ${block.errorMessage}`, 4));
      }
      if (block.networkSummary) {
        lines.push(indent(`   network : ${block.networkSummary}`, 4));
      }
      if (block.artifacts.length > 0) {
        lines.push(indent(`   artifacts (${block.artifacts.length}):`, 4));
        for (const art of block.artifacts) {
          const label = art.label ? ` "${art.label}"` : '';
          lines.push(indent(`     • [${art.type}]${label} ${art.uri}  (${art.retentionClass})`, 4));
        }
      }
    }
  }
  lines.push('');

  // ── Section 4: Artifacts ─────────────────────────────────────────────────
  lines.push(section('Artifacts'));
  if (artifacts.length === 0) {
    lines.push(indent('(no artifacts in this session)'));
  } else {
    for (const art of artifacts) {
      const label = art.label ? ` "${art.label}"` : '';
      const invLink = art.invocationId ? `  invocation: ${art.invocationId}` : '';
      lines.push(indent(`• [${art.type}]${label}`));
      lines.push(indent(`  uri        : ${art.uri}`, 4));
      lines.push(indent(`  checksum   : ${art.checksum}`, 4));
      lines.push(indent(`  retention  : ${art.retentionClass}`, 4));
      lines.push(indent(`  provenance : ${art.provenanceId}${invLink}`, 4));
    }
  }
  lines.push('');

  // ── Footer ───────────────────────────────────────────────────────────────
  lines.push(HR_THICK);
  lines.push(`  End of summary  ·  ${manifest.recordCount} records  ·  ${artifacts.length} artifact(s)`);
  lines.push(HR_THICK);

  return lines.join('\n');
}

function buildInvocationBlocks(
  records: AuditRecord[],
  artifactsByProvenance: Map<string, Artifact[]>
): InvocationBlock[] {
  const blocks: InvocationBlock[] = [];
  const openMap = new Map<string, InvocationBlock>();

  const makeKey = (r: AuditRecord) =>
    [r.taskId ?? '', r.toolName ?? '', r.principalId].join('::');

  for (const r of records) {
    if (r.eventType === 'tool.started') {
      const block: InvocationBlock = {
        tool: r.toolName ?? '(unknown)',
        taskId: r.taskId,
        principalId: r.principalId,
        startedAt: r.startedAt,
        outcome: 'pending',
        artifacts: r.taskId ? (artifactsByProvenance.get(r.taskId) ?? []) : [],
      };
      openMap.set(makeKey(r), block);
      blocks.push(block);
    } else if (r.eventType === 'tool.finished') {
      const block = openMap.get(makeKey(r));
      if (block) {
        block.outcome = 'success';
        block.finishedAt = r.finishedAt ?? r.startedAt;
        if (r.networkTraceSummary) block.networkSummary = r.networkTraceSummary;
        openMap.delete(makeKey(r));
      }
    } else if (r.eventType === 'tool.error') {
      const block = openMap.get(makeKey(r));
      if (block) {
        block.outcome = 'error';
        block.finishedAt = r.finishedAt ?? r.startedAt;
        block.errorMessage = r.error;
        if (r.networkTraceSummary) block.networkSummary = r.networkTraceSummary;
        openMap.delete(makeKey(r));
      }
    }
  }

  return blocks;
}

// ---------------------------------------------------------------------------
// B. Replay diff UX — human-readable diff between two sessions
// ---------------------------------------------------------------------------

/**
 * Format a ReplayDiffResult as a human-readable diff summary.
 *
 * Highlights:
 *   • events present in A but not B
 *   • events present in B but not A
 *   • matched events whose semantics changed (decision, runtime, error)
 *
 * This is a pure function: no side effects.
 */
export function formatReplayDiff(diff: ReplayDiffResult): string {
  const lines: string[] = [];

  lines.push(HR_THICK);
  lines.push(`  Replay Diff`);
  lines.push(HR_THICK);
  lines.push(`  Session A : ${diff.sessionA}`);
  lines.push(`  Session B : ${diff.sessionB}`);
  lines.push('');

  if (diff.identical) {
    lines.push(`  ✅  Sessions are identical — no differences found.`);
    lines.push(HR_THICK);
    return lines.join('\n');
  }

  // ── Missing from B (removed events) ──────────────────────────────────────
  if (diff.onlyInA.length > 0) {
    lines.push(section('Only in A (removed from B)'));
    for (const r of diff.onlyInA) {
      lines.push(indent(`${ts(r.startedAt)}  − ${r.eventType}${r.toolName ? '  ' + r.toolName : ''}`));
      lines.push(indent(`   task   : ${r.taskId ?? '(none)'}`, 4));
      lines.push(indent(`   actor  : ${r.principalId}`, 4));
    }
    lines.push('');
  }

  // ── Present only in B (added events) ─────────────────────────────────────
  if (diff.onlyInB.length > 0) {
    lines.push(section('Only in B (added in B)'));
    for (const r of diff.onlyInB) {
      lines.push(indent(`${ts(r.startedAt)}  + ${r.eventType}${r.toolName ? '  ' + r.toolName : ''}`));
      lines.push(indent(`   task   : ${r.taskId ?? '(none)'}`, 4));
      lines.push(indent(`   actor  : ${r.principalId}`, 4));
    }
    lines.push('');
  }

  // ── Changed events ────────────────────────────────────────────────────────
  if (diff.changed.length > 0) {
    lines.push(section('Changed (matched events with different semantics)'));
    for (const { inA, inB, fields } of diff.changed) {
      lines.push(indent(`${ts(inA.startedAt)}  ~ ${inA.eventType}${inA.toolName ? '  ' + inA.toolName : ''}`));
      lines.push(indent(`   changed fields: ${fields.join(', ')}`, 4));

      if (fields.includes('error')) {
        lines.push(indent(`   error A : ${inA.error ?? '(none)'}`, 4));
        lines.push(indent(`   error B : ${inB.error ?? '(none)'}`, 4));
      }
      if (fields.includes('runtimeTarget')) {
        lines.push(indent(`   runtime A : ${inA.runtimeTarget ?? '(none)'}`, 4));
        lines.push(indent(`   runtime B : ${inB.runtimeTarget ?? '(none)'}`, 4));
      }
      if (fields.includes('policyDecision')) {
        const modeA = inA.policyDecision?.mode ?? '(none)';
        const modeB = inB.policyDecision?.mode ?? '(none)';
        const ruleA = inA.policyDecision?.matchedRuleId ?? '—';
        const ruleB = inB.policyDecision?.matchedRuleId ?? '—';
        lines.push(indent(`   decision A : ${modeA}  [rule: ${ruleA}]`, 4));
        lines.push(indent(`   decision B : ${modeB}  [rule: ${ruleB}]`, 4));
      }
    }
    lines.push('');
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  lines.push(HR_THIN);
  lines.push(`  Summary: ${diff.onlyInA.length} removed  ·  ${diff.onlyInB.length} added  ·  ${diff.changed.length} changed`);
  lines.push(HR_THICK);

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// C. Policy decision visualization
// ---------------------------------------------------------------------------

/**
 * Format a PolicyDecision (produced by PolicyEngine.explain()) into a
 * human-readable visualization of the rule evaluation.
 *
 * Shows:
 *   • Final decision (mode, matched rule, audit requirement)
 *   • Every rule evaluated in order
 *   • The first failing matcher for each rejected rule
 *   • The matched rule highlighted with '►'
 *
 * This is a pure function: no side effects.
 */
export function formatPolicyExplanation(decision: PolicyDecision): string {
  const lines: string[] = [];

  lines.push(HR_THICK);
  lines.push(`  Policy Explanation`);
  lines.push(HR_THICK);

  // ── Decision summary ─────────────────────────────────────────────────────
  const modeLabel = POLICY_MODE_LABEL[decision.mode] ?? decision.mode.toUpperCase();
  const outcomeIcon = decision.mode === 'deny' ? '⛔' : '✅';
  lines.push(`  ${outcomeIcon}  Decision : ${modeLabel}`);
  lines.push(`     reason  : ${decision.reason}`);
  if (decision.matchedRuleId) {
    lines.push(`     rule    : ${decision.matchedRuleId}`);
  }
  if (decision.allowedRuntimeTarget) {
    lines.push(`     runtime : ${decision.allowedRuntimeTarget}`);
  }
  lines.push(`     audit   : ${decision.auditRequired ? 'required' : 'not required'}`);
  if (decision.requiresApproval) {
    lines.push(`     approval: required`);
  }
  lines.push('');

  // ── Evaluation trace ─────────────────────────────────────────────────────
  if (!decision.evaluationTrace || decision.evaluationTrace.length === 0) {
    lines.push(indent('(no evaluation trace — use PolicyEngine.explain() to produce a trace)'));
    lines.push(HR_THICK);
    return lines.join('\n');
  }

  lines.push(section('Rule Evaluation Trace'));
  lines.push('');

  const steps: PolicyEvaluationStep[] = decision.evaluationTrace;
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const lineNum = String(i + 1).padStart(2, ' ');

    if (step.matched) {
      // Matched rule — highlighted
      lines.push(indent(`${lineNum}.  ► MATCHED   ${step.ruleId}`));
      lines.push(indent(`       "${step.ruleDescription}"`, 6));
    } else {
      // Rejected rule
      const failLabel = step.failedMatcher
        ? `stopped at matcher: ${step.failedMatcher}`
        : 'no matchers matched';
      lines.push(indent(`${lineNum}.    skipped   ${step.ruleId}`));
      lines.push(indent(`       "${step.ruleDescription}"`, 6));
      lines.push(indent(`       (${failLabel})`, 6));
    }
  }

  lines.push('');
  lines.push(HR_THIN);
  lines.push(`  ${steps.length} rule(s) evaluated  ·  matched: ${steps.filter((s) => s.matched).length}`);
  lines.push(HR_THICK);

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// D. Integrity visibility — audit integrity report
// ---------------------------------------------------------------------------

const INTEGRITY_SECTION: Record<AuditIntegrityViolationKind, string> = {
  unmatched_started:             'Lifecycle Errors',
  orphaned_finished:             'Lifecycle Errors',
  denial_without_policy:         'Policy Gaps',
  approval_lifecycle_incomplete: 'Missing Events',
};

/**
 * Format an AuditIntegrityResult as a human-readable integrity report.
 *
 * Violations are grouped by category:
 *   • Lifecycle Errors    — unmatched starts / orphaned finishes
 *   • Policy Gaps         — denials without policyDecision
 *   • Missing Events      — incomplete approval lifecycles
 *
 * A ✅ summary is printed when no violations are found.
 *
 * This is a pure function: no side effects.
 */
export function formatIntegrityReport(result: AuditIntegrityResult): string {
  const lines: string[] = [];

  lines.push(HR_THICK);
  lines.push(`  Audit Integrity Report`);
  lines.push(HR_THICK);

  if (result.valid) {
    lines.push(`  ✅  Integrity check passed — no violations found.`);
    lines.push(HR_THICK);
    return lines.join('\n');
  }

  // Group violations by category
  const groups = new Map<string, typeof result.violations>();
  for (const v of result.violations) {
    const cat = INTEGRITY_SECTION[v.kind];
    const list = groups.get(cat) ?? [];
    list.push(v);
    groups.set(cat, list);
  }

  const categoryOrder = ['Lifecycle Errors', 'Policy Gaps', 'Missing Events'];
  for (const cat of categoryOrder) {
    const vios = groups.get(cat);
    if (!vios) continue;

    lines.push(section(cat));
    for (const v of vios) {
      const kindLabel = VIOLATION_KIND_LABEL[v.kind].trimEnd();
      const tool = v.record.toolName ? `  tool: ${v.record.toolName}` : '';
      const taskId = v.record.taskId ? `  task: ${v.record.taskId}` : '';
      lines.push(indent(`⚠  [${kindLabel}]  ${ts(v.record.startedAt)}${tool}${taskId}`));
      lines.push(indent(`   ${v.message}`, 4));
    }
    lines.push('');
  }

  lines.push(HR_THIN);
  lines.push(`  Total violations: ${result.violations.length}`);

  // Summary line by category
  for (const cat of categoryOrder) {
    const vios = groups.get(cat);
    if (vios) lines.push(`    ${cat}: ${vios.length}`);
  }

  lines.push(HR_THICK);

  return lines.join('\n');
}
