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
import { PolicyRule } from './policy';

export interface PolicyRuleStoreOptions {
  dbPath: string;
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
