export interface AgentProfile {
    id: string;
    name: string;
    model: string;
    declaredCapabilities: string[];
    metadata: Record<string, unknown>;
}
export declare function createAgentProfile(name: string, model: string, declaredCapabilities?: string[], metadata?: Record<string, unknown>): AgentProfile;
export declare function agentHasCapability(profile: AgentProfile, capability: string): boolean;
//# sourceMappingURL=agent_profile.d.ts.map