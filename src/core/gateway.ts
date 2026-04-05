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
} from './types';
import { PolicyEngine } from './policy';
import { ToolBroker } from './broker';
import { AuditLog } from './audit';
import { SessionStore } from './session';
import { ApprovalStore } from './approval';
import { MemoryStore } from './memory';

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
      const principal: Principal = {
        id: uuidv4(),
        type: body.type ?? 'user',
        identities: body.identities ?? {},
        trustLevel: body.trustLevel ?? 'medium',
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
      const updated = this.deps.sessionStore.updateSession(req.params.id, req.body as Partial<Session>);
      if (!updated) { res.status(404).json({ error: 'Not found' }); return; }
      this.emitEvent({ type: 'session.updated', payload: { session: updated }, emittedAt: new Date().toISOString() });
      res.json(updated);
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
      const { state, executorId } = req.body as { state: string; executorId?: string };
      const updated = this.deps.sessionStore.updateTaskState(req.params.id, state as Task['state'], executorId);
      if (!updated) { res.status(404).json({ error: 'Not found' }); return; }
      this.emitEvent({ type: 'task.updated', payload: { task: updated }, emittedAt: new Date().toISOString() });
      res.json(updated);
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
      };
      const request = this.deps.approvalStore.createRequest({
        ...body,
        duration: 'once',
      });
      this.emitEvent({ type: 'approval.requested', payload: { request }, emittedAt: new Date().toISOString() });
      res.status(201).json(request);
    });

    r.post('/approvals/:id/resolve', (req, res) => {
      const { approverId, outcome } = req.body as { approverId: string; outcome: 'approved' | 'denied' };
      const updated = this.deps.approvalStore.resolve(req.params.id, approverId, outcome);
      if (!updated) { res.status(404).json({ error: 'Not found or already resolved' }); return; }
      this.emitEvent({ type: 'approval.resolved', payload: { request: updated }, emittedAt: new Date().toISOString() });
      res.json(updated);
    });

    // ----- Artifacts (stub) -----
    r.get('/artifacts', (_req, res) => {
      res.json({ artifacts: [] });
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
      const items = this.deps.memoryStore.query(req.query as Parameters<MemoryStore['query']>[0]);
      res.json({ items });
    });

    r.delete('/memory/:id', (req, res) => {
      this.deps.memoryStore.deleteById(req.params.id);
      res.status(204).send();
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
