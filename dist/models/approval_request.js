"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ApprovalStatus = void 0;
exports.createApprovalRequest = createApprovalRequest;
const crypto_1 = __importDefault(require("crypto"));
var ApprovalStatus;
(function (ApprovalStatus) {
    ApprovalStatus["PENDING"] = "pending";
    ApprovalStatus["APPROVED"] = "approved";
    ApprovalStatus["DENIED"] = "denied";
})(ApprovalStatus || (exports.ApprovalStatus = ApprovalStatus = {}));
function createApprovalRequest(invocationId, reason) {
    return {
        id: crypto_1.default.randomUUID(),
        invocationId,
        reason,
        status: ApprovalStatus.PENDING,
        createdAt: new Date(),
        resolvedAt: null,
    };
}
//# sourceMappingURL=approval_request.js.map