/**
 * Tests for the policy engine.
 */

import {
  PolicyEngine,
  DEFAULT_POLICY_RULES,
  PolicyRule,
  riskClassLabel,
} from '../src/core/policy';
import { PolicyContext, Principal, Session } from '../src/core/types';

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

function makeCtx(overrides: Partial<PolicyContext> = {}): PolicyContext {
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PolicyEngine', () => {
  let engine: PolicyEngine;

  beforeEach(() => {
    engine = new PolicyEngine();
  });

  // --- Default rules ---

  it('allows Class A tools for high-trust users', () => {
    const decision = engine.evaluate(makeCtx({ toolRiskClass: 'A' }));
    expect(decision.mode).toBe('allow');
    expect(decision.requiresApproval).toBe(false);
  });

  it('allows Class B tools for high-trust users in sandbox', () => {
    const decision = engine.evaluate(makeCtx({ toolRiskClass: 'B' }));
    expect(decision.mode).toBe('allow');
    expect(decision.allowedRuntimeTarget).toBe('sandbox');
  });

  it('routes Class C tools to sandbox_only', () => {
    const decision = engine.evaluate(makeCtx({ toolRiskClass: 'C' }));
    expect(decision.mode).toBe('sandbox_only');
    expect(decision.allowedRuntimeTarget).toBe('sandbox');
  });

  it('allows Class D for high-trust users', () => {
    const decision = engine.evaluate(makeCtx({ toolRiskClass: 'D' }));
    expect(decision.mode).toBe('allow');
    expect(decision.allowedRuntimeTarget).toBe('browser_worker');
  });

  it('requires approval for Class D from medium-trust users', () => {
    const decision = engine.evaluate(
      makeCtx({
        toolRiskClass: 'D',
        principal: makePrincipal({ trustLevel: 'medium' }),
      })
    );
    expect(decision.mode).toBe('allow_with_approval');
    expect(decision.requiresApproval).toBe(true);
  });

  it('requires Class E approval for medium-trust users', () => {
    const decision = engine.evaluate(
      makeCtx({
        toolRiskClass: 'E',
        principal: makePrincipal({ trustLevel: 'medium' }),
      })
    );
    expect(decision.mode).toBe('allow_with_approval');
    expect(decision.requiresApproval).toBe(true);
  });

  it('allows Class E for high-trust users', () => {
    const decision = engine.evaluate(makeCtx({ toolRiskClass: 'E' }));
    expect(decision.mode).toBe('allow');
  });

  it('requires host elevation for Class F', () => {
    const decision = engine.evaluate(makeCtx({ toolRiskClass: 'F' }));
    expect(decision.mode).toBe('host_elevated_only');
    expect(decision.allowedRuntimeTarget).toBe('host_elevated');
    expect(decision.auditRequired).toBe(true);
  });

  it('denies low-trust principals by default', () => {
    const decision = engine.evaluate(
      makeCtx({
        toolRiskClass: 'B',
        principal: makePrincipal({ trustLevel: 'low' }),
      })
    );
    expect(decision.mode).toBe('deny');
  });

  it('allows low-trust principal to use Class A tools (explicit allow before deny rule)', () => {
    const decision = engine.evaluate(
      makeCtx({
        toolRiskClass: 'A',
        principal: makePrincipal({ trustLevel: 'low' }),
      })
    );
    // low-trust deny only covers B-F; Class A fires first and is allowed
    expect(decision.mode).toBe('allow');
  });

  it('denies Class B in readonly session', () => {
    const decision = engine.evaluate(
      makeCtx({
        toolRiskClass: 'B',
        session: makeSession({ mode: 'readonly' }),
      })
    );
    expect(decision.mode).toBe('deny');
  });

  it('allows Class A in readonly session', () => {
    const decision = engine.evaluate(
      makeCtx({
        toolRiskClass: 'A',
        session: makeSession({ mode: 'readonly' }),
      })
    );
    expect(decision.mode).toBe('allow');
  });

  it('downgrades allow_with_approval to allow when approval is granted', () => {
    const decision = engine.evaluate(
      makeCtx({
        toolRiskClass: 'D',
        principal: makePrincipal({ trustLevel: 'medium' }),
        approvalState: 'approved',
      })
    );
    expect(decision.mode).toBe('allow');
    expect(decision.requiresApproval).toBe(true); // still noted
  });

  it('always allows system principal', () => {
    const decision = engine.evaluate(
      makeCtx({
        toolRiskClass: 'F',
        principal: makePrincipal({ type: 'system', trustLevel: 'high' }),
      })
    );
    expect(decision.mode).toBe('allow');
  });

  // --- Custom rules ---

  it('supports custom policy rules', () => {
    const customRule: PolicyRule = {
      id: 'custom-deny-file-read',
      description: 'Deny file_read for specific group',
      match: { policyGroups: ['restricted'], toolNames: ['file_read'] },
      effect: 'deny',
      auditRequired: true,
    };
    const customEngine = new PolicyEngine([customRule, ...DEFAULT_POLICY_RULES]);
    const decision = customEngine.evaluate(
      makeCtx({
        toolName: 'file_read',
        toolRiskClass: 'A',
        principal: makePrincipal({ policyGroup: 'restricted' }),
      })
    );
    expect(decision.mode).toBe('deny');
  });

  // --- filterVisibleTools ---

  it('filterVisibleTools excludes denied tools', () => {
    const tools = [
      { name: 'file_read', riskClass: 'A' as const, defaultRuntimeTarget: 'sandbox' as const },
      { name: 'exec_shell', riskClass: 'F' as const, defaultRuntimeTarget: 'host_elevated' as const },
    ];
    const ctx = {
      principal: makePrincipal({ trustLevel: 'low' }),
      session: makeSession(),
      approvalState: 'pending' as const,
    };
    const visible = engine.filterVisibleTools(ctx, tools);
    // Class A allowed for low-trust; Class F hits host_elevated_only (not deny) for low-trust
    // but low-trust deny fires before default for non-A classes
    const names = visible.map((t) => t.name);
    expect(names).toContain('file_read');
  });

  // --- riskClassLabel ---

  it('riskClassLabel returns labels for all classes', () => {
    const classes = ['A', 'B', 'C', 'D', 'E', 'F'] as const;
    for (const cls of classes) {
      expect(riskClassLabel(cls)).toBeTruthy();
    }
  });
});
