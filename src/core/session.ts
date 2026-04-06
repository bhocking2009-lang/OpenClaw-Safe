/**
 * Session and task management for OpenClaw Secure.
 *
 * Sessions are conversational containers.
 * Tasks are operational containers.
 */

import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import { Session, Task, SessionMode, TaskState } from './types';

export interface SessionStoreOptions {
  dbPath: string;
}

export class SessionStore {
  private db: Database.Database;

  constructor(options: SessionStoreOptions) {
    this.db = new Database(options.dbPath);
    this.initialize();
  }

  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        principal_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        channel_thread_binding TEXT,
        mode TEXT NOT NULL DEFAULT 'interactive',
        budget INTEGER NOT NULL DEFAULT 100000,
        elevation_state INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_principal ON sessions(principal_id);

      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        title TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'pending',
        owner_id TEXT NOT NULL,
        executor_id TEXT,
        parent_task_id TEXT,
        dependency_ids TEXT NOT NULL DEFAULT '[]',
        sandbox_class TEXT NOT NULL DEFAULT 'workspace-write',
        capability_set TEXT NOT NULL DEFAULT '[]',
        deadline TEXT,
        retry_count INTEGER NOT NULL DEFAULT 3,
        escalation_state TEXT,
        delegation_depth INTEGER NOT NULL DEFAULT 0,
        budget_cap INTEGER,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(session_id) REFERENCES sessions(id)
      );
      CREATE INDEX IF NOT EXISTS idx_tasks_session ON tasks(session_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_state ON tasks(state);
    `);
  }

  // ---------------------------------------------------------------------------
  // Session CRUD
  // ---------------------------------------------------------------------------

  createSession(params: {
    principalId: string;
    agentId: string;
    channelThreadBinding?: string;
    mode?: SessionMode;
    budget?: number;
  }): Session {
    const now = new Date().toISOString();
    const session: Session = {
      id: uuidv4(),
      principalId: params.principalId,
      agentId: params.agentId,
      channelThreadBinding: params.channelThreadBinding,
      mode: params.mode ?? 'interactive',
      budget: params.budget ?? 100_000,
      elevationState: false,
      createdAt: now,
      updatedAt: now,
    };
    this.db
      .prepare(
        `INSERT INTO sessions
          (id, principal_id, agent_id, channel_thread_binding, mode, budget, elevation_state, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        session.id,
        session.principalId,
        session.agentId,
        session.channelThreadBinding ?? null,
        session.mode,
        session.budget,
        session.elevationState ? 1 : 0,
        session.createdAt,
        session.updatedAt
      );
    return session;
  }

  getSession(id: string): Session | undefined {
    const row = this.db
      .prepare('SELECT * FROM sessions WHERE id = ?')
      .get(id) as RawSession | undefined;
    return row ? deserializeSession(row) : undefined;
  }

  listSessionsByPrincipal(principalId: string): Session[] {
    return (
      this.db
        .prepare('SELECT * FROM sessions WHERE principal_id = ? ORDER BY created_at DESC')
        .all(principalId) as RawSession[]
    ).map(deserializeSession);
  }

  listSessions(): Session[] {
    return (
      this.db
        .prepare('SELECT * FROM sessions ORDER BY created_at DESC')
        .all() as RawSession[]
    ).map(deserializeSession);
  }

  /**
   * Atomically deduct `amount` tokens from the session budget.
   * Budget never goes below zero.
   * Returns the updated session, or undefined if the session does not exist.
   */
  decrementBudget(id: string, amount: number): Session | undefined {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE sessions SET budget = MAX(0, budget - ?), updated_at = ? WHERE id = ?`
      )
      .run(amount, now, id);
    return this.getSession(id);
  }

  updateSession(
    id: string,
    updates: Partial<Pick<Session, 'mode' | 'budget' | 'elevationState'>>
  ): Session | undefined {
    const existing = this.getSession(id);
    if (!existing) return undefined;
    const updated: Session = {
      ...existing,
      ...updates,
      updatedAt: new Date().toISOString(),
    };
    this.db
      .prepare(
        `UPDATE sessions SET mode = ?, budget = ?, elevation_state = ?, updated_at = ? WHERE id = ?`
      )
      .run(
        updated.mode,
        updated.budget,
        updated.elevationState ? 1 : 0,
        updated.updatedAt,
        updated.id
      );
    return updated;
  }

  deleteSession(id: string): void {
    this.db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
  }

  // ---------------------------------------------------------------------------
  // Task CRUD
  // ---------------------------------------------------------------------------

  createTask(params: {
    sessionId: string;
    title: string;
    ownerId: string;
    capabilitySet?: string[];
    sandboxClass?: string;
    parentTaskId?: string;
    dependencyIds?: string[];
    deadline?: string;
    delegationDepth?: number;
    budgetCap?: number;
  }): Task {
    const now = new Date().toISOString();
    const task: Task = {
      id: uuidv4(),
      sessionId: params.sessionId,
      title: params.title,
      state: 'pending',
      ownerId: params.ownerId,
      parentTaskId: params.parentTaskId,
      dependencyIds: params.dependencyIds ?? [],
      sandboxClass: params.sandboxClass ?? 'workspace-write',
      capabilitySet: params.capabilitySet ?? [],
      deadline: params.deadline,
      retryCount: 3,
      delegationDepth: params.delegationDepth ?? 0,
      budgetCap: params.budgetCap,
      createdAt: now,
      updatedAt: now,
    };
    this.db
      .prepare(
        `INSERT INTO tasks
          (id, session_id, title, state, owner_id, executor_id, parent_task_id,
           dependency_ids, sandbox_class, capability_set, deadline, retry_count,
           escalation_state, delegation_depth, budget_cap, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        task.id,
        task.sessionId,
        task.title,
        task.state,
        task.ownerId,
        task.executorId ?? null,
        task.parentTaskId ?? null,
        JSON.stringify(task.dependencyIds),
        task.sandboxClass,
        JSON.stringify(task.capabilitySet),
        task.deadline ?? null,
        task.retryCount,
        task.escalationState ?? null,
        task.delegationDepth,
        task.budgetCap ?? null,
        task.createdAt,
        task.updatedAt
      );
    return task;
  }

  getTask(id: string): Task | undefined {
    const row = this.db
      .prepare('SELECT * FROM tasks WHERE id = ?')
      .get(id) as RawTask | undefined;
    return row ? deserializeTask(row) : undefined;
  }

  listTasksBySession(sessionId: string): Task[] {
    return (
      this.db
        .prepare('SELECT * FROM tasks WHERE session_id = ? ORDER BY created_at DESC')
        .all(sessionId) as RawTask[]
    ).map(deserializeTask);
  }

  listTasksByState(state: TaskState): Task[] {
    return (
      this.db
        .prepare('SELECT * FROM tasks WHERE state = ? ORDER BY created_at ASC')
        .all(state) as RawTask[]
    ).map(deserializeTask);
  }

  updateTaskState(id: string, state: TaskState, executorId?: string): Task | undefined {
    const existing = this.getTask(id);
    if (!existing) return undefined;
    const updated: Task = {
      ...existing,
      state,
      executorId: executorId ?? existing.executorId,
      updatedAt: new Date().toISOString(),
    };
    this.db
      .prepare(
        `UPDATE tasks SET state = ?, executor_id = ?, updated_at = ? WHERE id = ?`
      )
      .run(updated.state, updated.executorId ?? null, updated.updatedAt, updated.id);
    return updated;
  }

  updateTaskCapabilities(id: string, capabilitySet: string[]): Task | undefined {
    const existing = this.getTask(id);
    if (!existing) return undefined;
    const now = new Date().toISOString();
    this.db
      .prepare('UPDATE tasks SET capability_set = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(capabilitySet), now, id);
    return { ...existing, capabilitySet, updatedAt: now };
  }

  close(): void {
    this.db.close();
  }
}

