import crypto from "crypto";

export interface AgentProfile {
  id: string;
  name: string;
  model: string;
  declaredCapabilities: string[];
  metadata: Record<string, unknown>;
}

export function createAgentProfile(
  name: string,
  model: string,
  declaredCapabilities: string[] = [],
  metadata: Record<string, unknown> = {}
): AgentProfile {
  return { id: crypto.randomUUID(), name, model, declaredCapabilities, metadata };
}

export function agentHasCapability(profile: AgentProfile, capability: string): boolean {
  return profile.declaredCapabilities.includes(capability);
}
