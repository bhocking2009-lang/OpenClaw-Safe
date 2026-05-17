/**
 * Gateway kernel for OpenClaw Secure.
 *
 * The gateway is the control plane. It:
 *   - routes requests
 *   - resolves identity
 *   - loads policy
 *   - brokers capabilities
 *   - schedules work
 *   - emits events
 *   - stores authoritative state
 *
 * It does NOT directly execute tools or have ambient host authority.
 * Binds to loopback by default.
 */

import express, { Request, Response, NextFunction } from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import {
  Principal,
  Agent,
  Session,
  Task,
  GatewayEvent,
  InboundEnvelope,
  PluginManifest,
  PrincipalType,
  TrustLevel,
  SessionMode,
  ToolRiskClass,
  MemoryKind,
  RedactClass,
  ApprovalDuration,
} from './types';
import { PolicyEngine, PolicyRule, DEFAULT_POLICY_RULES } from './policy';
import { ToolBroker } from './broker';
import { AuditLog } from './audit';
import { SessionStore } from './session';
import { ApprovalStore } from './approval';
import { MemoryStore } from './memory';
import { ArtifactStore } from './artifacts';
import { PolicyRuleStore, validatePolicyRule } from './policy-store';
import { PluginStore } from './plugin-store';
import { buildReplayPack, formatExecutionTrace, checkAuditIntegrity, diffReplayPacks, validateExportBundle } from './replay';
import { formatReplaySummary, formatReplayDiff, formatPolicyExplanation, formatIntegrityReport } from './display';
import { BrowserWorker } from '../workers/browser';
import { PluginManifestSchema } from '../plugins/registry';
import { createBeeOSRouter } from '../ui/beeos';
import { ModelScheduler, DEFAULT_MODEL_POOL, ModelPoolEntry } from './scheduler';

/** Maximum allowed delegation depth for child tasks. */
export const MAX_DELEGATION_DEPTH = 5;

/** Maximum number of direct child tasks a single parent task may spawn. */
export const MAX_CHILDREN_PER_TASK = 20;

// ---------------------------------------------------------------------------
// Phase 7 — browser_doc_fetch tool schema
// ---------------------------------------------------------------------------

/** Tool schema for the narrow browser documentation-fetch workflow. */
export const BROWSER_DOC_FETCH_SCHEMA: import('./types').ToolSchema = {
  name: 'browser_doc_fetch',
  description:
    'Fetch and extract text from an allowlisted documentation URL. ' +
    'Domain must be on the configured allowlist. Redirects are denied. ' +
    'Result is stored as a structured_data artifact.',
  riskClass: 'D',
  defaultRuntimeTarget: 'browser_worker',
  concurrencySafe: true,
  idempotent: true,
  auditPayloadShape: {
    url: 'string',
    label: 'string?',
  },
  inputSchema: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'HTTPS URL to fetch (must be on domain allowlist)' },
      label: { type: 'string', description: 'Optional label for the captured artifact' },
    },
    required: ['url'],
  },
};

export interface GatewayConfig {
  /** Bind host. Defaults to 127.0.0.1 (loopback only). */
  host: string;
  /** Bind port. */
  port: number;
  /** Database path. */
  dbPath: string;
  /** Shared secret for gateway authentication. */
  gatewaySecret: string;
  /**
   * When true, gateway.start() will probe the configured modelProvider and
   * throw if it is unreachable. Prevents silent stub-only operation in
   * production.  Default: false.
   */
  requireModelProvider?: boolean;
}

const DEFAULT_CONFIG: GatewayConfig = {
  host: '127.0.0.1',
  port: 4242,
  dbPath: ':memory:',
  gatewaySecret: '',
  requireModelProvider: false,
};

export interface GatewayDependencies {
  policyEngine: PolicyEngine;
  broker: ToolBroker;
  auditLog: AuditLog;
  sessionStore: SessionStore;
  approvalStore: ApprovalStore;
  memoryStore: MemoryStore;
  artifactStore?: ArtifactStore;
  policyRuleStore?: PolicyRuleStore;
  /**
   * Optional pre-configured BrowserWorker for the browser_doc_fetch workflow.
   * When provided, the gateway auto-registers the worker and the browser_doc_fetch
   * tool schema, and exposes the POST /v1/browser/doc-fetch endpoint.
   */
  browserWorker?: BrowserWorker;
  /**
   * Optional plugin store for persistent plugin lifecycle management.
   * When provided, plugin install/enable/disable/remove/invoke routes are
   * fully backed by the store and all actions are audited.
   */
  pluginStore?: PluginStore;
  /**
   * The active model provider bound to this gateway instance.
   * When provided:
   *   - /health includes { modelProvider: { name, model, available } }
   *   - GET /v1/model/status returns detailed provider info
   *   - start() probes the provider (throws if requireModelProvider=true and probe fails)
   *   - a model.provider.selected audit event is written on startup
   * When omitted the gateway operates without a bound model (stub/test mode).
   */
  modelProvider?: import('../core/agent').ModelProvider;
  /**
   * Optional sub-agent model scheduler.
   * When provided, the delegate route will acquire a lease from the scheduler
   * before creating a child task with an explicit providerName/modelName.
   * Scheduler status is exposed at GET /v1/scheduler/pool.
   * When omitted, delegation continues without concurrency enforcement.
   */
  modelScheduler?: ModelScheduler;
}

export class Gateway {
  private app: express.Application;
  private server: ReturnType<typeof createServer>;
  private wss: WebSocketServer;
  private config: GatewayConfig;
  private deps: GatewayDependencies;
  private principals: Map<string, Principal> = new Map();
  private agents: Map<string, Agent> = new Map();
  private plugins: Map<string, PluginManifest> = new Map();
  private wsClients: Set<WebSocket> = new Set();
  /** Cached result of the last provider probe (updated on start()). */
  private modelProviderAvailable: boolean | null = null;

