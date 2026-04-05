/**
 * Policy engine for OpenClaw Secure.
 *
 * The policy engine is the heart of the security redesign.
 * It decides:
 *   - who can trigger an agent
 *   - what context is visible
 *   - which tools are even visible to the model
 *   - which tool calls are allowed
 *   - which runtime may execute them
 *   - whether approval is required
 *   - what network, file, process, and secret scope applies
 *
 * Guiding rule: The model is never trusted.
 * The gateway is never ambiently privileged.
 * The sandbox is the default executor.
 */

import {
  PolicyContext,
  PolicyDecision,
  PolicyMode,
  ToolRiskClass,
  RuntimeTarget,
  TrustLevel,
} from './types';

// ---------------------------------------------------------------------------
// Policy rule definition
// ---------------------------------------------------------------------------

export interface PolicyRule {
  id: string;
  description: string;
  /** If all matchers are satisfied, this rule fires. */
  match: PolicyRuleMatch;
  effect: PolicyMode;
  /** Override the allowed runtime target. */
  allowedRuntimeTarget?: RuntimeTarget;
  auditRequired: boolean;
}

export interface PolicyRuleMatch {
  principalTypes?: string[];
  trustLevels?: TrustLevel[];
  policyGroups?: string[];
  toolNames?: string[];
  riskClasses?: ToolRiskClass[];
  sessionModes?: string[];
  requiresElevation?: boolean;
  networkDomains?: string[];
  approvalStates?: string[];
}

// ---------------------------------------------------------------------------
// Default policy rules
// ---------------------------------------------------------------------------

/**
 * Default policy rules applied when no custom ruleset is provided.
 * Rules are evaluated in order; the first match wins.
 */
export const DEFAULT_POLICY_RULES: PolicyRule[] = [
  // System principals always allowed (internal only)
  {
    id: 'system-allow',
    description: 'System principal may perform any operation',
    match: { principalTypes: ['system'] },
    effect: 'allow',
    auditRequired: true,
  },
  // Readonly session: deny writes before any class-level allow fires
  {
    id: 'readonly-session-deny-writes',
    description: 'Readonly sessions cannot use write tools',
    match: { sessionModes: ['readonly'], riskClasses: ['B', 'C', 'D', 'E', 'F'] },
    effect: 'deny',
    auditRequired: true,
  },
  // Low-trust principal: deny everything except Class A before class-level rules
  {
    id: 'low-trust-deny-non-readonly',
    description: 'Low-trust principals may only use Class A tools',
    match: { trustLevels: ['low'], riskClasses: ['B', 'C', 'D', 'E', 'F'] },
    effect: 'deny',
    auditRequired: true,
  },
  // Class F (secrets/host elevation) always requires approval and host elevation
  {
    id: 'class-f-require-elevation',
    description: 'Class F tools require explicit host elevation and approval',
    match: { riskClasses: ['F'] },
    effect: 'host_elevated_only',
    allowedRuntimeTarget: 'host_elevated',
    auditRequired: true,
  },
  // Class E (external side effects) requires approval from non-high-trust principals
  {
    id: 'class-e-medium-low-approval',
    description: 'Class E tools require approval for medium/low trust principals',
    match: { riskClasses: ['E'], trustLevels: ['medium', 'low'] },
    effect: 'allow_with_approval',
    allowedRuntimeTarget: 'sandbox',
    auditRequired: true,
  },
  {
    id: 'class-e-high-allow',
    description: 'Class E tools allowed for high-trust principals',
    match: { riskClasses: ['E'], trustLevels: ['high'] },
    effect: 'allow',
    allowedRuntimeTarget: 'sandbox',
    auditRequired: true,
  },
  // Class D (browser/network) requires domain allowlist; approval for medium/low
  {
    id: 'class-d-medium-low-approval',
    description: 'Class D tools require approval for medium/low trust principals',
    match: { riskClasses: ['D'], trustLevels: ['medium', 'low'] },
    effect: 'allow_with_approval',
    allowedRuntimeTarget: 'browser_worker',
    auditRequired: true,
  },
  {
    id: 'class-d-high-allow',
    description: 'Class D tools allowed for high-trust principals',
    match: { riskClasses: ['D'], trustLevels: ['high'] },
    effect: 'allow',
    allowedRuntimeTarget: 'browser_worker',
    auditRequired: true,
  },
  // Class C (sandbox process execution) runs in sandbox only
  {
    id: 'class-c-sandbox-only',
    description: 'Class C tools execute in sandbox only',
    match: { riskClasses: ['C'] },
    effect: 'sandbox_only',
    allowedRuntimeTarget: 'sandbox',
    auditRequired: true,
  },
  // Class B (workspace write) allowed in sandbox
  {
    id: 'class-b-sandbox',
    description: 'Class B tools allowed in sandbox',
    match: { riskClasses: ['B'] },
    effect: 'allow',
    allowedRuntimeTarget: 'sandbox',
    auditRequired: true,
  },
  // Class A (read-only) always allowed
  {
    id: 'class-a-allow',
    description: 'Class A read-only tools always allowed',
    match: { riskClasses: ['A'] },
    effect: 'allow',
    allowedRuntimeTarget: 'sandbox',
    auditRequired: false,
  },
  // Default allow for remaining (medium/high trust)
  {
    id: 'default-allow',
    description: 'Default: allow with audit',
    match: {},
    effect: 'allow',
    allowedRuntimeTarget: 'sandbox',
    auditRequired: true,
  },
];

