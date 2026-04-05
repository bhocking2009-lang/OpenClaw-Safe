import { CapabilityManifest } from "./capability_manifest";
import { PolicyEngine } from "./policy";
import { issueToken, ScopedCapabilityToken } from "./scoped_token";
import { PluginProcess } from "./plugin_process";
import { PluginSDKAPI } from "../sdk/plugin_sdk_api";
import { AuditLog, AuditEventKind } from "./audit_log";

interface PluginRegistration {
  manifest: CapabilityManifest;
  sessionId: string;
}

export class PluginManager {
  private registrations: Map<string, PluginRegistration> = new Map();

  constructor(
    private readonly policyEngine: PolicyEngine,
    private readonly auditLog?: AuditLog
  ) {}

  register(manifest: CapabilityManifest, sessionId: string): ScopedCapabilityToken {
    const granted: string[] = [];
    const denied: string[] = [];

    for (const cap of manifest.capabilities) {
      const evaluation = this.policyEngine.evaluate(cap.name, sessionId, manifest);
      if (evaluation.decision === "allow") {
        granted.push(cap.name);
      } else {
        denied.push(cap.name);
      }
    }

    const token = issueToken(manifest.pluginName, sessionId, granted);
    this.registrations.set(manifest.pluginName, { manifest, sessionId });

    if (this.auditLog) {
      this.auditLog.record(AuditEventKind.PLUGIN_REGISTERED, sessionId, {
        plugin: manifest.pluginName,
        granted,
        denied,
      });
      this.auditLog.record(AuditEventKind.CAPABILITY_TOKEN_ISSUED, sessionId, {
        plugin: manifest.pluginName,
        tokenId: token.id,
      });
    }

    return token;
  }

  unregister(pluginName: string, sessionId: string): void {
    if (!this.registrations.has(pluginName)) {
      throw new Error(`Plugin '${pluginName}' is not registered.`);
    }
    this.registrations.delete(pluginName);
    if (this.auditLog) {
      this.auditLog.record(AuditEventKind.PLUGIN_UNREGISTERED, sessionId, {
        plugin: pluginName,
      });
    }
  }

  spawnProcess(token: ScopedCapabilityToken): PluginProcess {
    const sdk = new PluginSDKAPI(token);
    return new PluginProcess(token.pluginName, token, sdk);
  }

  get registeredPlugins(): string[] {
    return Array.from(this.registrations.keys());
  }
}
