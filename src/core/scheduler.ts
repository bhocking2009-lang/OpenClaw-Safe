/**
 * Sub-Agent Model Scheduler for OpenClaw Secure.
 *
 * Design constraints:
 *   - Local models are treated as scarce, capacity-bounded worker resources.
 *   - No task may start without first acquiring a lease from the scheduler.
 *   - No silent upgrade to a heavier model tier.
 *   - No spawn without a lease; no missing release on any termination path.
 *   - Every scheduling decision is auditable.
 *
 * The scheduler holds a static ModelPool and a map of active leases.
 * When capacity is exhausted, the requesting task is queued and its
 * acquireLease() call blocks until a slot is freed.
 *
 * Audit events emitted (via the provided emitter callback):
 *   scheduler.model.assigned   — a lease was immediately granted
 *   scheduler.model.unavailable — no slot; task queued
 *   scheduler.task.queued      — task added to the wait queue
 *   scheduler.task.started     — task dequeued and lease granted
 *   scheduler.task.completed   — lease released (success path)
 *   scheduler.task.released    — lease released (failure/cancel/timeout path)
 */

import { GatewayEvent } from './types';

// ---------------------------------------------------------------------------
// Model tier
// ---------------------------------------------------------------------------

/** Qualitative resource tier for a pooled model. */
export type ModelTier = 'light' | 'medium' | 'heavy';

// ---------------------------------------------------------------------------
// ModelPoolEntry — single entry in the static pool
// ---------------------------------------------------------------------------

export interface ModelPoolEntry {
  /** Short provider name, e.g. "ollama". */
  providerName: string;
  /** Model tag, e.g. "llama3:8b". */
  modelName: string;
  /** Qualitative tier used for routing decisions. */
  tier: ModelTier;
  /** Maximum number of tasks that may hold a lease simultaneously. */
  maxConcurrent: number;
  /** Maximum tokens per turn recommended for this model. */
  maxTokensPerTurn: number;
  /**
   * Optional reserved role label.
   * When set (e.g. "planning"), the model should only be used for tasks
   * that explicitly request that role.  Routing helpers must enforce this.
   */
  reservedRole?: string;
}

// ---------------------------------------------------------------------------
// ModelLease — token held by a running task
// ---------------------------------------------------------------------------

export interface ModelLease {
  /** Unique lease ID. */
  id: string;
  /** The task that holds this lease. */
  taskId: string;
  providerName: string;
  modelName: string;
  /** ISO-8601 timestamp when the lease was granted. */
  grantedAt: string;
}

// ---------------------------------------------------------------------------
// Scheduler state snapshot (returned by getStatus())
// ---------------------------------------------------------------------------

export interface ModelSchedulerStatus {
  pool: Array<{
    providerName: string;
    modelName: string;
    tier: ModelTier;
    maxConcurrent: number;
    activeLeasesCount: number;
    queueDepth: number;
    reservedRole?: string;
  }>;
}

// ---------------------------------------------------------------------------
// Default model pool (immutable static definition)
// ---------------------------------------------------------------------------

export const DEFAULT_MODEL_POOL: ModelPoolEntry[] = [
  {
    providerName: 'ollama',
    modelName: 'llama3:8b',
    tier: 'light',
    maxConcurrent: 2,
    maxTokensPerTurn: 2048,
  },
  {
    providerName: 'ollama',
    modelName: 'gemma3:12b',
    tier: 'medium',
    maxConcurrent: 2,
    maxTokensPerTurn: 4096,
  },
  {
    providerName: 'ollama',
    modelName: 'gpt-oss:20b',
    tier: 'heavy',
    maxConcurrent: 1,
    maxTokensPerTurn: 8192,
    reservedRole: 'planning',
  },
];

// ---------------------------------------------------------------------------
// Routing helpers
// ---------------------------------------------------------------------------

/**
 * Return the default model pool entry for a given task tier.
 * Heavy / planning tasks must be explicitly flagged — no silent upgrade.
 *
 * @param tier   Requested tier.
 * @param pool   Pool to search (defaults to DEFAULT_MODEL_POOL).
 * @returns      Matching entry, or undefined when no entry matches.
 */
