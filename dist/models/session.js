"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createSession = createSession;
const crypto_1 = __importDefault(require("crypto"));
function createSession(principal, agentProfile) {
    return {
        id: crypto_1.default.randomUUID(),
        principal,
        agentProfile,
        createdAt: new Date(),
        active: true,
        tasks: [],
        memory: [],
    };
}
//# sourceMappingURL=session.js.map