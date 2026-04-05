import crypto from "crypto";
import { ToolInvocation } from "./tool_invocation";

export interface TaskStep {
  id: string;
  description: string;
  createdAt: Date;
  invocations: ToolInvocation[];
}

export function createTaskStep(description: string): TaskStep {
  return {
    id: crypto.randomUUID(),
    description,
    createdAt: new Date(),
    invocations: [],
  };
}
