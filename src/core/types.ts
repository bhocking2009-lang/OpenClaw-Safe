/**
 * Core data models for OpenClaw Secure.
 *
 * Every principal is identified.
 * Every action is scoped.
 * Every execution happens in a declared runtime.
 * Every external effect is auditable.
 */

// ---------------------------------------------------------------------------
// Enumerations
// ---------------------------------------------------------------------------

export type PrincipalType = 'operator' | 'user' | 'child_agent' | 'system';
export type TrustLevel = 'high' | 'medium' | 'low';
export type SessionMode = 'interactive' | 'task' | 'review' | 'readonly';
export type TaskState = 'pending' | 'running' | 'awaiting_approval' | 'completed' | 'failed' | 'cancelled';
export type ApprovalOutcome = 'approved' | 'denied' | 'pending' | 'expired';
export type ApprovalDuration = 'once' | 'session' | 'task' | 'policy_rule';
export type MemoryKind = 'transcript' | 'task' | 'factual' | 'preference' | 'episodic' | 'document' | 'summary';
export type ArtifactType = 'file' | 'screenshot' | 'pdf' | 'log' | 'diff' | 'structured_data' | 'replay_pack';
export type RetentionClass = 'ephemeral' | 'session' | 'long_term' | 'permanent';
export type RedactClass = 'public' | 'internal' | 'sensitive' | 'secret';
export type RuntimeTarget = 'sandbox' | 'browser_worker' | 'node_bridge' | 'plugin_worker' | 'media_worker' | 'host_elevated';
export type PolicyMode =
  | 'deny'
  | 'allow'
  | 'allow_with_approval'
  | 'sandbox_only'
  | 'host_elevated_only'
  | 'readonly_visibility';

/**
 * Tool risk classes, from least to most privileged.
 *
 * A – readonly local file/list/search, low-risk memory lookup, structured status queries
 * B – workspace write/edit/patch, artifact creation
 * C – process execution in sandbox, tests/build/lint, controlled git actions
 * D – browser/network actions (domain allowlist required)
 * E – channel send/reply, webhooks, external side effects
 * F – secrets, host elevation, device-sensitive actions
 */
export type ToolRiskClass = 'A' | 'B' | 'C' | 'D' | 'E' | 'F';

// ---------------------------------------------------------------------------
// Domain entities
// ---------------------------------------------------------------------------

export interface Principal {
  id: string;
  type: PrincipalType;
  /** Map of channel name → channel-specific identifier */
  identities: Record<string, string>;
  trustLevel: TrustLevel;
  policyGroup: string;
  createdAt: string;
}

export interface Agent {
  id: string;
  profile: string;
  defaultModel: string;
  toolProfile: string;
  sandboxProfile: string;
  memoryNamespace: string;
  channelBindings: string[];
  createdAt: string;
}

