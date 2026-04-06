export interface ToolContext {
  toolName: string;
  actorId: string;
  riskLevel?: string;
  sessionBudget?: number;
}

export interface EvaluationTraceEntry {
  ruleId: string;
  matched: boolean;
  reason: string;
}

export interface ExportManifest {
  provenanceId: string;
  sessionCount: number;
  taskCount: number;
  toolInvocationCount: number;
  browserDenialCount: number;
  artifactCount: number;
}
