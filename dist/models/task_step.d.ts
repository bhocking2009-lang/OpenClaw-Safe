import { ToolInvocation } from "./tool_invocation";
export interface TaskStep {
    id: string;
    description: string;
    createdAt: Date;
    invocations: ToolInvocation[];
}
export declare function createTaskStep(description: string): TaskStep;
//# sourceMappingURL=task_step.d.ts.map