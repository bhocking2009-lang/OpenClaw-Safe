/**
 * Phase 10 — Persistence, Recovery, and Lifecycle tests.
 *
 * Covers:
 *   A. Restart/recovery        — stuck task detection and reclassification
 *   B. Interrupted task state  — resumable / failed / abandoned classification
 *   C. Pruning / retention     — audit record and artifact pruning, session pruning
 *   D. Migration               — forward-only schema migrations, user_version guard
 *   E. Export/archive          — archive validation with manifest consistency
 */

import Database from 'better-sqlite3';
import {
  LifecycleManager,
  runMigrations,
  getCurrentSchemaVersion,
  CURRENT_SCHEMA_VERSION,
  MIGRATIONS,
  Migration,
} from '../src/core/lifecycle';
import { SessionStore } from '../src/core/session';
import { AuditLog } from '../src/core/audit';
import { ArtifactStore } from '../src/core/artifacts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStores() {
  const sessionStore = new SessionStore({ dbPath: ':memory:' });
  const auditLog = new AuditLog({ dbPath: ':memory:' });
  const artifactStore = new ArtifactStore({ dbPath: ':memory:' });
  return { sessionStore, auditLog, artifactStore };
}

function makeManager(stores: ReturnType<typeof makeStores>) {
  return new LifecycleManager(stores);
}

function closeStores(stores: ReturnType<typeof makeStores>) {
  stores.sessionStore.close();
  stores.auditLog.close();
  stores.artifactStore.close();
}

/** Helper: create a session and a task in the given state. */
function makeSessionWithTask(
  stores: ReturnType<typeof makeStores>,
  taskState: 'running' | 'awaiting_approval' | 'pending' | 'completed' | 'failed' | 'cancelled',
  opts: { retryCount?: number; deadline?: string } = {}
) {
  const session = stores.sessionStore.createSession({
    principalId: 'p-1',
    agentId: 'a-1',
    mode: 'task',
  });
  const task = stores.sessionStore.createTask({
    sessionId: session.id,
    title: 'test task',
    ownerId: 'p-1',
  });
  if (taskState !== 'pending') {
    stores.sessionStore.updateTaskState(task.id, taskState);
  }
  if (opts.retryCount !== undefined) {
    // Directly set retryCount via the DB (the store doesn't expose this)
    // We use a workaround: create, then manually patch the row for test isolation.
    // In production the broker decrements retryCount on failure; here we just
    // ensure the classification function sees the value we intend.
    stores.sessionStore['db']
      ?.prepare('UPDATE tasks SET retry_count = ? WHERE id = ?')
      .run(opts.retryCount, task.id);
  }
  if (opts.deadline !== undefined) {
    stores.sessionStore['db']
      ?.prepare('UPDATE tasks SET deadline = ? WHERE id = ?')
      .run(opts.deadline, task.id);
  }
  return { session, task };
}

// ---------------------------------------------------------------------------
// A. Restart / Recovery
// ---------------------------------------------------------------------------

