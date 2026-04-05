export interface ScopedCapabilityToken {
    id: string;
    pluginName: string;
    sessionId: string;
    grantedCapabilities: string[];
    token: string;
    issuedAt: Date;
    expiresAt: Date;
}
export declare function issueToken(pluginName: string, sessionId: string, grantedCapabilities: string[], ttlMs?: number): ScopedCapabilityToken;
export declare function isTokenValid(t: ScopedCapabilityToken): boolean;
export declare function tokenAllows(t: ScopedCapabilityToken, capability: string): boolean;
//# sourceMappingURL=scoped_token.d.ts.map