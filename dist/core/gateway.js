"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Gateway = void 0;
const session_1 = require("../models/session");
const task_1 = require("../models/task");
const tool_invocation_1 = require("../models/tool_invocation");
const memory_item_1 = require("../models/memory_item");
const audit_log_1 = require("./audit_log");
class Gateway {
    policyEngine;
    pluginManager;
    toolBroker;
    auditLog;
    constructor(policyEngine, pluginManager, toolBroker, auditLog) {
        this.policyEngine = policyEngine;
        this.pluginManager = pluginManager;
        this.toolBroker = toolBroker;
        this.auditLog = auditLog;
    }
    // ------------------------------------------------------------------
    // Session management
    // ------------------------------------------------------------------
    openSession(principal, agentProfile) {
        const session = (0, session_1.createSession)(principal, agentProfile);
        this.auditLog.record(audit_log_1.AuditEventKind.SESSION_CREATED, principal.id, {
            sessionId: session.id,
            agent: agentProfile.name,
        });
        return session;
    }
    closeSession(session) {
        session.active = false;
        this.auditLog.record(audit_log_1.AuditEventKind.SESSION_CLOSED, session.principal.id, {
            sessionId: session.id,
        });
    }
    // ------------------------------------------------------------------
    // Task management
    // ------------------------------------------------------------------
    createTask(session, goal) {
        const task = (0, task_1.createTask)(goal);
        session.tasks.push(task);
        this.auditLog.record(audit_log_1.AuditEventKind.TASK_CREATED, session.principal.id, {
            sessionId: session.id,
            taskId: task.id,
            goal,
        });
        return task;
    }
    // ------------------------------------------------------------------
    // Tool invocation pipeline (diagram 4)
    // ------------------------------------------------------------------
    invokeTool(session, taskStep, toolName, args = {}, manifest, approval, breakGlassToken = "") {
        const invocation = (0, tool_invocation_1.createToolInvocation)(toolName, args);
        taskStep.invocations.push(invocation);
        this.auditLog.record(audit_log_1.AuditEventKind.TOOL_INVOKED, session.principal.id, {
            sessionId: session.id,
            tool: toolName,
            invocationId: invocation.id,
        });
        const evaluation = this.policyEngine.evaluate(toolName, session.id, manifest);
        return this.toolBroker.dispatch(invocation, evaluation, session.id, approval, breakGlassToken);
    }
    // ------------------------------------------------------------------
    // Plugin management
    // ------------------------------------------------------------------
    registerPlugin(manifest, session) {
        return this.pluginManager.register(manifest, session.id);
    }
    // ------------------------------------------------------------------
    // Memory
    // ------------------------------------------------------------------
    remember(session, key, value) {
        const item = (0, memory_item_1.createMemoryItem)(key, value);
        session.memory.push(item);
        return item;
    }
}
exports.Gateway = Gateway;
//# sourceMappingURL=gateway.js.map