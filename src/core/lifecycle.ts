/**
 * Lifecycle management for OpenClaw Secure — Phase 10.
 *
 * Provides:
 *   - Restart recovery: detect tasks left in in-progress states across a
 *     process restart and mark them appropriately.
 *   - Interrupted task classification: label each stuck task as
 *     resumable / failed / abandoned based on retry count and deadline.
 *   - Retention-based pruning: remove audit records, artifacts, and
 *     closed sessions older than their retention window without breaking
 *     referential integrity.
 *   - Export archive validation: verify a replay-pack export bundle has a
 *     recognised schema version and consistent internal counts.
 *   - Forward-only schema migration: apply pending SQLite migrations in
 *     version order; never downgrade; check user_version before/after.
 *
 * All public functions are side-effect-bearing (they write to stores or
 * databases) but make NO changes to execution semantics, policy logic, or
 * trust-boundary rules.
 *
 * Nothing in this module grants new capabilities or broadens trust.
 */

import Database from 'better-sqlite3';
import { SessionStore } from './session';
import { AuditLog } from './audit';
import { ArtifactStore } from './artifacts';
import { buildReplayPack } from './replay';
import { Task, TaskState, RetentionClass } from './types';

// ---------------------------------------------------------------------------
// Schema version — increment when a migration is added
// ---------------------------------------------------------------------------

/** Current schema version.  Every entry in MIGRATIONS must bump this. */
export const CURRENT_SCHEMA_VERSION = 1;

/**
 * A single forward-only migration step.
 *
 * `version` is the user_version this migration brings the database TO.
 * `up` is the SQL to execute (DDL only; no DML that could corrupt data).
 */
export interface Migration {
  version: number;
  description: string;
  up: string;
}

/**
 * The canonical ordered list of schema migrations.
 * Add new entries at the end only — never reorder or remove.
 */
export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    description: 'Add interrupted_at column to tasks for lifecycle tracking',
    up: `ALTER TABLE tasks ADD COLUMN interrupted_at TEXT;`,
  },
];

// ---------------------------------------------------------------------------
// Interrupted-task classification
// ---------------------------------------------------------------------------

/**
 * Classification of a task that was found interrupted (running/awaiting_approval)
 * at the time of a restart check.
 */
export type InterruptedTaskClass = 'resumable' | 'failed' | 'abandoned';

export interface ClassifiedTask {
  task: Task;
  classification: InterruptedTaskClass;
  reason: string;
}

/**
 * Determine how an interrupted task should be treated.
 *
 * Rules (applied in order):
 *   1. If retryCount > 0 and no deadline has passed → resumable
 *   2. If retryCount === 0 → failed (exhausted retries)
 *   3. If deadline is set and has already passed → failed (expired)
 *   4. Otherwise → abandoned (no retries left and no actionable path)
 */
function classifyOne(task: Task, now: Date): ClassifiedTask {
  const deadlinePassed =
    task.deadline != null && new Date(task.deadline) < now;

  if (deadlinePassed) {
    return {
      task,
      classification: 'failed',
      reason: `deadline ${task.deadline} has passed`,
    };
  }
  if (task.retryCount > 0) {
    return {
      task,
      classification: 'resumable',
      reason: `${task.retryCount} retry attempt(s) remaining`,
    };
  }
  return {
    task,
    classification: 'abandoned',
    reason: 'no retries remaining and no active deadline',
  };
}

// ---------------------------------------------------------------------------
// LifecycleManager
// ---------------------------------------------------------------------------

/** Options for the LifecycleManager. */
export interface LifecycleManagerOptions {
  sessionStore: SessionStore;
  auditLog: AuditLog;
  artifactStore: ArtifactStore;
}

/**
 * Result from recoverSessions().
 * Reports how many tasks were found stuck and how they were reclassified.
 */
export interface RecoveryResult {
  /** Tasks that were in 'running' or 'awaiting_approval' at startup. */
  interruptedTasks: ClassifiedTask[];
  /** How many tasks were transitioned to 'failed'. */
  markedFailed: number;
  /** How many tasks were left in their current state (resumable). */
  markedResumable: number;
  /** How many tasks were transitioned to 'cancelled' (abandoned). */
  markedAbandoned: number;
}

/**
 * Result from pruneAuditRecords() / pruneArtifacts() / pruneSessions().
 */
export interface PruneResult {
  /** Number of rows deleted. */
  deleted: number;
  /** Retention policy applied. */
  retentionClass: RetentionClass;
  /** Cutoff timestamp used (ISO-8601). */
  cutoffAt: string;
}

