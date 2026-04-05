# CONTRIBUTING_GUARDRAILS.md

## OpenClaw Safe — Architectural Guardrails

This document defines **non-negotiable rules** for all contributors and coding agents.

---

## 1. Core Execution Flow (MANDATORY)

All tool execution MUST follow:

Agent Runtime → Tool Broker → Policy Engine → (Approval if required) → Runtime → Audit Log

Any deviation is a defect.

---

## 2. Architectural Invariants

- No tool executes without policy evaluation
- No runtime executes without broker-issued lease
- Policy engine is pure (no DB, no HTTP, no side effects)
- Sandbox is default execution target
- Host execution is break-glass only (explicit + approved)
- Audit logging is append-only and mandatory
- Sessions and tasks are separate entities
- Chat history is NOT source of truth
- Plugins are isolated by default
- Secrets are never exposed to model by default

---

## 3. Forbidden Patterns

- Agent calling runtime directly
- Gateway invoking tools without broker
- Plugins executing host commands directly
- Silent sandbox → host fallback
- Skipping approval because "trusted user"
- Unsafe type casting at API boundaries
- Logging secrets or sensitive data
- Expanding permissions to make tests pass

---

## 4. Package Boundaries

- policy-engine must not import gateway, store, or runtime code
- agent-runtime must not import runtime implementations
- channel adapters must not invoke tools directly
- runtime packages must not import transport layers
- contracts package must remain dependency-neutral

---

## 5. Input Validation Rules

All external inputs MUST be:
- parsed
- validated
- type-safe

Never trust:
- query parameters
- request bodies
- plugin input
- model-generated tool arguments

---

## 6. Approval Enforcement

Approval classes (A–F) must:
- be reachable via API
- be enforced consistently
- not be bypassable

Approval scope must be explicit:
- once
- session
- task
- policy_rule

---

## 7. Audit Requirements

Every operation must emit:

- policy.decision
- approval.requested (if applicable)
- approval.resolved (if applicable)
- tool.execution.started
- tool.execution.finished
- artifact.created (if applicable)

No silent execution paths.

---

## 8. Security Requirements

- No raw shell execution without validation
- No unrestricted filesystem access
- No unrestricted network access
- No eval/dynamic code in control plane
- No wildcard allowlists
- No secret leakage in logs or prompts

---

## 9. Testing Requirements

Minimum coverage must include:

- Policy engine unit tests
- Broker + policy integration tests
- Sandbox boundary tests
- Approval enforcement tests
- Denial path tests
- End-to-end agent flow

---

## 10. Trust Model

This system operates under:

- Model is untrusted
- Inputs are untrusted
- Behavior must be verifiable

Trust is earned through:
- constraints
- enforcement
- auditability
- repeatable behavior

---

## 11. Contribution Rule

If a change:
- weakens constraints
- bypasses enforcement
- reduces audit visibility
- introduces implicit trust

It must be rejected.

---

## 12. Definition of Done

A change is complete only if:

- All invariants are preserved
- Tests pass AND include new coverage if needed
- No architectural shortcuts are introduced
- Audit trail remains complete
- Security posture is unchanged or improved

---

## Bottom Line

Do not optimize for convenience.

Optimize for:
- safety
- correctness
- auditability
- long-term integrity
