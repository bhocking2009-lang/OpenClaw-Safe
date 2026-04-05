"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createMemoryItem = createMemoryItem;
const crypto_1 = __importDefault(require("crypto"));
function createMemoryItem(key, value) {
    return { id: crypto_1.default.randomUUID(), key, value, createdAt: new Date() };
}
//# sourceMappingURL=memory_item.js.map