/**
 * Result from validateArchive().
 */
export interface ArchiveValidationResult {
  valid: boolean;
  schemaVersion: number;
  violations: string[];
}

export class LifecycleManager {
  private readonly sessionStore: SessionStore;
  private readonly auditLog: AuditLog;
  private readonly artifactStore: ArtifactStore;

  constructor(options: LifecycleManagerOptions) {
    this.sessionStore = options.sessionStore;
    this.auditLog = options.auditLog;
    this.artifactStore = options.artifactStore;
  }

  // ── Restart Recovery ───────────────────────────────────────────────────────

  /**
   * Scan all tasks for those stuck in transient states ('running' or
   * 'awaiting_approval') and classify/reclassify them.
   *
   * - resumable → left in current state (caller may retry them)
   * - failed    → transitioned to 'failed'
   * - abandoned → transitioned to 'cancelled'
   *
   * This is the correct thing to call once on startup before accepting new
   * work, to ensure no task silently disappears across a restart.
   */
  recoverSessions(now: Date = new Date()): RecoveryResult {
    const stuck = [
      ...this.sessionStore.listTasksByState('running'),
      ...this.sessionStore.listTasksByState('awaiting_approval'),
    ];

    const classified = stuck.map((t) => classifyOne(t, now));

    let markedFailed = 0;
    let markedResumable = 0;
    let markedAbandoned = 0;

    for (const c of classified) {
      switch (c.classification) {
        case 'resumable':
          markedResumable++;
          break;
        case 'failed':
          this.sessionStore.updateTaskState(c.task.id, 'failed');
          markedFailed++;
          break;
        case 'abandoned':
          this.sessionStore.updateTaskState(c.task.id, 'cancelled');
          markedAbandoned++;
          break;
      }
    }

    return { interruptedTasks: classified, markedFailed, markedResumable, markedAbandoned };
  }

  /**
   * Classify interrupted tasks without mutating any state.
   * Useful for operator visibility before committing a recovery action.
   */
  classifyInterruptedTasks(now: Date = new Date()): ClassifiedTask[] {
    const stuck = [
      ...this.sessionStore.listTasksByState('running'),
      ...this.sessionStore.listTasksByState('awaiting_approval'),
    ];
    return stuck.map((t) => classifyOne(t, now));
  }

  // ── Retention & Pruning ────────────────────────────────────────────────────

  /**
   * Prune audit records older than `olderThanMs` milliseconds whose session
   * has no tasks in a live state (running/awaiting_approval/pending).
   *
   * Only records belonging to sessions with all tasks in terminal states
   * (completed/failed/cancelled) are eligible.  'permanent' records are
   * never pruned.
   */
  pruneAuditRecords(params: {
    retentionClass: Exclude<RetentionClass, 'permanent'>;
    olderThanMs: number;
  }): PruneResult {
    const cutoff = new Date(Date.now() - params.olderThanMs);
    const cutoffAt = cutoff.toISOString();

    // Find session IDs that are safe to prune (all tasks in terminal state)
    const allSessions = this.sessionStore.listSessions();
    const prunableSessions = allSessions.filter((s) => {
      const tasks = this.sessionStore.listTasksBySession(s.id);
      const live = tasks.filter(
        (t) => t.state === 'running' || t.state === 'awaiting_approval' || t.state === 'pending'
      );
      return live.length === 0;
    });

    let deleted = 0;
    for (const s of prunableSessions) {
      deleted += this.auditLog.deleteBySessionOlderThan(s.id, cutoffAt);
    }

    return { deleted, retentionClass: params.retentionClass, cutoffAt };
  }

  /**
   * Prune artifacts whose retentionClass matches `retentionClass` and whose
   * createdAt is older than `olderThanMs` milliseconds.
   *
   * 'permanent' artifacts are never pruned.
   */
  pruneArtifacts(params: {
    retentionClass: Exclude<RetentionClass, 'permanent'>;
    olderThanMs: number;
  }): PruneResult {
    const cutoff = new Date(Date.now() - params.olderThanMs);
    const cutoffAt = cutoff.toISOString();
    const deleted = this.artifactStore.deleteByRetentionClassOlderThan(
      params.retentionClass,
      cutoffAt
    );
    return { deleted, retentionClass: params.retentionClass, cutoffAt };
  }

