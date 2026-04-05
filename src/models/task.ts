import crypto from "crypto";
import { TaskStep } from "./task_step";

export enum TaskStatus {
  PENDING = "pending",
  IN_PROGRESS = "in_progress",
  COMPLETED = "completed",
  FAILED = "failed",
}

export interface Task {
  id: string;
  goal: string;
  status: TaskStatus;
  createdAt: Date;
  steps: TaskStep[];
}

export function createTask(goal: string): Task {
  return {
    id: crypto.randomUUID(),
    goal,
    status: TaskStatus.PENDING,
    createdAt: new Date(),
    steps: [],
  };
}