describe('LifecycleManager.recoverSessions()', () => {
  it('returns empty result when no stuck tasks exist', () => {
    const stores = makeStores();
    const mgr = makeManager(stores);
    const result = mgr.recoverSessions();
    expect(result.interruptedTasks).toHaveLength(0);
    expect(result.markedFailed).toBe(0);
    expect(result.markedResumable).toBe(0);
    expect(result.markedAbandoned).toBe(0);
    closeStores(stores);
  });

  it('detects a running task and marks it resumable when retries remain', () => {
    const stores = makeStores();
    const mgr = makeManager(stores);
    makeSessionWithTask(stores, 'running', { retryCount: 2 });
    const result = mgr.recoverSessions();
    expect(result.interruptedTasks).toHaveLength(1);
    expect(result.markedResumable).toBe(1);
    expect(result.markedFailed).toBe(0);
    closeStores(stores);
  });

  it('detects awaiting_approval task and marks it resumable when retries remain', () => {
    const stores = makeStores();
    const mgr = makeManager(stores);
    makeSessionWithTask(stores, 'awaiting_approval', { retryCount: 1 });
    const result = mgr.recoverSessions();
    expect(result.markedResumable).toBe(1);
    closeStores(stores);
  });

  it('marks running task as failed when deadline has passed', () => {
    const stores = makeStores();
    const mgr = makeManager(stores);
    const pastDeadline = new Date(Date.now() - 60_000).toISOString();
    makeSessionWithTask(stores, 'running', { retryCount: 3, deadline: pastDeadline });
    const result = mgr.recoverSessions(new Date());
    expect(result.markedFailed).toBe(1);
    // Verify the task state was actually updated
    const allFailed = stores.sessionStore.listTasksByState('failed');
    expect(allFailed).toHaveLength(1);
    closeStores(stores);
  });

  it('marks running task as cancelled (abandoned) when no retries and no deadline', () => {
    const stores = makeStores();
    const mgr = makeManager(stores);
    makeSessionWithTask(stores, 'running', { retryCount: 0 });
    const result = mgr.recoverSessions();
    expect(result.markedAbandoned).toBe(1);
    const cancelled = stores.sessionStore.listTasksByState('cancelled');
    expect(cancelled).toHaveLength(1);
    closeStores(stores);
  });

  it('ignores tasks already in terminal states', () => {
    const stores = makeStores();
    const mgr = makeManager(stores);
    makeSessionWithTask(stores, 'completed');
    makeSessionWithTask(stores, 'failed');
    makeSessionWithTask(stores, 'cancelled');
    const result = mgr.recoverSessions();
    expect(result.interruptedTasks).toHaveLength(0);
    closeStores(stores);
  });

  it('handles mixed states correctly', () => {
    const stores = makeStores();
    const mgr = makeManager(stores);
    makeSessionWithTask(stores, 'running', { retryCount: 1 });        // resumable
    makeSessionWithTask(stores, 'running', { retryCount: 0 });        // abandoned
    const past = new Date(Date.now() - 1000).toISOString();
    makeSessionWithTask(stores, 'awaiting_approval', { retryCount: 5, deadline: past }); // failed
    const result = mgr.recoverSessions();
    expect(result.interruptedTasks).toHaveLength(3);
    expect(result.markedResumable).toBe(1);
    expect(result.markedAbandoned).toBe(1);
    expect(result.markedFailed).toBe(1);
    closeStores(stores);
  });
});

// ---------------------------------------------------------------------------
// B. Interrupted task classification (non-mutating)
// ---------------------------------------------------------------------------

describe('LifecycleManager.classifyInterruptedTasks()', () => {
  it('returns empty array when no stuck tasks', () => {
    const stores = makeStores();
    const mgr = makeManager(stores);
    expect(mgr.classifyInterruptedTasks()).toHaveLength(0);
    closeStores(stores);
  });

  it('classifies resumable correctly', () => {
    const stores = makeStores();
    const mgr = makeManager(stores);
    makeSessionWithTask(stores, 'running', { retryCount: 3 });
    const [c] = mgr.classifyInterruptedTasks();
    expect(c.classification).toBe('resumable');
    expect(c.reason).toContain('3 retry');
    closeStores(stores);
  });

  it('classifies abandoned correctly', () => {
    const stores = makeStores();
    const mgr = makeManager(stores);
    makeSessionWithTask(stores, 'running', { retryCount: 0 });
    const [c] = mgr.classifyInterruptedTasks();
    expect(c.classification).toBe('abandoned');
    closeStores(stores);
  });

  it('classifies failed (deadline) correctly', () => {
    const stores = makeStores();
    const mgr = makeManager(stores);
    const past = new Date(Date.now() - 5_000).toISOString();
    makeSessionWithTask(stores, 'running', { retryCount: 2, deadline: past });
    const [c] = mgr.classifyInterruptedTasks(new Date());
    expect(c.classification).toBe('failed');
    expect(c.reason).toContain('deadline');
    closeStores(stores);
  });

  it('does NOT mutate task state', () => {
    const stores = makeStores();
    const mgr = makeManager(stores);
    makeSessionWithTask(stores, 'running', { retryCount: 0 });
    mgr.classifyInterruptedTasks(); // abandoned but should NOT call updateTaskState
    const running = stores.sessionStore.listTasksByState('running');
    expect(running).toHaveLength(1); // still running — no mutation
    closeStores(stores);
  });

  it('includes the task object in the result', () => {
    const stores = makeStores();
    const mgr = makeManager(stores);
    const { task } = makeSessionWithTask(stores, 'running', { retryCount: 1 });
    const [c] = mgr.classifyInterruptedTasks();
    expect(c.task.id).toBe(task.id);
    closeStores(stores);
  });
});

// ---------------------------------------------------------------------------
// C. Pruning / Retention
// ---------------------------------------------------------------------------

