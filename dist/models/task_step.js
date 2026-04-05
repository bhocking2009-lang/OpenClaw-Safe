"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createTaskStep = createTaskStep;
const crypto_1 = __importDefault(require("crypto"));
function createTaskStep(description) {
    return {
        id: crypto_1.default.randomUUID(),
        description,
        createdAt: new Date(),
        invocations: [],
    };
}
//# sourceMappingURL=task_step.js.map