export function selectModelForTier(
  tier: ModelTier,
  pool: ModelPoolEntry[] = DEFAULT_MODEL_POOL,
): ModelPoolEntry | undefined {
  return pool.find((e) => e.tier === tier && !e.reservedRole);
}

// ---------------------------------------------------------------------------
// ModelScheduler
// ---------------------------------------------------------------------------

type QueueEntry = {
  taskId: string;
  resolve: (lease: ModelLease) => void;
  reject: (reason: Error) => void;
};

type EmitFn = (event: GatewayEvent) => void;

let _leaseCounter = 0;
function newLeaseId(): string {
  _leaseCounter++;
  return `lease-${Date.now()}-${_leaseCounter}`;
}

export class ModelScheduler {
  private readonly pool: ModelPoolEntry[];
  /** Active leases keyed by leaseId. */
  private readonly activeLeases: Map<string, ModelLease> = new Map();
  /**
   * Per-model queue.  Key is `${providerName}/${modelName}`.
   * Each entry is a promise resolve/reject pair waiting for a free slot.
   */
  private readonly queues: Map<string, QueueEntry[]> = new Map();

  private readonly emit: EmitFn;

  constructor(pool: ModelPoolEntry[] = DEFAULT_MODEL_POOL, emit: EmitFn = () => { /* noop */ }) {
    if (pool.length === 0) {
      throw new Error('ModelScheduler: pool must contain at least one entry');
    }
    this.pool = pool;
    this.emit = emit;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Acquire a lease for the given provider/model pair.
   *
   * - If a slot is free, the lease is granted immediately and
   *   scheduler.model.assigned is emitted.
   * - If all slots are taken, the task is queued, scheduler.model.unavailable
   *   and scheduler.task.queued are emitted, and the promise resolves once a
   *   slot becomes free (scheduler.task.started is emitted then).
   *
   * @throws Error when the requested provider/model is not in the pool.
   */
  async acquireLease(taskId: string, providerName: string, modelName: string): Promise<ModelLease> {
    const entry = this.findEntry(providerName, modelName);
    if (!entry) {
      throw new Error(
        `ModelScheduler: model "${providerName}/${modelName}" is not in the pool`,
      );
    }

    const key = this.poolKey(providerName, modelName);
    const activeCount = this.countActiveLeases(providerName, modelName);

    if (activeCount < entry.maxConcurrent) {
      return this.grantLease(taskId, entry, 'assigned');
    }

    // Queue the task
    const now = new Date().toISOString();
    this.emit({
      type: 'scheduler.model.unavailable',
      payload: {
        taskId,
        providerName,
        modelName,
        activeCount,
        maxConcurrent: entry.maxConcurrent,
      },
      emittedAt: now,
    });
    this.emit({
      type: 'scheduler.task.queued',
      payload: {
        taskId,
        providerName,
        modelName,
        queueDepth: (this.queues.get(key)?.length ?? 0) + 1,
      },
      emittedAt: now,
    });

    return new Promise<ModelLease>((resolve, reject) => {
      const queue = this.queues.get(key) ?? [];
      queue.push({ taskId, resolve, reject });
      this.queues.set(key, queue);
    });
  }

  /**
   * Release a lease and optionally advance the queue.
   *
   * @param leaseId   Lease ID returned by acquireLease().
   * @param outcome   'completed' | 'released' — drives the audit event name.
   */
  releaseLease(leaseId: string, outcome: 'completed' | 'released' = 'released'): void {
    const lease = this.activeLeases.get(leaseId);
    if (!lease) {
      return; // Already released or unknown — idempotent.
    }

    this.activeLeases.delete(leaseId);

    const eventType =
      outcome === 'completed' ? 'scheduler.task.completed' : 'scheduler.task.released';
    this.emit({
      type: eventType,
      payload: {
        leaseId,
        taskId: lease.taskId,
        providerName: lease.providerName,
        modelName: lease.modelName,
        grantedAt: lease.grantedAt,
        releasedAt: new Date().toISOString(),
      },
      emittedAt: new Date().toISOString(),
    });

    // Drain the queue: give the freed slot to the next waiting task.
    this.drainQueue(lease.providerName, lease.modelName);
  }

  /**
   * Release all leases held by a given task.
   * Called when a task is cancelled or times out to guarantee no dangling leases.
   */
  releaseByTaskId(taskId: string, outcome: 'completed' | 'released' = 'released'): void {
    const leasesToRelease: string[] = [];
    for (const [id, lease] of this.activeLeases) {
      if (lease.taskId === taskId) {
        leasesToRelease.push(id);
      }
    }
    for (const id of leasesToRelease) {
      this.releaseLease(id, outcome);
    }
    // Also remove the task from any pending queue entries.
    for (const [key, queue] of this.queues) {
      const filtered = queue.filter((e) => {
        if (e.taskId === taskId) {
          e.reject(new Error(`Task ${taskId} cancelled before lease was granted`));
          return false;
        }
        return true;
      });
      this.queues.set(key, filtered);
    }
  }

  /**
   * Return a snapshot of the current scheduler state.
   */
  getStatus(): ModelSchedulerStatus {
    return {
      pool: this.pool.map((entry) => {
        const key = this.poolKey(entry.providerName, entry.modelName);
        return {
          providerName: entry.providerName,
          modelName: entry.modelName,
          tier: entry.tier,
          maxConcurrent: entry.maxConcurrent,
          activeLeasesCount: this.countActiveLeases(entry.providerName, entry.modelName),
          queueDepth: this.queues.get(key)?.length ?? 0,
          reservedRole: entry.reservedRole,
        };
      }),
    };
  }

  /**
   * Return the pool entry for a given provider/model combination.
   * Returns undefined if not in the pool.
   */
  getPoolEntry(providerName: string, modelName: string): ModelPoolEntry | undefined {
    return this.findEntry(providerName, modelName);
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private poolKey(providerName: string, modelName: string): string {
    return `${providerName}/${modelName}`;
  }

  private findEntry(providerName: string, modelName: string): ModelPoolEntry | undefined {
    return this.pool.find(
      (e) => e.providerName === providerName && e.modelName === modelName,
    );
  }

  private countActiveLeases(providerName: string, modelName: string): number {
    let count = 0;
    for (const lease of this.activeLeases.values()) {
      if (lease.providerName === providerName && lease.modelName === modelName) {
        count++;
      }
    }
    return count;
  }

  private grantLease(
    taskId: string,
    entry: ModelPoolEntry,
    emitType: 'assigned' | 'started',
  ): ModelLease {
    const lease: ModelLease = {
      id: newLeaseId(),
      taskId,
      providerName: entry.providerName,
      modelName: entry.modelName,
      grantedAt: new Date().toISOString(),
    };
    this.activeLeases.set(lease.id, lease);

    const eventType =
      emitType === 'assigned' ? 'scheduler.model.assigned' : 'scheduler.task.started';
    this.emit({
      type: eventType,
      payload: {
        leaseId: lease.id,
        taskId,
        providerName: entry.providerName,
        modelName: entry.modelName,
        tier: entry.tier,
        maxConcurrent: entry.maxConcurrent,
        activeCount: this.countActiveLeases(entry.providerName, entry.modelName),
      },
      emittedAt: lease.grantedAt,
    });

    return lease;
  }

  private drainQueue(providerName: string, modelName: string): void {
    const entry = this.findEntry(providerName, modelName);
    if (!entry) return;

    const key = this.poolKey(providerName, modelName);
    const queue = this.queues.get(key);
    if (!queue || queue.length === 0) return;

    const activeCount = this.countActiveLeases(providerName, modelName);
    if (activeCount >= entry.maxConcurrent) return;

    const next = queue.shift();
    if (!next) return;
    this.queues.set(key, queue);

    try {
      const lease = this.grantLease(next.taskId, entry, 'started');
      next.resolve(lease);
    } catch (err) {
      next.reject(err instanceof Error ? err : new Error(String(err)));
    }
  }
}
