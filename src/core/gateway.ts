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
import { buildReplayPack, formatExecutionTrace, checkAuditIntegrity, diffReplayPacks } from './replay';
import { formatReplaySummary, formatReplayDiff, formatPolicyExplanation, formatIntegrityReport } from './display';

/** Maximum allowed delegation depth for child tasks. */
export const MAX_DELEGATION_DEPTH = 5;

export interface GatewayConfig {
  /** Bind host. Defaults to 127.0.0.1 (loopback only). */
  host: string;
  /** Bind port. */
  port: number;
  /** Database path. */
  dbPath: string;
  /** Shared secret for gateway authentication. */
  gatewaySecret: string;
}

const DEFAULT_CONFIG: GatewayConfig = {
  host: '127.0.0.1',
  port: 4242,
  dbPath: ':memory:',
  gatewaySecret: '',
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

  constructor(config: Partial<GatewayConfig>, deps: GatewayDependencies) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.deps = deps;
    this.app = express();
    this.server = createServer(this.app);
    this.wss = new WebSocketServer({ server: this.server });
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
      // Skip auth for health checks
      if (req.path === '/health') return next();

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
      res.json({ status: 'ok', version: '1.0.0' });
    });

    // ----- Auth / Identity -----
    r.get('/auth/principals', (_req, res) => {
      res.json({ principals: Array.from(this.principals.values()) });
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
      res
        .type('text/plain; charset=utf-8')
        .set('X-Content-Type-Options', 'nosniff')
        .set('Content-Disposition', `attachment; filename="session-summary-${req.params.id}.txt"`)
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

      const bundle = {
        sessionId: req.params.id,
        exportedAt: new Date().toISOString(),
        replayPack: pack,
        summary: formatReplaySummary(pack),
        integrityReport: integrityResult,
        integrityReportText: formatIntegrityReport(integrityResult),
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
     * An optional budgetCap limits the token budget consumed by this child.
     */
    r.post('/tasks/:id/delegate', (req, res) => {
      const parent = this.deps.sessionStore.getTask(req.params.id);
      if (!parent) { res.status(404).json({ error: 'Parent task not found' }); return; }

      const body = req.body as {
        title?: unknown;
        requestedCapabilities?: unknown;
        sandboxClass?: unknown;
        deadline?: unknown;
        budgetCap?: unknown;
      };

      if (!body.title || typeof body.title !== 'string') {
        res.status(400).json({ error: 'title is required and must be a string' });
        return;
      }
      if (!Array.isArray(body.requestedCapabilities) || !body.requestedCapabilities.every((c) => typeof c === 'string')) {
        res.status(400).json({ error: 'requestedCapabilities must be an array of strings' });
        return;
      }

      // Enforce delegation depth cap
      const childDepth = (parent.delegationDepth ?? 0) + 1;
      if (childDepth > MAX_DELEGATION_DEPTH) {
        res.status(400).json({
          error: `Maximum delegation depth (${MAX_DELEGATION_DEPTH}) exceeded. Parent is already at depth ${parent.delegationDepth ?? 0}.`,
        });
        return;
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

      // Validate optional budgetCap
      let budgetCap: number | undefined;
      if (body.budgetCap !== undefined) {
        if (typeof body.budgetCap !== 'number' || body.budgetCap <= 0 || !Number.isFinite(body.budgetCap)) {
          res.status(400).json({ error: 'budgetCap must be a positive finite number' });
          return;
        }
        budgetCap = body.budgetCap;
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
      });

      this.emitEvent({ type: 'task.updated', payload: { task: childTask }, emittedAt: new Date().toISOString() });
      res.status(201).json({ childTask });
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
    r.get('/artifacts', (_req, res) => {
      const artifacts = this.deps.artifactStore ? this.deps.artifactStore.listAll() : [];
      res.json({ artifacts });
    });

    r.get('/artifacts/:id', (req, res) => {
      if (!this.deps.artifactStore) { res.status(404).json({ error: 'Not found' }); return; }
      const artifact = this.deps.artifactStore.getById(req.params.id);
      if (!artifact) { res.status(404).json({ error: 'Not found' }); return; }
      res.json(artifact);
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
    r.get('/plugins', (_req, res) => {
      res.json({ plugins: Array.from(this.plugins.values()) });
    });

    r.post('/plugins', (req, res) => {
      const manifest = req.body as PluginManifest;
      if (!manifest.id || !manifest.name) {
        res.status(400).json({ error: 'id and name are required' });
        return;
      }
      this.plugins.set(manifest.id, manifest);
      res.status(201).json(manifest);
    });

    r.get('/plugins/:id', (req, res) => {
      const p = this.plugins.get(req.params.id);
      if (!p) { res.status(404).json({ error: 'Not found' }); return; }
      res.json(p);
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
    return new Promise((resolve) => {
      this.server.listen(this.config.port, this.config.host, () => {
        resolve();
      });
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
