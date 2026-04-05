export declare enum RiskLevel {
    LOW = "low",
    MEDIUM = "medium",
    HIGH = "high",
    CRITICAL = "critical"
}
export interface Capability {
    name: string;
    description: string;
    riskLevel: RiskLevel;
}
export interface CapabilityManifest {
    pluginName: string;
    version: string;
    capabilities: Capability[];
}
export declare function createCapabilityManifest(pluginName: string, version: string): CapabilityManifest;
export declare function addCapability(manifest: CapabilityManifest, cap: Capability): void;
export declare function getCapability(manifest: CapabilityManifest, name: string): Capability | undefined;
export declare function maxRiskLevel(manifest: CapabilityManifest): RiskLevel;
//# sourceMappingURL=capability_manifest.d.ts.map