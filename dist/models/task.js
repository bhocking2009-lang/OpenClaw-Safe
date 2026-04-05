"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TaskStatus = void 0;
exports.createTask = createTask;
const crypto_1 = __importDefault(require("crypto"));
var TaskStatus;
(function (TaskStatus) {
    TaskStatus["PENDING"] = "pending";
    TaskStatus["IN_PROGRESS"] = "in_progress";
    TaskStatus["COMPLETED"] = "completed";
    TaskStatus["FAILED"] = "failed";
})(TaskStatus || (exports.TaskStatus = TaskStatus = {}));
function createTask(goal) {
    return {
        id: crypto_1.default.randomUUID(),
        goal,
        status: TaskStatus.PENDING,
        createdAt: new Date(),
        steps: [],
    };
}
//# sourceMappingURL=task.js.map