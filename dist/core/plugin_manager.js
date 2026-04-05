"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PluginManager = void 0;
const scoped_token_1 = require("./scoped_token");
const plugin_process_1 = require("./plugin_process");
const plugin_sdk_api_1 = require("../sdk/plugin_sdk_api");
const audit_log_1 = require("./audit_log");
class PluginManager {
    policyEngine;
    auditLog;
    registrations = new Map();
    constructor(policyEngine, auditLog) {
        this.policyEngine = policyEngine;
        this.auditLog = auditLog;
    }
    register(manifest, sessionId) {
        const granted = [];
        const denied = [];
        for (const cap of manifest.capabilities) {
            const evaluation = this.policyEngine.evaluate(cap.name, sessionId, manifest);
            if (evaluation.decision === "allow") {
                granted.push(cap.name);
            }
            else {
                denied.push(cap.name);
            }
        }
        const token = (0, scoped_token_1.issueToken)(manifest.pluginName, sessionId, granted);
        this.registrations.set(manifest.pluginName, { manifest, sessionId });
        if (this.auditLog) {
            this.auditLog.record(audit_log_1.AuditEventKind.PLUGIN_REGISTERED, sessionId, {
                plugin: manifest.pluginName,
                granted,
                denied,
            });
            this.auditLog.record(audit_log_1.AuditEventKind.CAPABILITY_TOKEN_ISSUED, sessionId, {
                plugin: manifest.pluginName,
                tokenId: token.id,
            });
        }
        return token;
    }
    unregister(pluginName, sessionId) {
        if (!this.registrations.has(pluginName)) {
            throw new Error(`Plugin '${pluginName}' is not registered.`);
        }
        this.registrations.delete(pluginName);
        if (this.auditLog) {
            this.auditLog.record(audit_log_1.AuditEventKind.PLUGIN_UNREGISTERED, sessionId, {
                plugin: pluginName,
            });
        }
    }
    spawnProcess(token) {
        const sdk = new plugin_sdk_api_1.PluginSDKAPI(token);
        return new plugin_process_1.PluginProcess(token.pluginName, token, sdk);
    }
    get registeredPlugins() {
        return Array.from(this.registrations.keys());
    }
}
exports.PluginManager = PluginManager;
//# sourceMappingURL=plugin_manager.js.map