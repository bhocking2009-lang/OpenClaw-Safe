"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createArtifact = createArtifact;
const crypto_1 = __importDefault(require("crypto"));
function createArtifact(invocationId, content, mimeType = "text/plain") {
    return { id: crypto_1.default.randomUUID(), invocationId, content, mimeType, createdAt: new Date() };
}
//# sourceMappingURL=artifact.js.map