"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.InvocationStatus = void 0;
exports.createToolInvocation = createToolInvocation;
const crypto_1 = __importDefault(require("crypto"));
var InvocationStatus;
(function (InvocationStatus) {
    InvocationStatus["PENDING"] = "pending";
    InvocationStatus["APPROVED"] = "approved";
    InvocationStatus["DENIED"] = "denied";
    InvocationStatus["COMPLETED"] = "completed";
    InvocationStatus["FAILED"] = "failed";
})(InvocationStatus || (exports.InvocationStatus = InvocationStatus = {}));
function createToolInvocation(toolName, args = {}) {
    return {
        id: crypto_1.default.randomUUID(),
        toolName,
        arguments: args,
        status: InvocationStatus.PENDING,
        createdAt: new Date(),
        result: undefined,
    };
}
//# sourceMappingURL=tool_invocation.js.map