describe('LifecycleManager.pruneAuditRecords()', () => {
  it('returns 0 deleted when no sessions are prunable', () => {
    const stores = makeStores();
    const mgr = makeManager(stores);
    // Session with running task — not prunable
    makeSessionWithTask(stores, 'running', { retryCount: 1 });
    const t = new Date().toISOString();
    stores.auditLog.write({ sessionId: 'ses-x', taskId: 't1', principalId: 'p', eventType: 'tool.started', toolName: 'x', startedAt: t });
    const result = mgr.pruneAuditRecords({ retentionClass: 'session', olderThanMs: 0 });
    expect(result.deleted).toBe(0);
    closeStores(stores);
  });

  it('prunes records from closed sessions older than cutoff', () => {
    const stores = makeStores();
    const mgr = makeManager(stores);
    const { session } = makeSessionWithTask(stores, 'completed');
    // Write audit record with a timestamp in the past
    const pastTs = new Date(Date.now() - 100_000).toISOString();
    stores.auditLog.write({ sessionId: session.id, principalId: 'p', eventType: 'tool.started', toolName: 'x', startedAt: pastTs });
    const result = mgr.pruneAuditRecords({ retentionClass: 'session', olderThanMs: 50_000 });
    expect(result.deleted).toBe(1);
    expect(result.retentionClass).toBe('session');
    closeStores(stores);
  });

  it('does not prune records newer than the cutoff', () => {
    const stores = makeStores();
    const mgr = makeManager(stores);
    const { session } = makeSessionWithTask(stores, 'completed');
    const recentTs = new Date().toISOString();
    stores.auditLog.write({ sessionId: session.id, principalId: 'p', eventType: 'tool.started', toolName: 'x', startedAt: recentTs });
    const result = mgr.pruneAuditRecords({ retentionClass: 'session', olderThanMs: 0 });
    // The record is too new (started_at == cutoffAt is not < cutoffAt)
    // olderThanMs=0 means cutoff=now, so records AT now are NOT older than now
    expect(result.deleted).toBe(0);
    closeStores(stores);
  });

  it('does not prune records from sessions with active tasks', () => {
    const stores = makeStores();
    const mgr = makeManager(stores);
    const { session } = makeSessionWithTask(stores, 'running', { retryCount: 1 });
    const pastTs = new Date(Date.now() - 100_000).toISOString();
    stores.auditLog.write({ sessionId: session.id, principalId: 'p', eventType: 'tool.started', toolName: 'x', startedAt: pastTs });
    const result = mgr.pruneAuditRecords({ retentionClass: 'session', olderThanMs: 50_000 });
    expect(result.deleted).toBe(0);
    closeStores(stores);
  });

  it('returns correct retentionClass and cutoffAt', () => {
    const stores = makeStores();
    const mgr = makeManager(stores);
    const before = Date.now();
    const result = mgr.pruneAuditRecords({ retentionClass: 'ephemeral', olderThanMs: 1_000 });
    const after = Date.now();
    expect(result.retentionClass).toBe('ephemeral');
    const cutoff = new Date(result.cutoffAt).getTime();
    expect(cutoff).toBeGreaterThanOrEqual(before - 1_000);
    expect(cutoff).toBeLessThanOrEqual(after - 1_000 + 10);
    closeStores(stores);
  });
});

describe('LifecycleManager.pruneArtifacts()', () => {
  it('deletes artifacts matching retentionClass and older than cutoff', () => {
    const stores = makeStores();
    const mgr = makeManager(stores);
    const pastTs = new Date(Date.now() - 100_000).toISOString();
    // Manually insert a past artifact by storing then patching created_at
    const art = stores.artifactStore.store({ type: 'file', uri: '/old.txt', provenanceId: 'p1', checksum: 'c1', retentionClass: 'session' });
    stores.artifactStore['db']
      .prepare('UPDATE artifacts SET created_at = ? WHERE id = ?')
      .run(pastTs, art.id);
    const result = mgr.pruneArtifacts({ retentionClass: 'session', olderThanMs: 50_000 });
    expect(result.deleted).toBe(1);
    expect(result.retentionClass).toBe('session');
    closeStores(stores);
  });

  it('does not delete artifacts with a different retentionClass', () => {
    const stores = makeStores();
    const mgr = makeManager(stores);
    const pastTs = new Date(Date.now() - 100_000).toISOString();
    const art = stores.artifactStore.store({ type: 'file', uri: '/keep.txt', provenanceId: 'p1', checksum: 'c1', retentionClass: 'long_term' });
    stores.artifactStore['db']
      .prepare('UPDATE artifacts SET created_at = ? WHERE id = ?')
      .run(pastTs, art.id);
    const result = mgr.pruneArtifacts({ retentionClass: 'session', olderThanMs: 50_000 });
    expect(result.deleted).toBe(0);
    closeStores(stores);
  });

  it('does not delete artifacts newer than the cutoff', () => {
    const stores = makeStores();
    const mgr = makeManager(stores);
    stores.artifactStore.store({ type: 'file', uri: '/new.txt', provenanceId: 'p1', checksum: 'c1', retentionClass: 'ephemeral' });
    // olderThanMs=0 means cutoff=now; new artifact is NOT older
    const result = mgr.pruneArtifacts({ retentionClass: 'ephemeral', olderThanMs: 0 });
    expect(result.deleted).toBe(0);
    closeStores(stores);
  });
});

