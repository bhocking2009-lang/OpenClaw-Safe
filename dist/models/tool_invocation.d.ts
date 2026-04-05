export declare enum InvocationStatus {
    PENDING = "pending",
    APPROVED = "approved",
    DENIED = "denied",
    COMPLETED = "completed",
    FAILED = "failed"
}
export interface ToolInvocation {
    id: string;
    toolName: string;
    arguments: Record<string, unknown>;
    status: InvocationStatus;
    createdAt: Date;
    result: unknown;
}
export declare function createToolInvocation(toolName: string, args?: Record<string, unknown>): ToolInvocation;
//# sourceMappingURL=tool_invocation.d.ts.map