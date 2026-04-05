export enum RiskLevel {
  LOW = "low",
  MEDIUM = "medium",
  HIGH = "high",
  CRITICAL = "critical",
}

const RISK_ORDER: RiskLevel[] = [RiskLevel.LOW, RiskLevel.MEDIUM, RiskLevel.HIGH, RiskLevel.CRITICAL];

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

export function createCapabilityManifest(pluginName: string, version: string): CapabilityManifest {
  return { pluginName, version, capabilities: [] };
}

export function addCapability(manifest: CapabilityManifest, cap: Capability): void {
  manifest.capabilities.push(cap);
}

export function getCapability(manifest: CapabilityManifest, name: string): Capability | undefined {
  return manifest.capabilities.find((c) => c.name === name);
}

export function maxRiskLevel(manifest: CapabilityManifest): RiskLevel {
  if (manifest.capabilities.length === 0) return RiskLevel.LOW;
  const maxIdx = Math.max(...manifest.capabilities.map((c) => RISK_ORDER.indexOf(c.riskLevel)));
  return RISK_ORDER[maxIdx];
}
