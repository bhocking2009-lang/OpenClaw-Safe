"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createAgentProfile = createAgentProfile;
exports.agentHasCapability = agentHasCapability;
const crypto_1 = __importDefault(require("crypto"));
function createAgentProfile(name, model, declaredCapabilities = [], metadata = {}) {
    return { id: crypto_1.default.randomUUID(), name, model, declaredCapabilities, metadata };
}
function agentHasCapability(profile, capability) {
    return profile.declaredCapabilities.includes(capability);
}
//# sourceMappingURL=agent_profile.js.map