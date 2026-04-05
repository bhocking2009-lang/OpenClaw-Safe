"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.issueToken = issueToken;
exports.isTokenValid = isTokenValid;
exports.tokenAllows = tokenAllows;
const crypto_1 = __importDefault(require("crypto"));
const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes
function issueToken(pluginName, sessionId, grantedCapabilities, ttlMs = DEFAULT_TTL_MS) {
    const now = new Date();
    return {
        id: crypto_1.default.randomUUID(),
        pluginName,
        sessionId,
        grantedCapabilities,
        token: crypto_1.default.randomBytes(32).toString("hex"),
        issuedAt: now,
        expiresAt: new Date(now.getTime() + ttlMs),
    };
}
function isTokenValid(t) {
    return new Date() < t.expiresAt;
}
function tokenAllows(t, capability) {
    return isTokenValid(t) && t.grantedCapabilities.includes(capability);
}
//# sourceMappingURL=scoped_token.js.map