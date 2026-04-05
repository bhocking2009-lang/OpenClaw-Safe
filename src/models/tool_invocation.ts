import crypto from "crypto";

export enum InvocationStatus {
  PENDING = "pending",
  APPROVED = "approved",
  DENIED = "denied",
  COMPLETED = "completed",
  FAILED = "failed",
}

export interface ToolInvocation {
  id: string;
  toolName: string;
  arguments: Record<string, unknown>;
  status: InvocationStatus;
  createdAt: Date;
  result: unknown;
}

export function createToolInvocation(
  toolName: string,
  args: Record<string, unknown> = {}
): ToolInvocation {
  return {
    id: crypto.randomUUID(),
    toolName,
    arguments: args,
    status: InvocationStatus.PENDING,
    createdAt: new Date(),
    result: undefined,
  };
}