describe('LifecycleManager.pruneSessions()', () => {
  it('deletes closed sessions older than the cutoff', () => {
    const stores = makeStores();
    const mgr = makeManager(stores);
    const { session } = makeSessionWithTask(stores, 'completed');
    const pastTs = new Date(Date.now() - 100_000).toISOString();
    stores.sessionStore['db']
      .prepare('UPDATE sessions SET created_at = ? WHERE id = ?')
      .run(pastTs, session.id);
    const result = mgr.pruneSessions({ olderThanMs: 50_000 });
    expect(result.deleted).toBe(1);
    expect(stores.sessionStore.getSession(session.id)).toBeUndefined();
    closeStores(stores);
  });

  it('does not delete sessions with active tasks', () => {
    const stores = makeStores();
    const mgr = makeManager(stores);
    const { session } = makeSessionWithTask(stores, 'running', { retryCount: 1 });
    const pastTs = new Date(Date.now() - 100_000).toISOString();
    stores.sessionStore['db']
      .prepare('UPDATE sessions SET created_at = ? WHERE id = ?')
      .run(pastTs, session.id);
    const result = mgr.pruneSessions({ olderThanMs: 50_000 });
    expect(result.deleted).toBe(0);
    closeStores(stores);
  });

  it('does not delete sessions newer than the cutoff', () => {
    const stores = makeStores();
    const mgr = makeManager(stores);
    makeSessionWithTask(stores, 'completed');
    const result = mgr.pruneSessions({ olderThanMs: 60_000 }); // cutoff = 60s ago; session just created
    expect(result.deleted).toBe(0);
    closeStores(stores);
  });

  it('returns the cutoffAt used', () => {
    const stores = makeStores();
    const mgr = makeManager(stores);
    const before = Date.now();
    const result = mgr.pruneSessions({ olderThanMs: 1_000 });
    const after = Date.now();
    const cutoff = new Date(result.cutoffAt).getTime();
    expect(cutoff).toBeGreaterThanOrEqual(before - 1_000);
    expect(cutoff).toBeLessThanOrEqual(after);
    closeStores(stores);
  });
});

// ---------------------------------------------------------------------------
// D. Migration
// ---------------------------------------------------------------------------

