export declare enum ApprovalStatus {
    PENDING = "pending",
    APPROVED = "approved",
    DENIED = "denied"
}
export interface ApprovalRequest {
    id: string;
    invocationId: string;
    reason: string;
    status: ApprovalStatus;
    createdAt: Date;
    resolvedAt: Date | null;
}
export declare function createApprovalRequest(invocationId: string, reason: string): ApprovalRequest;
//# sourceMappingURL=approval_request.d.ts.map