export interface Session {
  id: string;
  principalId: string;
  agentId: string;
  /** Channel/thread binding, e.g. "webchat:thread-abc" */
  channelThreadBinding?: string;
  mode: SessionMode;
  /** Remaining token/cost budget */
  budget: number;
  /** Whether host-elevation has been granted for this session */
  elevationState: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Task {
  id: string;
  sessionId: string;
  title: string;
  state: TaskState;
  ownerId: string;
  executorId?: string;
  parentTaskId?: string;
  dependencyIds: string[];
  /** Risk class of the sandbox to use */
  sandboxClass: string;
  /** Capabilities (tool names) allowed for this task */
  capabilitySet: string[];
  /** ISO-8601 deadline */
  deadline?: string;
  /** Remaining retry attempts */
  retryCount: number;
  escalationState?: string;
  /**
   * How many delegation hops from the root task.
   * 0 = root task created directly in a session.
   * Increments by 1 for each POST /tasks/:id/delegate call.
   * Capped at MAX_DELEGATION_DEPTH.
   */
  delegationDepth: number;
  /**
   * Optional token/budget cap for this task.
   * When set, the session budget consumed by executions within this task
   * cannot exceed this value (enforced at delegation time).
   */
  budgetCap?: number;
  createdAt: string;
  updatedAt: string;
}

export interface ToolInvocation {
  id: string;
  taskId: string;
  toolName: string;
  params: Record<string, unknown>;
  riskClass: ToolRiskClass;
  runtimeTarget: RuntimeTarget;
  result?: unknown;
  diffSummary?: string;
  startedAt: string;
  finishedAt?: string;
  error?: string;
}

export interface Artifact {
  id: string;
  type: ArtifactType;
  /** URI: file path, URL, or object-store key */
  uri: string;
  /** Task or ToolInvocation that produced this artifact */
  provenanceId: string;
  checksum: string;
  retentionClass: RetentionClass;
  /** Optional human-readable label for the artifact */
  label?: string;
  /** The tool invocation ID that produced this artifact (for direct lookup) */
  invocationId?: string;
  createdAt: string;
}

export interface MemoryItem {
  id: string;
  namespace: string;
  kind: MemoryKind;
  content: string;
  sourceRefs: string[];
  confidence: number;
  redactClass: RedactClass;
  createdAt: string;
}

export interface ApprovalRequest {
  id: string;
  taskId: string;
  toolInvocationId?: string;
  requestedAction: string;
  riskClass: ToolRiskClass;
  proposedScope: Record<string, unknown>;
  approverId?: string;
  outcome: ApprovalOutcome;
  duration: ApprovalDuration;
  /** Human-readable description of the intended effect */
  humanReadableDiff: string;
  createdAt: string;
  resolvedAt?: string;
}

// ---------------------------------------------------------------------------
// Policy and broker contracts
// ---------------------------------------------------------------------------

export interface PolicyContext {
  principal: Principal;
  session: Session;
  toolName: string;
  toolRiskClass: ToolRiskClass;
  runtimeTarget: RuntimeTarget;
  workspacePath?: string;
  networkDomain?: string;
  secretScope?: string;
  approvalState: ApprovalOutcome;
  currentSandbox?: string;
  timeBudgetMs?: number;
  tokenBudget?: number;
}

export interface PolicyDecision {
  mode: PolicyMode;
  reason: string;
  requiresApproval: boolean;
  allowedRuntimeTarget?: RuntimeTarget;
  auditRequired: boolean;
  /** The ID of the rule that matched and produced this decision. */
  matchedRuleId?: string;
  /**
   * Full evaluation trace — only populated by PolicyEngine.explain().
   * Each entry shows one rule that was evaluated, whether it matched, and why.
   */
  evaluationTrace?: PolicyEvaluationStep[];
}

export interface PolicyEvaluationStep {
  ruleId: string;
  ruleDescription: string;
  matched: boolean;
  /** The first matcher that did NOT match, when matched=false. */
  failedMatcher?: string;
}

export interface ToolSchema {
  name: string;
  description: string;
  riskClass: ToolRiskClass;
  defaultRuntimeTarget: RuntimeTarget;
  concurrencySafe: boolean;
  idempotent: boolean;
  rollbackHints?: string;
  auditPayloadShape: Record<string, string>;
  /** JSON Schema for input parameters */
  inputSchema: Record<string, unknown>;
}

export interface ToolRequest {
  id: string;
  sessionId: string;
  taskId: string;
  toolName: string;
  params: Record<string, unknown>;
  principalId: string;
}

export interface ExecutionLease {
  id: string;
  toolInvocationId: string;
  runtimeTarget: RuntimeTarget;
  /** ISO-8601 expiry */
  expiresAt: string;
  sandboxId?: string;
}

export interface ArtifactRef {
  id: string;
  uri: string;
  checksum: string;
}

export interface ApprovalContext {
  request: ApprovalRequest;
  session: Session;
  principal: Principal;
}

export interface RuntimeReceipt {
  invocationId: string;
  runtimeTarget: RuntimeTarget;
  sandboxId?: string;
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  fileDiffs?: string[];
  networkSummary?: string;
  artifacts: ArtifactRef[];
  startedAt: string;
  finishedAt: string;
  /** Tokens consumed by this invocation (optional, reported by the worker). */
  tokensUsed?: number;
}

// ---------------------------------------------------------------------------
// Audit record
// ---------------------------------------------------------------------------

export interface AuditRecord {
  id: string;
  sessionId: string;
  taskId?: string;
  principalId: string;
  eventType: string;
  toolName?: string;
  params?: Record<string, unknown>;
  policyDecision?: PolicyDecision;
  approvalPath?: string;
  runtimeTarget?: RuntimeTarget;
  startedAt: string;
  finishedAt?: string;
  stdout?: string;
  stderr?: string;
  fileDiffs?: string[];
  networkTraceSummary?: string;
  artifacts?: ArtifactRef[];
  sessionDelta?: Record<string, unknown>;
  error?: string;
  /** Tokens consumed by this tool invocation (from RuntimeReceipt). */
  budgetConsumed?: number;
  /** Session budget remaining after this invocation. */
  budgetRemaining?: number;
}

// ---------------------------------------------------------------------------
// Channel adapter contracts
// ---------------------------------------------------------------------------

export interface InboundEnvelope {
  id: string;
  channel: string;
  /** Channel-native sender identifier */
  senderRef: string;
  /** Resolved principal (after identity mapping) */
  principalId?: string;
  sessionId?: string;
  content: string;
  /** Quoted/threaded message content, if applicable */
  quote?: string;
  attachments?: string[];
  receivedAt: string;
}

export interface OutboundEnvelope {
  channel: string;
  /** Channel-native recipient identifier */
  recipientRef: string;
  content: string;
  attachments?: ArtifactRef[];
}

// ---------------------------------------------------------------------------
// Plugin manifest
// ---------------------------------------------------------------------------

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  /** Declared capabilities (tool names the plugin provides) */
  capabilities: string[];
  /** Allowed outbound network domains */
  allowedNetworkDomains: string[];
  /** Names of secrets the plugin may access */
  declaredSecretNeeds: string[];
  /** 'isolated_process' | 'container' | 'in_process_trusted' */
  executionMode: string;
  /** SHA-256 of the plugin package */
  packageHash: string;
  pinnedVersion: string;
  installedAt: string;
  reviewedAt?: string;
}

// ---------------------------------------------------------------------------
// Gateway event types (emitted on the event stream)
// ---------------------------------------------------------------------------

export type GatewayEventType =
  | 'session.updated'
  | 'task.updated'
  | 'approval.requested'
  | 'approval.resolved'
  | 'tool.started'
  | 'tool.finished'
  | 'artifact.created'
  | 'policy.denied'
  | 'agent.spawned';

export interface GatewayEvent {
  type: GatewayEventType;
  payload: Record<string, unknown>;
  emittedAt: string;
}