describe('runMigrations()', () => {
  it('starts at user_version 0 on a fresh database', () => {
    const db = new Database(':memory:');
    expect(getCurrentSchemaVersion(db)).toBe(0);
    db.close();
  });

  it('applies a migration and sets user_version', () => {
    const db = new Database(':memory:');
    // Create the tasks table first (the migration adds a column to it)
    db.exec(`CREATE TABLE tasks (id TEXT PRIMARY KEY, title TEXT NOT NULL)`);
    const migrations: Migration[] = [
      { version: 1, description: 'add col', up: `ALTER TABLE tasks ADD COLUMN extra TEXT;` },
    ];
    const result = runMigrations(db, migrations);
    expect(result.fromVersion).toBe(0);
    expect(result.toVersion).toBe(1);
    expect(result.applied).toHaveLength(1);
    expect(result.skipped).toHaveLength(0);
    expect(getCurrentSchemaVersion(db)).toBe(1);
    db.close();
  });

  it('skips already-applied migrations', () => {
    const db = new Database(':memory:');
    db.exec(`CREATE TABLE tasks (id TEXT PRIMARY KEY, title TEXT NOT NULL)`);
    const migrations: Migration[] = [
      { version: 1, description: 'add col', up: `ALTER TABLE tasks ADD COLUMN extra TEXT;` },
    ];
    runMigrations(db, migrations); // first run
    const result = runMigrations(db, migrations); // second run
    expect(result.fromVersion).toBe(1);
    expect(result.toVersion).toBe(1);
    expect(result.applied).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
    db.close();
  });

  it('applies multiple migrations in order', () => {
    const db = new Database(':memory:');
    db.exec(`CREATE TABLE t (id TEXT PRIMARY KEY)`);
    const migrations: Migration[] = [
      { version: 1, description: 'm1', up: `ALTER TABLE t ADD COLUMN a TEXT;` },
      { version: 2, description: 'm2', up: `ALTER TABLE t ADD COLUMN b TEXT;` },
      { version: 3, description: 'm3', up: `ALTER TABLE t ADD COLUMN c TEXT;` },
    ];
    const result = runMigrations(db, migrations);
    expect(result.fromVersion).toBe(0);
    expect(result.toVersion).toBe(3);
    expect(result.applied).toHaveLength(3);
    db.close();
  });

  it('partially applies migrations when starting mid-way', () => {
    const db = new Database(':memory:');
    db.exec(`CREATE TABLE t (id TEXT PRIMARY KEY)`);
    db.pragma('user_version = 2');
    const migrations: Migration[] = [
      { version: 1, description: 'm1', up: `ALTER TABLE t ADD COLUMN a TEXT;` },
      { version: 2, description: 'm2', up: `ALTER TABLE t ADD COLUMN b TEXT;` },
      { version: 3, description: 'm3', up: `ALTER TABLE t ADD COLUMN c TEXT;` },
    ];
    const result = runMigrations(db, migrations);
    expect(result.fromVersion).toBe(2);
    expect(result.applied).toHaveLength(1);
    expect(result.applied[0].version).toBe(3);
    expect(result.skipped).toHaveLength(2);
    db.close();
  });

  it('CURRENT_SCHEMA_VERSION matches highest migration version', () => {
    const highest = Math.max(...MIGRATIONS.map((m) => m.version));
    expect(CURRENT_SCHEMA_VERSION).toBe(highest);
  });

  it('no-ops on empty migrations list', () => {
    const db = new Database(':memory:');
    const result = runMigrations(db, []);
    expect(result.applied).toHaveLength(0);
    expect(result.toVersion).toBe(0);
    db.close();
  });

  it('actual MIGRATIONS can run on a fresh session database without error', () => {
    // Use a fresh in-memory session DB (has the tasks table already)
    const sessionStore = new SessionStore({ dbPath: ':memory:' });
    // Access the underlying db via the private field for migration
    const db = sessionStore['db'] as Database.Database;
    expect(() => runMigrations(db)).not.toThrow();
    sessionStore.close();
  });
});

// ---------------------------------------------------------------------------
// E. Export / Archive validation
// ---------------------------------------------------------------------------

describe('LifecycleManager.validateArchive()', () => {
  it('reports a schema version violation for a session pack (schemaVersion not in manifest)', () => {
    // The current manifest does not embed schemaVersion, so the validator
    // will always see schemaVersion=0 and report a violation against
    // CURRENT_SCHEMA_VERSION.  This is intentional — it surfaces the gap.
    const stores = makeStores();
    const mgr = makeManager(stores);
    const session = stores.sessionStore.createSession({
      principalId: 'p-1', agentId: 'a-1', mode: 'task',
    });
    const result = mgr.validateArchive(session.id);
    // schemaVersion will be 0 (not present) while CURRENT_SCHEMA_VERSION=1
    expect(result.schemaVersion).toBe(0);
    expect(result.valid).toBe(false);
    expect(result.violations.some((v) => v.includes('schemaVersion'))).toBe(true);
    closeStores(stores);
  });

  it('recordCount and artifactCount match for empty session', () => {
    const stores = makeStores();
    const mgr = makeManager(stores);
    const session = stores.sessionStore.createSession({
      principalId: 'p-1', agentId: 'a-1', mode: 'task',
    });
    const result = mgr.validateArchive(session.id);
    // The only violations should be the schemaVersion gap, not count mismatches
    const countViolations = result.violations.filter(
      (v) => v.includes('recordCount') || v.includes('artifactCount')
    );
    expect(countViolations).toHaveLength(0);
    closeStores(stores);
  });

  it('reports no count violations when records and artifacts are consistent', () => {
    const stores = makeStores();
    const mgr = makeManager(stores);
    const session = stores.sessionStore.createSession({
      principalId: 'p-1', agentId: 'a-1', mode: 'task',
    });
    const t = new Date().toISOString();
    stores.auditLog.write({ sessionId: session.id, principalId: 'p-1', eventType: 'tool.started', toolName: 'x', startedAt: t });
    stores.auditLog.write({ sessionId: session.id, principalId: 'p-1', eventType: 'tool.finished', toolName: 'x', startedAt: t });
    stores.artifactStore.store({ type: 'file', uri: '/out.txt', provenanceId: 'task-1', checksum: 'c1' });
    const result = mgr.validateArchive(session.id);
    const countViolations = result.violations.filter(
      (v) => v.includes('recordCount') || v.includes('artifactCount')
    );
    expect(countViolations).toHaveLength(0);
    closeStores(stores);
  });

  it('includes sessionId in the validated pack (basic smoke test)', () => {
    const stores = makeStores();
    const mgr = makeManager(stores);
    const session = stores.sessionStore.createSession({
      principalId: 'p-1', agentId: 'a-1', mode: 'task',
    });
    // Just confirm it doesn't throw
    expect(() => mgr.validateArchive(session.id)).not.toThrow();
    closeStores(stores);
  });
});

