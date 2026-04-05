import { TaskStep } from "./task_step";
export declare enum TaskStatus {
    PENDING = "pending",
    IN_PROGRESS = "in_progress",
    COMPLETED = "completed",
    FAILED = "failed"
}
export interface Task {
    id: string;
    goal: string;
    status: TaskStatus;
    createdAt: Date;
    steps: TaskStep[];
}
export declare function createTask(goal: string): Task;
//# sourceMappingURL=task.d.ts.map