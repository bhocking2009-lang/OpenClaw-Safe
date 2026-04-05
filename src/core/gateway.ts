import { Principal } from "../models/principal";
import { AgentProfile } from "../models/agent_profile";
import { createSession, Session } from "../models/session";
import { createTask, Task } from "../models/task";
import { TaskStep } from "../models/task_step";
import { createToolInvocation } from "../models/tool_invocation";
import { createMemoryItem, MemoryItem } from "../models/memory_item";
import { ApprovalRequest } from "../models/approval_request";
import { Artifact } from "../models/artifact";
import { CapabilityManifest } from "./capability_manifest";
import { PolicyEngine } from "./policy";
import { PluginManager } from "./plugin_manager";
import { ToolBroker } from "./broker";
import { AuditLog, AuditEventKind } from "./audit_log";
import { ScopedCapabilityToken } from "./scoped_token";

export class Gateway {
  constructor(
    private readonly policyEngine: PolicyEngine,
    private readonly pluginManager: PluginManager,
    private readonly toolBroker: ToolBroker,
    private readonly auditLog: AuditLog
  ) {}

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
