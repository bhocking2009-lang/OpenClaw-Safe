import { Principal } from "../models/principal";
import { AgentProfile } from "../models/agent_profile";
import { createSession, Session } from "../models/session";
import { createTask, Task } from "../models/task";
import { TaskStep } from "../models/task_step";
import { createToolInvocation } from "../models/tool_invocation";
import { createMemoryItem, MemoryItem } from "../models/memory_item";
import { ApprovalRequest } from "../models/approval_request";
import { createArtifact, Artifact } from "../models/artifact";
import { CapabilityManifest } from "./capability_manifest";
import { PolicyEngine } from "./policy";
import { PluginManager } from "./plugin_manager";
import { ToolBroker } from "./broker";
import { AuditLog, AuditEventKind } from "./audit_log";
import { ScopedCapabilityToken } from "./scoped_token";
import { SessionStore } from "./session_store";
import { BrowserWorker } from "../workers/browser";
import { EventBus } from "./event_bus";
import { ApprovalInbox } from "./approval_inbox";

export const BROWSER_DOC_FETCH_SCHEMA = {
  name: "browser_doc_fetch",
  description: "Fetch a document from a URL using the browser worker.",
  inputSchema: {
    type: "object",
    properties: {
      url: { type: "string", description: "URL to fetch" },
      actorId: { type: "string", description: "Actor performing the fetch" },
    },
    required: ["url", "actorId"],
  },
  toolClass: "browser",
  riskLevel: "high",
};

export interface GatewayDependencies {
  policyEngine: PolicyEngine;
  pluginManager: PluginManager;
  toolBroker: ToolBroker;
  auditLog: AuditLog;
  sessionStore?: SessionStore;
  browserWorker?: BrowserWorker;
  eventBus?: EventBus;
  approvalInbox?: ApprovalInbox;
}

type ExtraDeps = Partial<Pick<GatewayDependencies, "sessionStore" | "browserWorker" | "eventBus" | "approvalInbox">>;

export class Gateway {
  private readonly sessionStore?: SessionStore;
  private readonly browserWorker?: BrowserWorker;
  private readonly eventBus?: EventBus;
  private readonly approvalInbox?: ApprovalInbox;

  constructor(
    private readonly policyEngine: PolicyEngine,
    private readonly pluginManager: PluginManager,
    private readonly toolBroker: ToolBroker,
    private readonly auditLog: AuditLog,
    extraDeps?: ExtraDeps
  ) {
    this.sessionStore = extraDeps?.sessionStore;
    this.browserWorker = extraDeps?.browserWorker;
    this.eventBus = extraDeps?.eventBus;
    this.approvalInbox = extraDeps?.approvalInbox;
  }

  // ------------------------------------------------------------------
  // Session management
  // ------------------------------------------------------------------

  openSession(principal: Principal, agentProfile: AgentProfile): Session {
    const session = createSession(principal, agentProfile);
    this.auditLog.record(AuditEventKind.SESSION_CREATED, principal.id, {
      sessionId: session.id,
      agent: agentProfile.name,
    });
    return session;
  }

  closeSession(session: Session): void {
    session.active = false;
    this.auditLog.record(AuditEventKind.SESSION_CLOSED, session.principal.id, {
      sessionId: session.id,
    });
  }

  // ------------------------------------------------------------------
  // Task management
  // ------------------------------------------------------------------

  createTask(session: Session, goal: string): Task {
    const task = createTask(goal);
    session.tasks.push(task);
    this.auditLog.record(AuditEventKind.TASK_CREATED, session.principal.id, {
      sessionId: session.id,
      taskId: task.id,
      goal,
    });
    return task;
  }

  // ------------------------------------------------------------------
  // Tool invocation pipeline (diagram 4)
  // ------------------------------------------------------------------

  invokeTool(
    session: Session,
    taskStep: TaskStep,
    toolName: string,
    args: Record<string, unknown> = {},
    manifest?: CapabilityManifest,
    approval?: ApprovalRequest,
    breakGlassToken = ""
  ): Artifact {
    const invocation = createToolInvocation(toolName, args);
    taskStep.invocations.push(invocation);

    this.auditLog.record(AuditEventKind.TOOL_INVOKED, session.principal.id, {
      sessionId: session.id,
      tool: toolName,
      invocationId: invocation.id,
    });

    const evaluation = this.policyEngine.evaluate(toolName, session.id, manifest);

    return this.toolBroker.dispatch(
      invocation,
      evaluation,
      session.id,
      approval,
      breakGlassToken
    );
  }

  // ------------------------------------------------------------------
  // Browser document fetch
  // ------------------------------------------------------------------

  async browserDocFetch(
    session: Session,
    url: string,
    fetchImpl?: Parameters<BrowserWorker["fetch"]>[2]
  ): Promise<Artifact> {
    if (!this.browserWorker) {
      throw new Error("BrowserWorker not configured in GatewayDependencies.");
    }
    const result = await this.browserWorker.fetch(url, session.principal.id, fetchImpl);
    const artifact = createArtifact(session.id, result.body, result.contentType);
    artifact.tokensUsed = result.tokensUsed;
    return artifact;
  }

  // ------------------------------------------------------------------
  // Plugin management
  // ------------------------------------------------------------------

  registerPlugin(manifest: CapabilityManifest, session: Session): ScopedCapabilityToken {
    return this.pluginManager.register(manifest, session.id);
  }

  // ------------------------------------------------------------------
  // Memory
  // ------------------------------------------------------------------

  remember(session: Session, key: string, value: unknown): MemoryItem {
    const item = createMemoryItem(key, value);
    session.memory.push(item);
    return item;
  }
}