// ---------------------------------------------------------------------------
// F. AuditLog.deleteBySessionOlderThan (unit)
// ---------------------------------------------------------------------------

describe('AuditLog.deleteBySessionOlderThan()', () => {
  it('deletes matching records and returns count', () => {
    const al = new AuditLog({ dbPath: ':memory:' });
    const pastTs = new Date(Date.now() - 100_000).toISOString();
    al.write({ sessionId: 'ses-1', principalId: 'p', eventType: 'tool.started', toolName: 'x', startedAt: pastTs });
    al.write({ sessionId: 'ses-1', principalId: 'p', eventType: 'tool.finished', toolName: 'x', startedAt: pastTs });
    const deleted = al.deleteBySessionOlderThan('ses-1', new Date().toISOString());
    expect(deleted).toBe(2);
    expect(al.queryBySession('ses-1')).toHaveLength(0);
    al.close();
  });

  it('does not delete records from other sessions', () => {
    const al = new AuditLog({ dbPath: ':memory:' });
    const pastTs = new Date(Date.now() - 100_000).toISOString();
    al.write({ sessionId: 'ses-A', principalId: 'p', eventType: 'tool.started', toolName: 'x', startedAt: pastTs });
    al.write({ sessionId: 'ses-B', principalId: 'p', eventType: 'tool.started', toolName: 'y', startedAt: pastTs });
    al.deleteBySessionOlderThan('ses-A', new Date().toISOString());
    expect(al.queryBySession('ses-B')).toHaveLength(1);
    al.close();
  });

  it('returns 0 when no records match', () => {
    const al = new AuditLog({ dbPath: ':memory:' });
    const deleted = al.deleteBySessionOlderThan('no-such-session', new Date().toISOString());
    expect(deleted).toBe(0);
    al.close();
  });
});

// ---------------------------------------------------------------------------
// G. ArtifactStore.deleteByRetentionClassOlderThan (unit)
// ---------------------------------------------------------------------------

describe('ArtifactStore.deleteByRetentionClassOlderThan()', () => {
  it('deletes matching artifacts and returns count', () => {
    const store = new ArtifactStore({ dbPath: ':memory:' });
    const art = store.store({ type: 'file', uri: '/x.txt', provenanceId: 'p1', checksum: 'c1', retentionClass: 'ephemeral' });
    // Patch created_at to be old
    store['db'].prepare('UPDATE artifacts SET created_at = ? WHERE id = ?')
      .run(new Date(0).toISOString(), art.id);
    const deleted = store.deleteByRetentionClassOlderThan('ephemeral', new Date().toISOString());
    expect(deleted).toBe(1);
    expect(store.listAll()).toHaveLength(0);
    store.close();
  });

  it('does not delete artifacts with different retentionClass', () => {
    const store = new ArtifactStore({ dbPath: ':memory:' });
    const art = store.store({ type: 'file', uri: '/x.txt', provenanceId: 'p1', checksum: 'c1', retentionClass: 'permanent' });
    store['db'].prepare('UPDATE artifacts SET created_at = ? WHERE id = ?')
      .run(new Date(0).toISOString(), art.id);
    const deleted = store.deleteByRetentionClassOlderThan('ephemeral', new Date().toISOString());
    expect(deleted).toBe(0);
    expect(store.listAll()).toHaveLength(1);
    store.close();
  });

  it('returns 0 when no matches', () => {
    const store = new ArtifactStore({ dbPath: ':memory:' });
    expect(store.deleteByRetentionClassOlderThan('session', new Date().toISOString())).toBe(0);
    store.close();
  });
});
