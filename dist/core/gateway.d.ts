import { Principal } from "../models/principal";
import { AgentProfile } from "../models/agent_profile";
import { Session } from "../models/session";
import { Task } from "../models/task";
import { TaskStep } from "../models/task_step";
import { MemoryItem } from "../models/memory_item";
import { ApprovalRequest } from "../models/approval_request";
import { Artifact } from "../models/artifact";
import { CapabilityManifest } from "./capability_manifest";
import { PolicyEngine } from "./policy";
import { PluginManager } from "./plugin_manager";
import { ToolBroker } from "./broker";
import { AuditLog } from "./audit_log";
import { ScopedCapabilityToken } from "./scoped_token";
export declare class Gateway {
    private readonly policyEngine;
    private readonly pluginManager;
    private readonly toolBroker;
    private readonly auditLog;
    constructor(policyEngine: PolicyEngine, pluginManager: PluginManager, toolBroker: ToolBroker, auditLog: AuditLog);
    openSession(principal: Principal, agentProfile: AgentProfile): Session;
    closeSession(session: Session): void;
    createTask(session: Session, goal: string): Task;
    invokeTool(session: Session, taskStep: TaskStep, toolName: string, args?: Record<string, unknown>, manifest?: CapabilityManifest, approval?: ApprovalRequest, breakGlassToken?: string): Artifact;
    registerPlugin(manifest: CapabilityManifest, session: Session): ScopedCapabilityToken;
    remember(session: Session, key: string, value: unknown): MemoryItem;
}
//# sourceMappingURL=gateway.d.ts.map