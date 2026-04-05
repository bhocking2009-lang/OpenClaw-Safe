import crypto from "crypto";

export enum ApprovalStatus {
  PENDING = "pending",
  APPROVED = "approved",
  DENIED = "denied",
}

export interface ApprovalRequest {
  id: string;
  invocationId: string;
  reason: string;
  status: ApprovalStatus;
  createdAt: Date;
  resolvedAt: Date | null;
}

export function createApprovalRequest(
  invocationId: string,
  reason: string
): ApprovalRequest {
  return {
    id: crypto.randomUUID(),
    invocationId,
    reason,
    status: ApprovalStatus.PENDING,
    createdAt: new Date(),
    resolvedAt: null,
  };
}
