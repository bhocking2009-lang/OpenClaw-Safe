import { CapabilityManifest } from "./capability_manifest";
import { PolicyEngine } from "./policy";
import { ScopedCapabilityToken } from "./scoped_token";
import { PluginProcess } from "./plugin_process";
import { AuditLog } from "./audit_log";
export declare class PluginManager {
    private readonly policyEngine;
    private readonly auditLog?;
    private registrations;
    constructor(policyEngine: PolicyEngine, auditLog?: AuditLog | undefined);
    register(manifest: CapabilityManifest, sessionId: string): ScopedCapabilityToken;
    unregister(pluginName: string, sessionId: string): void;
    spawnProcess(token: ScopedCapabilityToken): PluginProcess;
    get registeredPlugins(): string[];
}
//# sourceMappingURL=plugin_manager.d.ts.map