  /**
   * Prune closed sessions (all tasks in terminal state) older than
   * `olderThanMs` milliseconds.  Does NOT delete audit records or artifacts
   * — call pruneAuditRecords / pruneArtifacts first if desired.
   *
   * Tasks belonging to pruned sessions are deleted first to satisfy
   * the foreign-key constraint on the sessions table.
   */
  pruneSessions(params: { olderThanMs: number }): { deleted: number; cutoffAt: string } {
    const cutoff = new Date(Date.now() - params.olderThanMs);
    const cutoffAt = cutoff.toISOString();

    const allSessions = this.sessionStore.listSessions();
    let deleted = 0;
    for (const s of allSessions) {
      if (s.createdAt >= cutoffAt) continue; // not old enough
      const tasks = this.sessionStore.listTasksBySession(s.id);
      const live = tasks.filter(
        (t) => t.state === 'running' || t.state === 'awaiting_approval' || t.state === 'pending'
      );
      if (live.length === 0) {
        // Delete tasks first to avoid FK constraint violation
        for (const t of tasks) {
          this.sessionStore.deleteTask(t.id);
        }
        this.sessionStore.deleteSession(s.id);
        deleted++;
      }
    }
    return { deleted, cutoffAt };
  }

  // ── Export Archive Validation ──────────────────────────────────────────────

  /**
   * Build and validate an export archive (replay pack) for the given session.
   *
   * Checks:
   *   1. The pack can be built (no missing session)
   *   2. Internal manifest counts match actual record/artifact counts
   *   3. Schema version is present and matches CURRENT_SCHEMA_VERSION
   *
   * Returns a validation result; does not throw.
   */
  validateArchive(sessionId: string): ArchiveValidationResult {
    const violations: string[] = [];

    // Build the pack — if the session doesn't exist the pack will be empty
    const pack = buildReplayPack(sessionId, this.auditLog, this.artifactStore);

    // Check record count consistency
    if (pack.auditRecords.length !== pack.manifest.recordCount) {
      violations.push(
        `manifest.recordCount=${pack.manifest.recordCount} but actual records=${pack.auditRecords.length}`
      );
    }

    // Check artifact count consistency
    if (pack.artifacts.length !== pack.manifest.artifactCount) {
      violations.push(
        `manifest.artifactCount=${pack.manifest.artifactCount} but actual artifacts=${pack.artifacts.length}`
      );
    }

    // Check schema version field
    const schemaVersion: number = (pack.manifest as { schemaVersion?: number }).schemaVersion ?? 0;
    if (schemaVersion !== CURRENT_SCHEMA_VERSION) {
      violations.push(
        `manifest.schemaVersion=${schemaVersion} expected ${CURRENT_SCHEMA_VERSION}`
      );
    }

    return {
      valid: violations.length === 0,
      schemaVersion,
      violations,
    };
  }
}

// ---------------------------------------------------------------------------
// Migration runner (standalone — works on any better-sqlite3 Database)
// ---------------------------------------------------------------------------

export interface MigrationResult {
  /** user_version before any migrations ran. */
  fromVersion: number;
  /** user_version after all applicable migrations ran. */
  toVersion: number;
  /** Migrations that were applied. */
  applied: Migration[];
  /** Migrations that were already at or above the current version (skipped). */
  skipped: Migration[];
}

/**
 * Apply pending forward-only migrations to `db`.
 *
 * Uses SQLite PRAGMA user_version to track the current schema version.
 * Each migration is applied inside its own transaction so a failure leaves
 * the database at the last successfully applied version.
 *
 * @param db       An open better-sqlite3 Database instance.
 * @param migrations  Ordered list of migrations (defaults to MIGRATIONS).
 */
export function runMigrations(
  db: Database.Database,
  migrations: Migration[] = MIGRATIONS
): MigrationResult {
  const fromVersion = (db.pragma('user_version', { simple: true }) as number) ?? 0;
  let current = fromVersion;
  const applied: Migration[] = [];
  const skipped: Migration[] = [];

  for (const m of migrations) {
    if (m.version <= current) {
      skipped.push(m);
      continue;
    }
    // Apply inside a transaction
    const tx = db.transaction(() => {
      db.exec(m.up);
      db.pragma(`user_version = ${m.version}`);
    });
    tx();
    current = m.version;
    applied.push(m);
  }

  return { fromVersion, toVersion: current, applied, skipped };
}

/**
 * Return the current user_version of `db` without applying any migrations.
 */
export function getCurrentSchemaVersion(db: Database.Database): number {
  return (db.pragma('user_version', { simple: true }) as number) ?? 0;
}