// ---------------------------------------------------------------------------
// Policy engine
// ---------------------------------------------------------------------------

export class PolicyEngine {
  private rules: PolicyRule[];

  constructor(rules: PolicyRule[] = DEFAULT_POLICY_RULES) {
    this.rules = rules;
  }

  /**
   * Evaluate the policy for the given context and return a decision.
   * Rules are evaluated in order; the first matching rule wins.
   */
  /**
   * Replace the active ruleset at runtime (used by the policy editor).
   * Rules are evaluated in the new order immediately; no restart required.
   */
  setRules(rules: PolicyRule[]): void {
    this.rules = rules;
  }

  getRules(): PolicyRule[] {
    return [...this.rules];
  }

  evaluate(ctx: PolicyContext): PolicyDecision {
    for (const rule of this.rules) {
      if (this.matchesRule(rule, ctx)) {
        return this.buildDecision(rule, ctx);
      }
    }
    // Fallback: deny
    return {
      mode: 'deny',
      reason: 'No matching policy rule; default deny',
      requiresApproval: false,
      auditRequired: true,
    };
  }

  /**
   * Return only the tools whose schemas are visible to this principal/session
   * (i.e., the policy does not produce 'deny' or 'readonly_visibility').
   */
  filterVisibleTools(
    ctx: Omit<PolicyContext, 'toolName' | 'toolRiskClass' | 'runtimeTarget'>,
    allTools: Array<{ name: string; riskClass: ToolRiskClass; defaultRuntimeTarget: RuntimeTarget }>
  ): Array<{ name: string; riskClass: ToolRiskClass; defaultRuntimeTarget: RuntimeTarget }> {
    return allTools.filter((tool) => {
      const decision = this.evaluate({
        ...ctx,
        toolName: tool.name,
        toolRiskClass: tool.riskClass,
        runtimeTarget: tool.defaultRuntimeTarget,
      });
      return decision.mode !== 'deny';
    });
  }

  private matchesRule(rule: PolicyRule, ctx: PolicyContext): boolean {
    const m = rule.match;

    if (m.principalTypes && !m.principalTypes.includes(ctx.principal.type)) return false;
    if (m.trustLevels && !m.trustLevels.includes(ctx.principal.trustLevel)) return false;
    if (m.policyGroups && !m.policyGroups.includes(ctx.principal.policyGroup)) return false;
    if (m.toolNames && !m.toolNames.includes(ctx.toolName)) return false;
    if (m.riskClasses && !m.riskClasses.includes(ctx.toolRiskClass)) return false;
    if (m.sessionModes && !m.sessionModes.includes(ctx.session.mode)) return false;
    if (m.requiresElevation !== undefined && m.requiresElevation !== ctx.session.elevationState)
      return false;
    if (m.networkDomains && ctx.networkDomain && !m.networkDomains.includes(ctx.networkDomain))
      return false;
    if (m.approvalStates && !m.approvalStates.includes(ctx.approvalState)) return false;

    return true;
  }

  private buildDecision(rule: PolicyRule, ctx: PolicyContext): PolicyDecision {
    const requiresApproval = rule.effect === 'allow_with_approval';

    // If approval is required but already granted, downgrade to allow
    const effectiveMode: PolicyMode =
      requiresApproval && ctx.approvalState === 'approved' ? 'allow' : rule.effect;

    return {
      mode: effectiveMode,
      reason: rule.description,
      requiresApproval,
      allowedRuntimeTarget: rule.allowedRuntimeTarget,
      auditRequired: rule.auditRequired,
    };
  }
}

// ---------------------------------------------------------------------------
// Helper: derive human-readable risk summary
// ---------------------------------------------------------------------------

export function riskClassLabel(cls: ToolRiskClass): string {
  const labels: Record<ToolRiskClass, string> = {
    A: 'Read-only / low risk',
    B: 'Workspace write / artifact creation',
    C: 'Sandbox process execution',
    D: 'Browser / network actions',
    E: 'External side effects / channel send',
    F: 'Secrets / host elevation / device-sensitive',
  };
  return labels[cls];
}
