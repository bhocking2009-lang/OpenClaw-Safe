import crypto from "crypto";

const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes

export interface ScopedCapabilityToken {
  id: string;
  pluginName: string;
  sessionId: string;
  grantedCapabilities: string[];
  token: string;
  issuedAt: Date;
  expiresAt: Date;
}

export function issueToken(
  pluginName: string,
  sessionId: string,
  grantedCapabilities: string[],
  ttlMs = DEFAULT_TTL_MS
): ScopedCapabilityToken {
  const now = new Date();
  return {
    id: crypto.randomUUID(),
    pluginName,
    sessionId,
    grantedCapabilities,
    token: crypto.randomBytes(32).toString("hex"),
    issuedAt: now,
    expiresAt: new Date(now.getTime() + ttlMs),
  };
}

export function isTokenValid(t: ScopedCapabilityToken): boolean {
  return new Date() < t.expiresAt;
}

export function tokenAllows(t: ScopedCapabilityToken, capability: string): boolean {
  return isTokenValid(t) && t.grantedCapabilities.includes(capability);
}
