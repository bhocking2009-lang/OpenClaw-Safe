"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PrincipalRole = void 0;
exports.createPrincipal = createPrincipal;
const crypto_1 = __importDefault(require("crypto"));
var PrincipalRole;
(function (PrincipalRole) {
    PrincipalRole["OPERATOR"] = "operator";
    PrincipalRole["FAMILY"] = "family";
    PrincipalRole["TRUSTED_MEMBER"] = "trusted_member";
})(PrincipalRole || (exports.PrincipalRole = PrincipalRole = {}));
function createPrincipal(name, role) {
    return { id: crypto_1.default.randomUUID(), name, role };
}
//# sourceMappingURL=principal.js.map