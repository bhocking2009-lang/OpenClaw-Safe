/**
 * Policy rule store for OpenClaw Secure.
 *
 * Persists policy rules to SQLite so they survive restarts and can be
 * edited at runtime via the policy editor API.
 *
 * Rules are loaded into the PolicyEngine via PolicyEngine.setRules().
 * Rule ordering is preserved; lower `order` values fire first.
 */

import Database from 'better-sqlite3';
import { PolicyRule, PolicyRuleMatch } from './policy';
import { ToolRiskClass, RuntimeTarget, TrustLevel, PolicyMode } from './types';

export interface PolicyRuleStoreOptions {
  dbPath: string;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const VALID_EFFECTS: PolicyMode[] = [
  'deny', 'allow', 'allow_with_approval', 'sandbox_only', 'host_elevated_only', 'readonly_visibility',
];
const VALID_RISK_CLASSES: ToolRiskClass[] = ['A', 'B', 'C', 'D', 'E', 'F'];
const VALID_RUNTIME_TARGETS: RuntimeTarget[] = [
  'sandbox', 'browser_worker', 'node_bridge', 'plugin_worker', 'media_worker', 'host_elevated',
];
const VALID_TRUST_LEVELS: TrustLevel[] = ['high', 'medium', 'low'];

export interface PolicyRuleValidationError {
  field: string;
  message: string;
}

/**
 * Validate a PolicyRule against the known enum sets.
 * Returns an array of errors; empty array means the rule is valid.
 */
export function validatePolicyRule(rule: Partial<PolicyRule>): PolicyRuleValidationError[] {
  const errors: PolicyRuleValidationError[] = [];

  if (!rule.id || typeof rule.id !== 'string' || !rule.id.trim()) {
    errors.push({ field: 'id', message: 'id is required and must be a non-empty string' });
  }
  if (!rule.description || typeof rule.description !== 'string' || !rule.description.trim()) {
    errors.push({ field: 'description', message: 'description is required and must be a non-empty string' });
  }
  if (!rule.effect || !VALID_EFFECTS.includes(rule.effect)) {
    errors.push({ field: 'effect', message: `effect must be one of: ${VALID_EFFECTS.join(', ')}` });
  }
  if (rule.allowedRuntimeTarget !== undefined && !VALID_RUNTIME_TARGETS.includes(rule.allowedRuntimeTarget)) {
    errors.push({ field: 'allowedRuntimeTarget', message: `allowedRuntimeTarget must be one of: ${VALID_RUNTIME_TARGETS.join(', ')}` });
  }

  const match = rule.match as PolicyRuleMatch | undefined;
  if (match) {
    if (match.riskClasses) {
      const bad = match.riskClasses.filter((c) => !VALID_RISK_CLASSES.includes(c as ToolRiskClass));
      if (bad.length) errors.push({ field: 'match.riskClasses', message: `unknown risk class(es): ${bad.join(', ')}` });
    }
    if (match.trustLevels) {
      const bad = match.trustLevels.filter((t) => !VALID_TRUST_LEVELS.includes(t as TrustLevel));
      if (bad.length) errors.push({ field: 'match.trustLevels', message: `unknown trust level(s): ${bad.join(', ')}` });
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Export / import types
// ---------------------------------------------------------------------------

export interface ExportedRuleSet {
  version: '1';
  exportedAt: string;
  rules: Array<PolicyRule & { order: number }>;
}

export class PolicyRuleStore {
  private db: Database.Database;

  constructor(options: PolicyRuleStoreOptions) {
    this.db = new Database(options.dbPath);
    this.initialize();
  }

  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS policy_rules (
        id TEXT PRIMARY KEY,
        description TEXT NOT NULL,
        match_json TEXT NOT NULL,
        effect TEXT NOT NULL,
        allowed_runtime_target TEXT,
        audit_required INTEGER NOT NULL DEFAULT 1,
        rule_order INTEGER NOT NULL DEFAULT 100,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_rules_order ON policy_rules(rule_order ASC);
    `);
  }

  // ---------------------------------------------------------------------------
  // CRUD
  // ---------------------------------------------------------------------------

  upsertRule(rule: PolicyRule, order: number = 100): PolicyRule {
    const now = new Date().toISOString();
    const existing = this.getRule(rule.id);
    if (existing) {
      this.db
        .prepare(
          `UPDATE policy_rules
           SET description = ?, match_json = ?, effect = ?,
               allowed_runtime_target = ?, audit_required = ?,
               rule_order = ?, updated_at = ?
           WHERE id = ?`
        )
        .run(
          rule.description,
          JSON.stringify(rule.match),
          rule.effect,
          rule.allowedRuntimeTarget ?? null,
          rule.auditRequired ? 1 : 0,
          order,
          now,
          rule.id
        );
    } else {
      this.db
        .prepare(
          `INSERT INTO policy_rules
             (id, description, match_json, effect, allowed_runtime_target,
              audit_required, rule_order, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          rule.id,
          rule.description,
          JSON.stringify(rule.match),
          rule.effect,
          rule.allowedRuntimeTarget ?? null,
          rule.auditRequired ? 1 : 0,
          order,
          now,
          now
        );
    }
    return rule;
  }

  getRule(id: string): PolicyRule | undefined {
    const row = this.db
      .prepare('SELECT * FROM policy_rules WHERE id = ?')
      .get(id) as RawRule | undefined;
    return row ? deserialize(row) : undefined;
  }

  listRules(): PolicyRule[] {
    return (
      this.db
        .prepare('SELECT * FROM policy_rules ORDER BY rule_order ASC, created_at ASC')
        .all() as RawRule[]
    ).map(deserialize);
  }

  deleteRule(id: string): boolean {
    const result = this.db.prepare('DELETE FROM policy_rules WHERE id = ?').run(id);
    return result.changes > 0;
  }

  // ---------------------------------------------------------------------------
  // Export / import
  // ---------------------------------------------------------------------------

  /**
   * Export all rules as a versioned snapshot.
   * The result is JSON-serialisable and can be stored, diffed, or imported.
   */
  exportRules(): ExportedRuleSet {
    const raw = this.db
      .prepare('SELECT * FROM policy_rules ORDER BY rule_order ASC, created_at ASC')
      .all() as Array<RawRule & { rule_order: number }>;

    return {
      version: '1',
      exportedAt: new Date().toISOString(),
      rules: raw.map((row) => ({ ...deserialize(row), order: row.rule_order })),
    };
  }

  /**
   * Import a rule set.
   *
   * @param data  - A previously exported rule set.
   * @param merge - If true, merge with existing rules (existing rules with the
   *                same id are overwritten; others are kept).
   *                If false (default), the store is completely replaced.
   */
  importRules(data: ExportedRuleSet, merge = false): void {
    if (data.version !== '1') {
      throw new Error(`Unsupported ruleset version: ${data.version}`);
    }

    this.db.transaction(() => {
      if (!merge) {
        this.db.prepare('DELETE FROM policy_rules').run();
      }
      for (const rule of data.rules) {
        this.upsertRule(rule, rule.order);
      }
    })();
  }

  close(): void {
    this.db.close();
  }
}

// ---------------------------------------------------------------------------
// Internal deserialization
// ---------------------------------------------------------------------------

interface RawRule {
  id: string;
  description: string;
  match_json: string;
  effect: string;
  allowed_runtime_target: string | null;
  audit_required: number;
  rule_order: number;
}

function deserialize(row: RawRule): PolicyRule {
  return {
    id: row.id,
    description: row.description,
    match: JSON.parse(row.match_json) as PolicyRule['match'],
    effect: row.effect as PolicyRule['effect'],
    allowedRuntimeTarget: row.allowed_runtime_target
      ? (row.allowed_runtime_target as PolicyRule['allowedRuntimeTarget'])
      : undefined,
    auditRequired: row.audit_required === 1,
  };
}
