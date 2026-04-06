import crypto from "crypto";

export interface PendingApproval {
  id: string;
  invocationId: string;
  sessionId: string;
  toolName: string;
  reason: string;
  requestedAt: string;
  resolvedAt: string | null;
  status: "pending" | "approved" | "denied";
}

export class ApprovalInbox {
  private store: Map<string, PendingApproval> = new Map();

  submit(
    invocationId: string,
    sessionId: string,
    toolName: string,
    reason: string
  ): PendingApproval {
    const approval: PendingApproval = {
      id: crypto.randomUUID(),
      invocationId,
      sessionId,
      toolName,
      reason,
      requestedAt: new Date().toISOString(),
      resolvedAt: null,
      status: "pending",
    };
    this.store.set(approval.id, approval);
    return approval;
  }

  approve(id: string): PendingApproval {
    const approval = this.getOrThrow(id);
    approval.status = "approved";
    approval.resolvedAt = new Date().toISOString();
    return approval;
  }

  deny(id: string): PendingApproval {
    const approval = this.getOrThrow(id);
    approval.status = "denied";
    approval.resolvedAt = new Date().toISOString();
    return approval;
  }

  get(id: string): PendingApproval | undefined {
    return this.store.get(id);
  }

  pending(): PendingApproval[] {
    return Array.from(this.store.values()).filter((a) => a.status === "pending");
  }

  resolved(): PendingApproval[] {
    return Array.from(this.store.values()).filter((a) => a.status !== "pending");
  }

  private getOrThrow(id: string): PendingApproval {
    const approval = this.store.get(id);
    if (!approval) throw new Error(`Approval '${id}' not found.`);
    return approval;
  }
}