// ---------------------------------------------------------------------------
// Internal deserialization
// ---------------------------------------------------------------------------

interface RawSession {
  id: string;
  principal_id: string;
  agent_id: string;
  channel_thread_binding: string | null;
  mode: string;
  budget: number;
  elevation_state: number;
  created_at: string;
  updated_at: string;
}

interface RawTask {
  id: string;
  session_id: string;
  title: string;
  state: string;
  owner_id: string;
  executor_id: string | null;
  parent_task_id: string | null;
  dependency_ids: string;
  sandbox_class: string;
  capability_set: string;
  deadline: string | null;
  retry_count: number;
  escalation_state: string | null;
  delegation_depth: number;
  budget_cap: number | null;
  created_at: string;
  updated_at: string;
}

function deserializeSession(row: RawSession): Session {
  return {
    id: row.id,
    principalId: row.principal_id,
    agentId: row.agent_id,
    channelThreadBinding: row.channel_thread_binding ?? undefined,
    mode: row.mode as SessionMode,
    budget: row.budget,
    elevationState: row.elevation_state === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function deserializeTask(row: RawTask): Task {
  return {
    id: row.id,
    sessionId: row.session_id,
    title: row.title,
    state: row.state as TaskState,
    ownerId: row.owner_id,
    executorId: row.executor_id ?? undefined,
    parentTaskId: row.parent_task_id ?? undefined,
    dependencyIds: JSON.parse(row.dependency_ids) as string[],
    sandboxClass: row.sandbox_class,
    capabilitySet: JSON.parse(row.capability_set) as string[],
    deadline: row.deadline ?? undefined,
    retryCount: row.retry_count,
    escalationState: row.escalation_state ?? undefined,
    delegationDepth: row.delegation_depth ?? 0,
    budgetCap: row.budget_cap ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