  constructor(config: Partial<GatewayConfig>, deps: GatewayDependencies) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.deps = deps;
    this.app = express();
    this.server = createServer(this.app);
    this.wss = new WebSocketServer({ server: this.server });
    if (deps.browserWorker) {
      deps.broker.registerWorker(deps.browserWorker);
      deps.broker.registerTool(BROWSER_DOC_FETCH_SCHEMA);
    }
    this.setupMiddleware();
    this.setupRoutes();
    this.setupWebSocket();
  }

  // ---------------------------------------------------------------------------
  // Middleware
  // ---------------------------------------------------------------------------

  private setupMiddleware(): void {
    this.app.use(express.json());

    // Authentication middleware
    this.app.use((req: Request, res: Response, next: NextFunction) => {
      // Skip auth for health checks and BeeOS UI
      if (req.path === '/health' || req.path.startsWith('/ui')) return next();

      // If no gateway secret is configured, allow all requests
      if (!this.config.gatewaySecret) return next();

      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.status(401).json({ error: 'Missing or invalid Authorization header' });
        return;
      }
      const token = authHeader.slice(7);
      if (token !== this.config.gatewaySecret) {
        res.status(401).json({ error: 'Invalid gateway secret' });
        return;
      }
      next();
    });
  }

  // ---------------------------------------------------------------------------
  // Routes
  // ---------------------------------------------------------------------------

  private setupRoutes(): void {
    const r = express.Router();

    // Health check (unauthenticated)
    this.app.get('/health', (_req, res) => {
      const mp = this.deps.modelProvider;
      const health: Record<string, unknown> = { status: 'ok', version: '1.0.0' };
      if (mp) {
        health['modelProvider'] = {
          name: mp.name,
          model: mp.model ?? null,
          available: this.modelProviderAvailable,
        };
      }
      res.json(health);
    });

    // ----- Auth / Identity -----
    r.get('/auth/principals', (_req, res) => {
      res.json({ principals: Array.from(this.principals.values()) });
    });

    // ----- Model provider status -----
    r.get('/model/status', (_req, res) => {
      const mp = this.deps.modelProvider;
      if (!mp) {
        res.json({ bound: false, message: 'No model provider configured' });
        return;
      }
      res.json({
        bound: true,
        name: mp.name,
        model: mp.model ?? null,
        available: this.modelProviderAvailable,
        checkedAt: new Date().toISOString(),
      });
    });

    // ----- Scheduler pool status -----
    r.get('/scheduler/pool', (_req, res) => {
      const sched = this.deps.modelScheduler;
      if (!sched) {
        res.json({ bound: false, message: 'No model scheduler configured' });
        return;
      }
      res.json({ bound: true, status: sched.getStatus() });
    });

    r.post('/auth/principals', (req, res) => {
      const body = req.body as {
        type: PrincipalType;
        identities: Record<string, string>;
        trustLevel: TrustLevel;
        policyGroup: string;
      };

      const validTypes: PrincipalType[] = ['operator', 'user', 'child_agent', 'system'];
      const validTrustLevels: TrustLevel[] = ['high', 'medium', 'low'];
      const requestedType = body.type ?? 'user';
      const requestedTrustLevel = body.trustLevel ?? 'medium';

      if (!validTypes.includes(requestedType)) {
        res.status(400).json({ error: `Invalid principal type. Must be one of: ${validTypes.join(', ')}` });
        return;
      }
      if (!validTrustLevels.includes(requestedTrustLevel)) {
        res.status(400).json({ error: `Invalid trust level. Must be one of: ${validTrustLevels.join(', ')}` });
        return;
      }

      const principal: Principal = {
        id: uuidv4(),
        type: requestedType,
        identities: body.identities ?? {},
        trustLevel: requestedTrustLevel,
        policyGroup: body.policyGroup ?? 'default',
        createdAt: new Date().toISOString(),
      };
      this.principals.set(principal.id, principal);
      res.status(201).json(principal);
    });

    r.get('/auth/principals/:id', (req, res) => {
      const p = this.principals.get(req.params.id);
      if (!p) { res.status(404).json({ error: 'Not found' }); return; }
      res.json(p);
    });

    // ----- Agents -----
    r.get('/agents', (_req, res) => {
      res.json({ agents: Array.from(this.agents.values()) });
    });

    r.post('/agents', (req, res) => {
      const body = req.body as Partial<Agent>;
      const agent: Agent = {
        id: uuidv4(),
        profile: body.profile ?? 'default',
        defaultModel: body.defaultModel ?? 'stub',
        toolProfile: body.toolProfile ?? 'default',
        sandboxProfile: body.sandboxProfile ?? 'default',
        memoryNamespace: body.memoryNamespace ?? uuidv4(),
        channelBindings: body.channelBindings ?? [],
        createdAt: new Date().toISOString(),
      };
      this.agents.set(agent.id, agent);
      res.status(201).json(agent);
    });

    r.get('/agents/:id', (req, res) => {
      const a = this.agents.get(req.params.id);
      if (!a) { res.status(404).json({ error: 'Not found' }); return; }
      res.json(a);
    });

    // ----- Sessions -----
    r.get('/sessions', (_req, res) => {
      res.json({ sessions: this.deps.sessionStore.listSessions() });
    });

    r.post('/sessions', (req, res) => {
      const body = req.body as {
        principalId: string;
        agentId: string;
        mode?: SessionMode;
        budget?: number;
      };
      if (!body.principalId || !body.agentId) {
        res.status(400).json({ error: 'principalId and agentId are required' });
        return;
      }
      const session = this.deps.sessionStore.createSession({
        principalId: body.principalId,
        agentId: body.agentId,
        mode: body.mode,
        budget: body.budget,
      });
      this.emitEvent({ type: 'session.updated', payload: { session }, emittedAt: new Date().toISOString() });
      res.status(201).json(session);
    });

    r.get('/sessions/:id', (req, res) => {
      const s = this.deps.sessionStore.getSession(req.params.id);
      if (!s) { res.status(404).json({ error: 'Not found' }); return; }
      res.json(s);
    });

    r.patch('/sessions/:id', (req, res) => {
      const body = req.body as { mode?: unknown; budget?: unknown; elevationState?: unknown };
      const validModes: SessionMode[] = ['interactive', 'task', 'review', 'readonly'];

      if (body.mode !== undefined && !validModes.includes(body.mode as SessionMode)) {
        res.status(400).json({ error: `Invalid mode. Must be one of: ${validModes.join(', ')}` });
        return;
      }
      if (body.budget !== undefined && (typeof body.budget !== 'number' || body.budget < 0 || !Number.isFinite(body.budget))) {
        res.status(400).json({ error: 'budget must be a non-negative finite number' });
        return;
      }
      if (body.elevationState !== undefined && typeof body.elevationState !== 'boolean') {
        res.status(400).json({ error: 'elevationState must be a boolean' });
        return;
      }

      const updates: Parameters<typeof this.deps.sessionStore.updateSession>[1] = {};
      if (body.mode !== undefined) updates.mode = body.mode as SessionMode;
      if (body.budget !== undefined) updates.budget = body.budget as number;
      if (body.elevationState !== undefined) updates.elevationState = body.elevationState as boolean;

      const updated = this.deps.sessionStore.updateSession(req.params.id, updates);
      if (!updated) { res.status(404).json({ error: 'Not found' }); return; }
      this.emitEvent({ type: 'session.updated', payload: { session: updated }, emittedAt: new Date().toISOString() });
      res.json(updated);
    });

    // Replay / export pack for a session
    r.get('/sessions/:id/replay-export', (req, res) => {
      const session = this.deps.sessionStore.getSession(req.params.id);
      if (!session) { res.status(404).json({ error: 'Not found' }); return; }
      const pack = buildReplayPack(req.params.id, this.deps.auditLog, this.deps.artifactStore);
      if ((req.query as Record<string, string | undefined>)['format'] === 'text') {
        res
          .type('text/plain; charset=utf-8')
          .set('X-Content-Type-Options', 'nosniff')
          .set('Content-Disposition', 'attachment; filename="execution-trace.txt"')
          .send(formatExecutionTrace(pack));
        return;
      }
      res.json(pack);
    });

    // Audit integrity check for a session
    r.get('/sessions/:id/audit-integrity', (req, res) => {
      const session = this.deps.sessionStore.getSession(req.params.id);
      if (!session) { res.status(404).json({ error: 'Not found' }); return; }
      const pack = buildReplayPack(req.params.id, this.deps.auditLog, this.deps.artifactStore);
      const result = checkAuditIntegrity(pack);
      if ((req.query as Record<string, string | undefined>)['format'] === 'text') {
        res
          .type('text/plain; charset=utf-8')
          .set('X-Content-Type-Options', 'nosniff')
          .set('Content-Disposition', 'attachment; filename="integrity-report.txt"')
          .send(formatIntegrityReport(result));
        return;
      }
      res.status(result.valid ? 200 : 409).json(result);
    });

    // Policy explain — evaluate a context and return decision with trace
    r.post('/policy/explain', (req, res) => {
      const body = req.body as {
        toolName?: unknown;
        toolRiskClass?: unknown;
        runtimeTarget?: unknown;
        principalId?: unknown;
        sessionId?: unknown;
      };

      if (!body.toolName || typeof body.toolName !== 'string') {
        res.status(400).json({ error: 'toolName is required and must be a string' });
        return;
      }
      if (!body.toolRiskClass || typeof body.toolRiskClass !== 'string') {
        res.status(400).json({ error: 'toolRiskClass is required and must be a string' });
        return;
      }
      if (!body.principalId || typeof body.principalId !== 'string') {
        res.status(400).json({ error: 'principalId is required and must be a string' });
        return;
      }
      if (!body.sessionId || typeof body.sessionId !== 'string') {
        res.status(400).json({ error: 'sessionId is required and must be a string' });
        return;
      }

      const principal = this.principals.get(body.principalId);
      if (!principal) { res.status(404).json({ error: 'Principal not found' }); return; }

      const session = this.deps.sessionStore.getSession(body.sessionId);
      if (!session) { res.status(404).json({ error: 'Session not found' }); return; }

      const ctx = {
        principal,
        session,
        toolName: body.toolName,
        toolRiskClass: body.toolRiskClass as import('./types').ToolRiskClass,
        runtimeTarget: (typeof body.runtimeTarget === 'string' ? body.runtimeTarget : 'sandbox') as import('./types').RuntimeTarget,
        approvalState: 'pending' as const,
      };

      const decision = this.deps.policyEngine.explain(ctx);

      if ((req.query as Record<string, string | undefined>)['format'] === 'text') {
        res
          .type('text/plain; charset=utf-8')
          .set('X-Content-Type-Options', 'nosniff')
          .set('Content-Disposition', 'attachment; filename="policy-explanation.txt"')
          .send(formatPolicyExplanation(decision));
        return;
      }

      res.json(decision);
    });

    // ---------------------------------------------------------------------------
    // Phase 5 — Operator views and export bundles
    // ---------------------------------------------------------------------------

    // Human-readable replay summary for a session
    r.get('/sessions/:id/replay-summary', (req, res) => {
      const session = this.deps.sessionStore.getSession(req.params.id);
      if (!session) { res.status(404).json({ error: 'Not found' }); return; }
      const pack = buildReplayPack(req.params.id, this.deps.auditLog, this.deps.artifactStore);
      const safeId = req.params.id.replace(/[^a-zA-Z0-9-]/g, '_');
      res
        .type('text/plain; charset=utf-8')
        .set('X-Content-Type-Options', 'nosniff')
        .set('Content-Disposition', `attachment; filename="session-summary-${safeId}.txt"`)
        .send(formatReplaySummary(pack));
    });

    // Human-readable diff between two sessions
    r.post('/sessions/diff', (req, res) => {
      const body = req.body as { sessionA?: unknown; sessionB?: unknown; format?: unknown };

      if (!body.sessionA || typeof body.sessionA !== 'string') {
        res.status(400).json({ error: 'sessionA is required and must be a string' });
        return;
      }
      if (!body.sessionB || typeof body.sessionB !== 'string') {
        res.status(400).json({ error: 'sessionB is required and must be a string' });
        return;
      }

      const sesA = this.deps.sessionStore.getSession(body.sessionA);
      if (!sesA) { res.status(404).json({ error: `Session not found: ${body.sessionA}` }); return; }
      const sesB = this.deps.sessionStore.getSession(body.sessionB);
      if (!sesB) { res.status(404).json({ error: `Session not found: ${body.sessionB}` }); return; }

      const packA = buildReplayPack(body.sessionA, this.deps.auditLog, this.deps.artifactStore);
      const packB = buildReplayPack(body.sessionB, this.deps.auditLog, this.deps.artifactStore);
      const diff = diffReplayPacks(packA, packB);

      if (body.format === 'text') {
        res
          .type('text/plain; charset=utf-8')
          .set('X-Content-Type-Options', 'nosniff')
          .set('Content-Disposition', 'attachment; filename="session-diff.txt"')
          .send(formatReplayDiff(diff));
        return;
      }

      res.json(diff);
    });

    // Full export bundle — all operator views for a session in one response
    r.get('/sessions/:id/export-bundle', (req, res) => {
      const session = this.deps.sessionStore.getSession(req.params.id);
      if (!session) { res.status(404).json({ error: 'Not found' }); return; }

      const pack = buildReplayPack(req.params.id, this.deps.auditLog, this.deps.artifactStore);
      const integrityResult = checkAuditIntegrity(pack);
      const bundleValidation = validateExportBundle(pack);

      const bundle = {
        sessionId: req.params.id,
        exportedAt: new Date().toISOString(),
        budgetRemaining: session.budget,
        lastKnownBudgetRemaining: pack.manifest.lastKnownBudgetRemaining,
        budgetExhaustedCount: pack.manifest.budgetExhaustedCount,
        browserFetchCount: pack.manifest.browserFetchCount,
        browserDenialCount: pack.manifest.browserDenialCount,
        replayPack: pack,
        summary: formatReplaySummary(pack),
        integrityReport: integrityResult,
        integrityReportText: formatIntegrityReport(integrityResult),
        bundleValidation,
        artifactManifest: pack.artifacts.map((a) => ({
          id: a.id,
          type: a.type,
          uri: a.uri,
          label: a.label,
          invocationId: a.invocationId,
          provenanceId: a.provenanceId,
          checksum: a.checksum,
          retentionClass: a.retentionClass,
          createdAt: a.createdAt,
        })),
      };

      res.json(bundle);
    });

    // ----- Tasks -----
    r.post('/tasks', (req, res) => {
      const body = req.body as {
        sessionId: string;
        title: string;
        ownerId: string;
        capabilitySet?: string[];
        sandboxClass?: string;
        deadline?: string;
      };
      if (!body.sessionId || !body.title || !body.ownerId) {
        res.status(400).json({ error: 'sessionId, title, and ownerId are required' });
        return;
      }
      const task = this.deps.sessionStore.createTask(body);
      this.emitEvent({ type: 'task.updated', payload: { task }, emittedAt: new Date().toISOString() });
      res.status(201).json(task);
    });

    r.get('/tasks/:id', (req, res) => {
      const t = this.deps.sessionStore.getTask(req.params.id);
      if (!t) { res.status(404).json({ error: 'Not found' }); return; }
      res.json(t);
    });

    r.patch('/tasks/:id/state', (req, res) => {
      const validStates: Task['state'][] = ['pending', 'running', 'awaiting_approval', 'completed', 'failed', 'cancelled'];
      const { state, executorId } = req.body as { state?: unknown; executorId?: unknown };
      if (!state || !validStates.includes(state as Task['state'])) {
        res.status(400).json({ error: `Invalid state. Must be one of: ${validStates.join(', ')}` });
        return;
      }
      if (executorId !== undefined && typeof executorId !== 'string') {
        res.status(400).json({ error: 'executorId must be a string' });
        return;
      }
      const updated = this.deps.sessionStore.updateTaskState(
        req.params.id,
        state as Task['state'],
        executorId as string | undefined
      );
      if (!updated) { res.status(404).json({ error: 'Not found' }); return; }
      this.emitEvent({ type: 'task.updated', payload: { task: updated }, emittedAt: new Date().toISOString() });
      res.json(updated);
    });

    /**
     * Delegate a child task from a parent task.
     * The child's capabilitySet is strictly the intersection of the parent's
     * capabilitySet and the requested capabilities — it can never be broader.
     * Delegation depth is capped at MAX_DELEGATION_DEPTH.
     * Child count per parent is capped at MAX_CHILDREN_PER_TASK.
     * An optional budgetCap limits the token budget consumed by this child.
     */
    r.post('/tasks/:id/delegate', async (req, res) => {
      const parent = this.deps.sessionStore.getTask(req.params.id);
      if (!parent) { res.status(404).json({ error: 'Parent task not found' }); return; }

      const body = req.body as {
        title?: unknown;
        requestedCapabilities?: unknown;
        sandboxClass?: unknown;
        deadline?: unknown;
        budgetCap?: unknown;
        /** Explicit provider binding for this child task (e.g. "ollama"). */
        providerName?: unknown;
        /** Explicit model binding for this child task (e.g. "llama3.2"). */
        modelName?: unknown;
      };

      if (!body.title || typeof body.title !== 'string') {
        res.status(400).json({ error: 'title is required and must be a string' });
        return;
      }
      if (!Array.isArray(body.requestedCapabilities) || !body.requestedCapabilities.every((c) => typeof c === 'string')) {
        res.status(400).json({ error: 'requestedCapabilities must be an array of strings' });
        return;
      }

      const now = new Date().toISOString();

      // Enforce delegation depth cap
      const childDepth = (parent.delegationDepth ?? 0) + 1;
      if (childDepth > MAX_DELEGATION_DEPTH) {
        // Emit an audit event so delegation depth denials are traceable
        this.deps.auditLog.write({
          sessionId: parent.sessionId,
          taskId: parent.id,
          principalId: parent.ownerId,
          eventType: 'delegation.depth.exceeded',
          startedAt: now,
          finishedAt: now,
          error: `Maximum delegation depth (${MAX_DELEGATION_DEPTH}) exceeded. Parent is already at depth ${parent.delegationDepth ?? 0}.`,
        });
        res.status(400).json({
          error: `Maximum delegation depth (${MAX_DELEGATION_DEPTH}) exceeded. Parent is already at depth ${parent.delegationDepth ?? 0}.`,
        });
        return;
      }

      // Enforce child count cap
      const currentChildCount = this.deps.sessionStore.countChildTasks(parent.id);
      if (currentChildCount >= MAX_CHILDREN_PER_TASK) {
        this.deps.auditLog.write({
          sessionId: parent.sessionId,
          taskId: parent.id,
          principalId: parent.ownerId,
          eventType: 'delegation.children.exceeded',
          startedAt: now,
          finishedAt: now,
          error: `Maximum child task count (${MAX_CHILDREN_PER_TASK}) exceeded for task ${parent.id}.`,
        });
        res.status(400).json({
          error: `Maximum child task count (${MAX_CHILDREN_PER_TASK}) exceeded for task ${parent.id}.`,
        });
        return;
      }

      // Loop detection: the new child cannot have the parent (or any ancestor) as a
      // descendant.  Since we are creating a *new* task, it has no descendants yet,
      // so we only need to verify the parent itself is not about to create a cycle
      // (which cannot happen with new tasks, but we guard against a caller passing
      // an existing task ID as the title by checking ancestor chain for parent.id).
      // More precisely: walk upward from parent and ensure parent.id does not appear
      // in its own ancestor chain (sanity guard — the DB schema prevents this by
      // construction, but we keep the check explicit and auditable).
      let ancestorId: string | undefined = parent.parentTaskId;
      while (ancestorId !== undefined) {
        if (ancestorId === parent.id) {
          this.deps.auditLog.write({
            sessionId: parent.sessionId,
            taskId: parent.id,
            principalId: parent.ownerId,
            eventType: 'delegation.loop.detected',
            startedAt: now,
            finishedAt: now,
            error: `Delegation loop detected for task ${parent.id}.`,
          });
          res.status(400).json({ error: `Delegation loop detected for task ${parent.id}.` });
          return;
        }
        const ancestor = this.deps.sessionStore.getTask(ancestorId);
        ancestorId = ancestor?.parentTaskId;
      }

      // Enforce intersection: child cannot exceed parent capabilities
      const requested = body.requestedCapabilities as string[];
      const disallowed = requested.filter((c) => !parent.capabilitySet.includes(c));
      if (disallowed.length > 0) {
        res.status(400).json({
          error: `Requested capabilities not in parent capabilitySet: ${disallowed.join(', ')}`,
        });
        return;
      }

      // Track which capabilities were restricted (parent has but child did not request)
      const restricted = parent.capabilitySet.filter((c) => !requested.includes(c));

      // Validate optional budgetCap
      let budgetCap: number | undefined;
      if (body.budgetCap !== undefined) {
        if (typeof body.budgetCap !== 'number' || body.budgetCap <= 0 || !Number.isFinite(body.budgetCap)) {
          res.status(400).json({ error: 'budgetCap must be a positive finite number' });
          return;
        }
        budgetCap = body.budgetCap;

        // Budget partition enforcement: total child budgetCaps must not exceed parent budgetCap.
        if (parent.budgetCap !== undefined) {
          const siblings = this.deps.sessionStore.listChildTasks(parent.id);
          const allocatedToSiblings = siblings.reduce((sum, t) => sum + (t.budgetCap ?? 0), 0);
          if (allocatedToSiblings + budgetCap > parent.budgetCap) {
            this.deps.auditLog.write({
              sessionId: parent.sessionId,
              taskId: parent.id,
              principalId: parent.ownerId,
              eventType: 'delegation.budget.exceeded',
              startedAt: now,
              finishedAt: now,
              error: `Budget partition exceeded: parent budgetCap=${parent.budgetCap}, already allocated=${allocatedToSiblings}, requested=${budgetCap}.`,
            });
            res.status(400).json({
              error: `Budget partition exceeded: parent budgetCap=${parent.budgetCap}, already allocated=${allocatedToSiblings}, requested=${budgetCap}.`,
            });
            return;
          }
        }
      }

      // Validate optional provider/model binding
      const providerName = typeof body.providerName === 'string' ? body.providerName : undefined;
      const modelName = typeof body.modelName === 'string' ? body.modelName : undefined;

      // Scheduler integration: when a scheduler is configured and the child task
      // specifies a provider/model, validate the model is in the pool.
      // The lease is acquired asynchronously before the child task is persisted,
      // so no task exists in a "running without a lease" state.
      let schedulerLeaseId: string | undefined;
      if (providerName && modelName && this.deps.modelScheduler) {
        const entry = this.deps.modelScheduler.getPoolEntry(providerName, modelName);
        if (!entry) {
          this.deps.auditLog.write({
            sessionId: parent.sessionId,
            taskId: parent.id,
            principalId: parent.ownerId,
            eventType: 'delegation.model.not.in.pool',
            startedAt: now,
            finishedAt: now,
            modelProvider: providerName,
            modelName,
            error: `Model "${providerName}/${modelName}" is not in the scheduler pool.`,
          });
          res.status(400).json({
            error: `Model "${providerName}/${modelName}" is not in the scheduler pool. Check GET /v1/scheduler/pool for available models.`,
          });
          return;
        }
        try {
          const lease = await this.deps.modelScheduler.acquireLease(
            'pending-' + now,  // placeholder task ID — real task ID assigned after createTask
            providerName,
            modelName,
          );
          schedulerLeaseId = lease.id;
        } catch (err) {
          this.deps.auditLog.write({
            sessionId: parent.sessionId,
            taskId: parent.id,
            principalId: parent.ownerId,
            eventType: 'scheduler.lease.error',
            startedAt: now,
            finishedAt: now,
            modelProvider: providerName,
            modelName,
            error: err instanceof Error ? err.message : String(err),
          });
          res.status(503).json({
            error: `Scheduler lease error: ${err instanceof Error ? err.message : String(err)}`,
          });
          return;
        }
      }

      const childTask = this.deps.sessionStore.createTask({
        sessionId: parent.sessionId,
        title: body.title,
        ownerId: parent.ownerId,
        capabilitySet: requested,
        sandboxClass: typeof body.sandboxClass === 'string' ? body.sandboxClass : parent.sandboxClass,
        parentTaskId: parent.id,
        deadline: typeof body.deadline === 'string' ? body.deadline : undefined,
        delegationDepth: childDepth,
        budgetCap,
        providerName,
        modelName,
      });

      // Emit model binding audit event when provider/model are explicitly set
      if (providerName || modelName) {
        this.deps.auditLog.write({
          sessionId: parent.sessionId,
          taskId: childTask.id,
          principalId: parent.ownerId,
          eventType: 'delegation.model.bound',
          startedAt: now,
          finishedAt: now,
          modelProvider: providerName,
          modelName: modelName,
          sessionDelta: { parentTaskId: parent.id, providerName, modelName },
        });
      }

      // Emit budget allocation audit event when a budgetCap is set
      if (budgetCap !== undefined) {
        this.deps.auditLog.write({
          sessionId: parent.sessionId,
          taskId: childTask.id,
          principalId: parent.ownerId,
          eventType: 'delegation.budget.allocated',
          startedAt: now,
          finishedAt: now,
          sessionDelta: { parentTaskId: parent.id, budgetCap },
        });
      }

      // Emit capability restriction audit event when child gets fewer capabilities than parent
      if (restricted.length > 0) {
        this.deps.auditLog.write({
          sessionId: parent.sessionId,
          taskId: childTask.id,
          principalId: parent.ownerId,
          eventType: 'delegation.capability.restricted',
          startedAt: now,
          finishedAt: now,
          sessionDelta: {
            parentTaskId: parent.id,
            inherited: requested,
            restricted,
          },
        });
      }

      this.emitEvent({ type: 'task.updated', payload: { task: childTask }, emittedAt: new Date().toISOString() });
      res.status(201).json({ childTask, schedulerLeaseId });
    });

    /**
     * Cancel a task and all of its descendants recursively.
     * Emits a task.cancelled audit event for each task cancelled.
     * Tasks already in a terminal state (completed/failed/cancelled) are skipped.
     */
    r.post('/tasks/:id/cancel', (req, res) => {
      const root = this.deps.sessionStore.getTask(req.params.id);
      if (!root) { res.status(404).json({ error: 'Task not found' }); return; }

      const cancelled: Task[] = [];
      const now = new Date().toISOString();

      const cancelSubtree = (taskId: string): void => {
        const task = this.deps.sessionStore.getTask(taskId);
        if (!task) return;
        // Skip already-terminal tasks
        if (task.state === 'completed' || task.state === 'failed' || task.state === 'cancelled') {
          // Still recurse to children — they may be in non-terminal states
        } else {
          const updated = this.deps.sessionStore.updateTaskState(task.id, 'cancelled');
          if (updated) {
            cancelled.push(updated);
            this.deps.auditLog.write({
              sessionId: task.sessionId,
              taskId: task.id,
              principalId: task.ownerId,
              eventType: 'task.cancelled',
              startedAt: now,
              finishedAt: now,
              sessionDelta: { cancelledBy: req.params.id },
            });
            this.emitEvent({ type: 'task.updated', payload: { task: updated }, emittedAt: now });
            // Release any scheduler lease held by this task
            this.deps.modelScheduler?.releaseByTaskId(task.id, 'released');
          }
        }
        // Recurse into children regardless of parent terminal state
        const children = this.deps.sessionStore.listChildTasks(taskId);
        for (const child of children) {
          cancelSubtree(child.id);
        }
      };

      cancelSubtree(root.id);
      res.json({ cancelled });
    });

    /**
     * Return the full delegation subtree rooted at the given task.
     */
    r.get('/tasks/:id/tree', (req, res) => {
      const tree = this.deps.sessionStore.getDelegationTree(req.params.id);
      if (!tree) { res.status(404).json({ error: 'Task not found' }); return; }
      res.json({ tree });
    });

    /**
     * Release a scheduler lease for a task.
     * Callers should invoke this when a child task completes or fails so the
     * scheduler can free the slot and advance its wait queue.
     * outcome: 'completed' (success) | 'released' (failure / cancel / timeout).
     */
    r.post('/tasks/:id/scheduler/release', (req, res) => {
      const sched = this.deps.modelScheduler;
      if (!sched) {
        res.status(409).json({ error: 'No model scheduler configured on this gateway' });
        return;
      }
      const { leaseId, outcome } = req.body as { leaseId?: unknown; outcome?: unknown };
      if (!leaseId || typeof leaseId !== 'string') {
        res.status(400).json({ error: 'leaseId is required and must be a string' });
        return;
      }
      const resolvedOutcome: 'completed' | 'released' =
        outcome === 'completed' ? 'completed' : 'released';
      sched.releaseLease(leaseId, resolvedOutcome);
      res.json({ released: true, leaseId, outcome: resolvedOutcome });
    });

    // ----- Approvals -----
    r.get('/approvals', (_req, res) => {
      res.json({ approvals: this.deps.approvalStore.listPending() });
    });

    r.post('/approvals', (req, res) => {
      const body = req.body as {
        taskId: string;
        requestedAction: string;
        riskClass: ToolRiskClass;
        proposedScope: Record<string, unknown>;
        humanReadableDiff: string;
        duration?: ApprovalDuration;
      };

      if (!body.taskId || !body.requestedAction || !body.humanReadableDiff) {
        res.status(400).json({ error: 'taskId, requestedAction, and humanReadableDiff are required' });
        return;
      }
      const validRiskClasses: ToolRiskClass[] = ['A', 'B', 'C', 'D', 'E', 'F'];
      if (!validRiskClasses.includes(body.riskClass)) {
        res.status(400).json({ error: `Invalid riskClass. Must be one of: ${validRiskClasses.join(', ')}` });
        return;
      }

      const validDurations: ApprovalDuration[] = ['once', 'session', 'task', 'policy_rule'];
      const duration: ApprovalDuration =
        body.duration && validDurations.includes(body.duration) ? body.duration : 'once';
      const request = this.deps.approvalStore.createRequest({
        ...body,
        duration,
      });
      this.emitEvent({ type: 'approval.requested', payload: { request }, emittedAt: new Date().toISOString() });
      res.status(201).json(request);
    });

    r.post('/approvals/:id/resolve', (req, res) => {
      const { approverId, outcome } = req.body as { approverId?: unknown; outcome?: unknown };
      if (!approverId || typeof approverId !== 'string') {
        res.status(400).json({ error: 'approverId is required and must be a string' });
        return;
      }
      if (outcome !== 'approved' && outcome !== 'denied') {
        res.status(400).json({ error: 'outcome must be "approved" or "denied"' });
        return;
      }
      const updated = this.deps.approvalStore.resolve(req.params.id, approverId, outcome);
      if (!updated) { res.status(404).json({ error: 'Not found or already resolved' }); return; }
      this.emitEvent({ type: 'approval.resolved', payload: { request: updated }, emittedAt: new Date().toISOString() });
      res.json(updated);
    });

    // ----- Artifacts -----
    r.get('/artifacts', (req, res) => {
      const q = req.query as Record<string, string | undefined>;
      let artifacts;
      if (q.invocationId && this.deps.artifactStore) {
        artifacts = this.deps.artifactStore.listByInvocation(q.invocationId);
      } else if (q.provenanceId && this.deps.artifactStore) {
        artifacts = this.deps.artifactStore.listByProvenance(q.provenanceId);
      } else if (q.type && this.deps.artifactStore) {
        artifacts = this.deps.artifactStore.listByType(q.type as import('./types').ArtifactType);
      } else {
        artifacts = this.deps.artifactStore ? this.deps.artifactStore.listAll() : [];
      }
      res.json({ artifacts });
    });

    r.get('/artifacts/:id', (req, res) => {
      if (!this.deps.artifactStore) { res.status(404).json({ error: 'Not found' }); return; }
      const artifact = this.deps.artifactStore.getById(req.params.id);
      if (!artifact) { res.status(404).json({ error: 'Not found' }); return; }
      res.json(artifact);
    });

    // ----- Phase 7: Browser doc-fetch workflow -----
    r.post('/browser/doc-fetch', async (req: Request, res: Response) => {
      if (!this.deps.browserWorker) {
        res.status(503).json({ error: 'Browser worker not configured' });
        return;
      }

      const body = req.body as {
        sessionId?: unknown;
        taskId?: unknown;
        url?: unknown;
        label?: unknown;
      };

      if (!body.sessionId || typeof body.sessionId !== 'string') {
        res.status(400).json({ error: 'sessionId is required' });
        return;
      }
      if (!body.taskId || typeof body.taskId !== 'string') {
        res.status(400).json({ error: 'taskId is required' });
        return;
      }
      if (!body.url || typeof body.url !== 'string') {
        res.status(400).json({ error: 'url is required' });
        return;
      }

      const session = this.deps.sessionStore.getSession(body.sessionId);
      if (!session) { res.status(404).json({ error: 'Session not found' }); return; }

      const task = this.deps.sessionStore.getTask(body.taskId);
      if (!task) { res.status(404).json({ error: 'Task not found' }); return; }

      const principal = this.principals.get(session.principalId);
      if (!principal) { res.status(400).json({ error: 'Session principal not found' }); return; }

      // Parse URL for the networkDomain policy context field; reject unparseable URLs early.
      let networkDomain: string | undefined;
      try {
        networkDomain = new URL(body.url).hostname;
      } catch {
        res.status(400).json({ error: 'url is not a valid URL' });
        return;
      }

      const params: Record<string, unknown> = { url: body.url };
      if (body.label && typeof body.label === 'string') params['label'] = body.label;

      const toolRequest = {
        id: uuidv4(),
        sessionId: body.sessionId,
        taskId: body.taskId,
        toolName: 'browser_doc_fetch',
        params,
        principalId: session.principalId,
      };

      const policyCtx = {
        principal,
        session,
        toolName: 'browser_doc_fetch',
        toolRiskClass: 'D' as import('./types').ToolRiskClass,
        runtimeTarget: 'browser_worker' as import('./types').RuntimeTarget,
        networkDomain,
        approvalState: 'pending' as import('./types').ApprovalOutcome,
      };

      const result = await this.deps.broker.dispatch(toolRequest, policyCtx, task);

      this.emitEvent({
        type: result.denied ? 'policy.denied' : 'tool.finished',
        payload: {
          toolName: 'browser_doc_fetch',
          sessionId: body.sessionId,
          taskId: body.taskId,
          denied: result.denied,
        },
        emittedAt: new Date().toISOString(),
      });

      res.json({
        denied: result.denied,
        requiresApproval: result.requiresApproval,
        policyDecision: result.policyDecision,
        receipt: result.receipt ?? null,
        error: result.invocation.error ?? null,
      });
    });

    // ----- Audit -----
    r.get('/audit', (req, res) => {
      const { sessionId, taskId, principalId } = req.query as Record<string, string | undefined>;
      let records;
      if (sessionId) records = this.deps.auditLog.queryBySession(sessionId);
      else if (taskId) records = this.deps.auditLog.queryByTask(taskId);
      else if (principalId) records = this.deps.auditLog.queryByPrincipal(principalId);
      else records = this.deps.auditLog.exportAll();
      res.json({ records });
    });

    r.get('/audit/:id', (req, res) => {
      const record = this.deps.auditLog.getById(req.params.id);
      if (!record) { res.status(404).json({ error: 'Not found' }); return; }
      res.json(record);
    });

    // ----- Memory -----
    r.post('/memory', (req, res) => {
      const item = this.deps.memoryStore.store(req.body as Parameters<MemoryStore['store']>[0]);
      res.status(201).json(item);
    });

    r.get('/memory', (req, res) => {
      const q = req.query as Record<string, string | undefined>;
      const query: Parameters<MemoryStore['query']>[0] = {};
      if (q.namespace) query.namespace = q.namespace;
      if (q.kind) query.kind = q.kind as MemoryKind;
      if (q.redactClass) query.redactClass = q.redactClass as RedactClass;
      if (q.minConfidence !== undefined) {
        const parsed = parseFloat(q.minConfidence);
        if (!isNaN(parsed)) query.minConfidence = parsed;
      }
      if (q.limit !== undefined) {
        const parsed = parseInt(q.limit, 10);
        if (!isNaN(parsed)) query.limit = parsed;
      }
      const items = this.deps.memoryStore.query(query);
      res.json({ items });
    });

    r.delete('/memory/:id', (req, res) => {
      this.deps.memoryStore.deleteById(req.params.id);
      res.status(204).send();
    });

    // ----- Policy Editor -----
    r.get('/policy/rules', (_req, res) => {
      if (this.deps.policyRuleStore) {
        res.json({ rules: this.deps.policyRuleStore.listRules() });
      } else {
        res.json({ rules: this.deps.policyEngine.getRules() });
      }
    });

    r.post('/policy/rules', (req, res) => {
      const body = req.body as Partial<PolicyRule> & { order?: number };

      const errors = validatePolicyRule(body);
      if (errors.length > 0) {
        res.status(400).json({ errors });
        return;
      }

      const rule: PolicyRule = {
        id: body.id!,
        description: body.description!,
        match: body.match ?? {},
        effect: body.effect!,
        allowedRuntimeTarget: body.allowedRuntimeTarget,
        auditRequired: body.auditRequired !== false,
      };

      if (this.deps.policyRuleStore) {
        this.deps.policyRuleStore.upsertRule(rule, body.order ?? 100);
        const updatedRules = this.deps.policyRuleStore.listRules();
        this.deps.policyEngine.setRules(updatedRules);
      } else {
        const existing = this.deps.policyEngine.getRules();
        const idx = existing.findIndex((r) => r.id === rule.id);
        if (idx >= 0) existing[idx] = rule; else existing.push(rule);
        this.deps.policyEngine.setRules(existing);
      }
      res.status(201).json(rule);
    });

    r.delete('/policy/rules/:id', (req, res) => {
      if (this.deps.policyRuleStore) {
        const deleted = this.deps.policyRuleStore.deleteRule(req.params.id);
        if (!deleted) { res.status(404).json({ error: 'Rule not found' }); return; }
        const updatedRules = this.deps.policyRuleStore.listRules();
        this.deps.policyEngine.setRules(updatedRules);
      } else {
        const existing = this.deps.policyEngine.getRules();
        const filtered = existing.filter((r) => r.id !== req.params.id);
        if (filtered.length === existing.length) {
          res.status(404).json({ error: 'Rule not found' }); return;
        }
        this.deps.policyEngine.setRules(filtered);
      }
      res.status(204).send();
    });

    r.put('/policy/rules/reset', (_req, res) => {
      this.deps.policyEngine.setRules([...DEFAULT_POLICY_RULES]);
      res.json({ rules: this.deps.policyEngine.getRules() });
    });

    r.get('/policy/rules/export', (_req, res) => {
      if (this.deps.policyRuleStore) {
        res.json(this.deps.policyRuleStore.exportRules());
      } else {
        // In-memory fallback: wrap current engine rules in export envelope
        res.json({
          version: '1',
          exportedAt: new Date().toISOString(),
          rules: this.deps.policyEngine.getRules().map((rule, idx) => ({ ...rule, order: idx * 10 })),
        });
      }
    });

    r.post('/policy/rules/import', (req, res) => {
      const body = req.body as { version?: unknown; rules?: unknown; merge?: unknown };

      if (body.version !== '1') {
        res.status(400).json({ error: 'version must be "1"' });
        return;
      }
      if (!Array.isArray(body.rules)) {
        res.status(400).json({ error: 'rules must be an array' });
        return;
      }

      const merge = body.merge === true;

      // Validate each rule before committing anything
      const allErrors: Array<{ index: number; errors: ReturnType<typeof validatePolicyRule> }> = [];
      for (let i = 0; i < body.rules.length; i++) {
        const errs = validatePolicyRule(body.rules[i] as Partial<PolicyRule>);
        if (errs.length > 0) allErrors.push({ index: i, errors: errs });
      }
      if (allErrors.length > 0) {
        res.status(400).json({ error: 'One or more rules failed validation', details: allErrors });
        return;
      }

      const ruleSet = body as { version: '1'; rules: Array<PolicyRule & { order?: number }> };
      const exportedRuleSet = {
        version: '1' as const,
        exportedAt: new Date().toISOString(),
        rules: ruleSet.rules.map((r, idx) => ({ ...r, order: r.order ?? idx * 10 })),
      };

      if (this.deps.policyRuleStore) {
        this.deps.policyRuleStore.importRules(exportedRuleSet, merge);
        const updatedRules = this.deps.policyRuleStore.listRules();
        this.deps.policyEngine.setRules(updatedRules);
      } else {
        const newRules = exportedRuleSet.rules.map((r) => {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { order: _order, ...rule } = r;
          return rule as PolicyRule;
        });
        if (merge) {
          const existing = this.deps.policyEngine.getRules();
          for (const rule of newRules) {
            const idx = existing.findIndex((e) => e.id === rule.id);
            if (idx >= 0) existing[idx] = rule; else existing.push(rule);
          }
          this.deps.policyEngine.setRules(existing);
        } else {
          this.deps.policyEngine.setRules(newRules);
        }
      }

      res.json({ imported: exportedRuleSet.rules.length, merge });
    });

    // ----- Plugins -----

    /**
     * List all registered plugins.
     */
    r.get('/plugins', (_req, res) => {
      const plugins = this.deps.pluginStore
        ? this.deps.pluginStore.list()
        : Array.from(this.plugins.values());
      res.json({ plugins });
    });

    /**
     * Install a plugin.
     * Validates the manifest schema, emits plugin.installed audit event.
     */
    r.post('/plugins', (req, res) => {
      const parseResult = PluginManifestSchema.safeParse(req.body);
      if (!parseResult.success) {
        res.status(400).json({ error: `Invalid plugin manifest: ${parseResult.error.message}` });
        return;
      }
      const manifest = parseResult.data as PluginManifest;

      let installed: PluginManifest;
      if (this.deps.pluginStore) {
        try {
          installed = this.deps.pluginStore.install(manifest);
        } catch (err) {
          res.status(400).json({ error: (err as Error).message });
          return;
        }
      } else {
        installed = { ...manifest, state: 'installed' };
        this.plugins.set(installed.id, installed);
      }

      const now = new Date().toISOString();
      this.deps.auditLog.write({
        sessionId: 'system',
        principalId: 'system',
        eventType: 'plugin.installed',
        startedAt: now,
        finishedAt: now,
        params: { pluginId: installed.id, version: installed.version, riskClass: installed.riskClass },
      });
      res.status(201).json(installed);
    });

    /**
     * Get a single plugin by id.
     */
    r.get('/plugins/:id', (req, res) => {
      const p = this.deps.pluginStore
        ? this.deps.pluginStore.get(req.params.id)
        : this.plugins.get(req.params.id);
      if (!p) { res.status(404).json({ error: 'Not found' }); return; }
      res.json(p);
    });

    /**
     * Enable or disable a plugin.
     * Body: { state: 'enabled' | 'disabled' }
     * Emits plugin.enabled or plugin.disabled audit event.
     */
    r.patch('/plugins/:id/state', (req, res) => {
      const { state } = req.body as { state?: unknown };
      if (state !== 'enabled' && state !== 'disabled') {
        res.status(400).json({ error: "state must be 'enabled' or 'disabled'" });
        return;
      }

      let updated: PluginManifest | undefined;
      if (this.deps.pluginStore) {
        updated = this.deps.pluginStore.setState(req.params.id, state);
      } else {
        const existing = this.plugins.get(req.params.id);
        if (existing) {
          updated = { ...existing, state };
          this.plugins.set(req.params.id, updated);
        }
      }

      if (!updated) { res.status(404).json({ error: 'Not found' }); return; }

      const now = new Date().toISOString();
      this.deps.auditLog.write({
        sessionId: 'system',
        principalId: 'system',
        eventType: state === 'enabled' ? 'plugin.enabled' : 'plugin.disabled',
        startedAt: now,
        finishedAt: now,
        params: { pluginId: updated.id },
      });
      res.json(updated);
    });

    /**
     * Remove a plugin safely.
     * Emits plugin.removed audit event.
     */
    r.delete('/plugins/:id', (req, res) => {
      const pluginId = req.params.id;
      let removed: boolean;
      if (this.deps.pluginStore) {
        removed = this.deps.pluginStore.remove(pluginId);
      } else {
        removed = this.plugins.delete(pluginId);
      }

      if (!removed) { res.status(404).json({ error: 'Not found' }); return; }

      const now = new Date().toISOString();
      this.deps.auditLog.write({
        sessionId: 'system',
        principalId: 'system',
        eventType: 'plugin.removed',
        startedAt: now,
        finishedAt: now,
        params: { pluginId },
      });
      res.json({ removed: true, pluginId });
    });

    /**
     * Invoke a plugin action.
     * The plugin must be enabled.
     * The requested capability must be in the plugin's declared capabilities.
     * The invocation is mediated through policy (using the session's principal)
     * and emits a plugin.action audit event — ensuring full observability.
     *
     * Body: { sessionId, taskId?, capability, params }
     */
    r.post('/plugins/:id/invoke', (req, res) => {
      const pluginId = req.params.id;
      const plugin: PluginManifest | undefined = this.deps.pluginStore
        ? this.deps.pluginStore.get(pluginId)
        : this.plugins.get(pluginId);

      if (!plugin) { res.status(404).json({ error: 'Plugin not found' }); return; }
      if (plugin.state !== 'enabled') {
        res.status(403).json({ error: `Plugin "${pluginId}" is not enabled (state: ${plugin.state})` });
        return;
      }

      const body = req.body as { sessionId?: unknown; taskId?: unknown; capability?: unknown; params?: unknown };
      if (typeof body.sessionId !== 'string' || !body.sessionId) {
        res.status(400).json({ error: 'sessionId is required' });
        return;
      }
      if (typeof body.capability !== 'string' || !body.capability) {
        res.status(400).json({ error: 'capability is required' });
        return;
      }

      // Capability check: requested capability must be in plugin's declared set
      if (!plugin.capabilities.includes(body.capability)) {
        const now = new Date().toISOString();
        this.deps.auditLog.write({
          sessionId: body.sessionId,
          principalId: 'system',
          eventType: 'plugin.capability.denied',
          startedAt: now,
          finishedAt: now,
          error: `Capability "${body.capability}" not declared by plugin "${pluginId}".`,
          params: { pluginId, capability: body.capability },
        });
        res.status(403).json({
          error: `Capability "${body.capability}" not declared by plugin "${pluginId}".`,
        });
        return;
      }

      // Session must exist
      const session = this.deps.sessionStore.getSession(body.sessionId);
      if (!session) { res.status(404).json({ error: 'Session not found' }); return; }

      // Policy check via policyEngine — build a proper PolicyContext
      const principal = this.principals.get(session.principalId);
      // Build a synthetic principal if not registered in this gateway instance (e.g. tests)
      const effectivePrincipal: Principal = principal ?? {
        id: session.principalId,
        type: 'user' as const,
        trustLevel: 'low' as const,
        identities: {},
        policyGroup: 'default',
        createdAt: session.createdAt,
      };

      const now = new Date().toISOString();
      const policyCtx = {
        principal: effectivePrincipal,
        session,
        toolName: `plugin:${pluginId}:${body.capability}`,
        toolRiskClass: plugin.riskClass,
        runtimeTarget: 'plugin_worker' as const,
        approvalState: 'approved' as const,
      };
      const decision = this.deps.policyEngine.evaluate(policyCtx);

      if (decision.mode === 'deny') {
        this.deps.auditLog.write({
          sessionId: body.sessionId,
          principalId: session.principalId,
          eventType: 'plugin.action.denied',
          startedAt: now,
          finishedAt: now,
          error: `Policy denied plugin "${pluginId}" capability "${body.capability}": ${decision.matchedRuleId}`,
          params: { pluginId, capability: body.capability, matchedRuleId: decision.matchedRuleId },
        });
        res.status(403).json({
          error: `Policy denied: ${decision.reason}`,
          matchedRuleId: decision.matchedRuleId,
        });
        return;
      }

      // Emit successful plugin.action audit event
      this.deps.auditLog.write({
        sessionId: body.sessionId,
        principalId: session.principalId,
        eventType: 'plugin.action',
        startedAt: now,
        finishedAt: now,
        params: {
          pluginId,
          capability: body.capability,
          taskId: typeof body.taskId === 'string' ? body.taskId : undefined,
          pluginParams: body.params ?? {},
        },
      });

      res.json({
        pluginId,
        capability: body.capability,
        sessionId: body.sessionId,
        audited: true,
        executedAt: now,
      });
    });

    // ----- Channels ingress (stub) -----
    r.post('/channels/ingest', (req, res) => {
      const envelope = req.body as InboundEnvelope;
      this.deps.auditLog.write({
        sessionId: envelope.sessionId ?? 'none',
        principalId: envelope.principalId ?? 'unknown',
        eventType: 'channel.ingest',
        startedAt: new Date().toISOString(),
        params: { channel: envelope.channel, content: envelope.content },
      });
      res.status(202).json({ status: 'queued', envelopeId: envelope.id });
    });

    // ----- Nodes (stub) -----
    r.get('/nodes', (_req, res) => {
      res.json({ nodes: [] });
    });

    this.app.use('/v1', r);

    // BeeOS operator UI (mounted outside /v1, auth-exempt HTML shell)
    this.app.use('/ui', createBeeOSRouter());
  }

  // ---------------------------------------------------------------------------
  // WebSocket event stream
  // ---------------------------------------------------------------------------

  private setupWebSocket(): void {
    this.wss.on('connection', (ws: WebSocket, req) => {
      // Authenticate via query param or header
      const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
      const token = url.searchParams.get('token') ?? '';
      if (this.config.gatewaySecret && token !== this.config.gatewaySecret) {
        ws.close(1008, 'Unauthorized');
        return;
      }

      this.wsClients.add(ws);
      ws.on('close', () => this.wsClients.delete(ws));

      ws.send(JSON.stringify({ type: 'connected', payload: { message: 'OpenClaw Secure event stream' } }));
    });
  }

  emitEvent(event: GatewayEvent): void {
    const data = JSON.stringify(event);
    for (const client of this.wsClients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      // Probe the model provider before binding the port
      const probeAndStart = async () => {
        const mp = this.deps.modelProvider;
        if (mp) {
          const available = mp.probe ? await mp.probe() : true;
          this.modelProviderAvailable = available;

          // Write a model.provider.selected audit record so the operator can
          // see provider selection in replay/export even without a session.
          this.deps.auditLog.write({
            sessionId: 'gateway',
            principalId: 'system',
            eventType: 'model.provider.selected',
            startedAt: new Date().toISOString(),
            modelProvider: mp.name,
            modelName: mp.model ?? undefined,
            sessionDelta: { available },
          });

          // Emit the event to any pre-connected WebSocket clients (unlikely at
          // startup, but consistent with the event model).
          this.emitEvent({
            type: 'model.provider.selected',
            payload: { provider: mp.name, model: mp.model ?? null, available },
            emittedAt: new Date().toISOString(),
          });

          if (this.config.requireModelProvider && !available) {
            reject(
              new Error(
                `Model provider "${mp.name}" is not reachable and requireModelProvider=true. ` +
                  `Ensure the provider is running before starting the gateway.`
              )
            );
            return;
          }
        }

        this.server.listen(this.config.port, this.config.host, () => {
          resolve();
        });
      };

      probeAndStart().catch(reject);
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.wss.close(() => {
        this.server.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    });
  }

  getApp(): express.Application {
    return this.app;
  }
}
