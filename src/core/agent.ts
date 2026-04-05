/**
 * Agent runtime for OpenClaw Secure.
 *
 * The cognition layer:
 *   - prompt assembly
 *   - conversation state projection
 *   - task context assembly
 *   - model invocation (provider-abstracted)
 *   - tool request generation
 *   - result integration
 *   - summary generation
 *
 * The agent sees ONLY policy-filtered tool schemas.
 * Child agents inherit NARROWED capabilities only.
 * No hidden broad execution surface.
 */

import { v4 as uuidv4 } from 'uuid';
import {
  Session,
  Task,
  Principal,
  ToolSchema,
  ToolRequest,
  PolicyContext,
  ApprovalOutcome,
  GatewayEvent,
  GatewayEventType,
} from './types';
import { ToolBroker } from './broker';
import { PolicyEngine } from './policy';

// ---------------------------------------------------------------------------
// Model provider abstraction
// ---------------------------------------------------------------------------

export interface ModelMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCallId?: string;
  toolName?: string;
}

export interface ModelToolCall {
  id: string;
  name: string;
  params: Record<string, unknown>;
}

export interface ModelResponse {
  content: string;
  toolCalls?: ModelToolCall[];
  usage?: { promptTokens: number; completionTokens: number };
}

export interface ModelProvider {
  name: string;
  invoke(
    messages: ModelMessage[],
    tools: ToolSchema[],
    options?: { maxTokens?: number }
  ): Promise<ModelResponse>;
}

// ---------------------------------------------------------------------------
// Event emitter interface
// ---------------------------------------------------------------------------

export type EventEmitter = (event: GatewayEvent) => void;

// ---------------------------------------------------------------------------
// Agent runtime
// ---------------------------------------------------------------------------

export interface AgentRuntimeOptions {
  principal: Principal;
  session: Session;
  task: Task;
  modelProvider: ModelProvider;
  broker: ToolBroker;
  policyEngine: PolicyEngine;
  onEvent?: EventEmitter;
  /**
   * Called whenever the session budget is reduced. Callers that hold a
   * SessionStore should persist the new value via updateSession().
   */
  onBudgetUpdate?: (remaining: number) => void;
  /** Maximum number of tool-call rounds before stopping */
  maxRounds?: number;
}

export interface AgentTurn {
  userMessage: string;
  assistantMessage: string;
  toolInvocations: Array<{
    toolName: string;
    params: Record<string, unknown>;
    result: unknown;
    denied: boolean;
  }>;
  usage?: { promptTokens: number; completionTokens: number };
  /** Remaining session token budget after this turn. Callers should persist this. */
  remainingBudget: number;
}

/**
 * AgentRuntime drives a single agent turn: assemble context, call the model,
 * dispatch tool calls through the broker, and integrate results.
 */
export class AgentRuntime {
  private options: AgentRuntimeOptions;
  private conversationHistory: ModelMessage[] = [];

  constructor(options: AgentRuntimeOptions) {
    this.options = options;
  }

  /**
   * Process a user message and return the agent's response.
   * Tool calls are automatically dispatched through the broker.
   */
  async process(userMessage: string): Promise<AgentTurn> {
    const { principal, session, task, modelProvider, broker, policyEngine } = this.options;
    const maxRounds = this.options.maxRounds ?? 10;

    // Build policy context (without tool-specific fields yet)
    const basePolicyCtx: Omit<PolicyContext, 'toolName' | 'toolRiskClass' | 'runtimeTarget'> = {
      principal,
      session,
      approvalState: 'pending' as ApprovalOutcome,
    };

    // Filter visible tools via policy
    const visibleTools = broker.visibleTools(basePolicyCtx);

    // Build system prompt
    const systemPrompt = this.buildSystemPrompt(visibleTools);

    // Prepare messages for this turn
    const messages: ModelMessage[] = [
      { role: 'system', content: systemPrompt },
      ...this.conversationHistory,
      { role: 'user', content: userMessage },
    ];

    const turn: AgentTurn = {
      userMessage,
      assistantMessage: '',
      toolInvocations: [],
      remainingBudget: session.budget,
    };

    // Agentic loop: model → tool calls → model
    let rounds = 0;
    let currentMessages = [...messages];

    while (rounds < maxRounds) {
      rounds++;
      const response = await modelProvider.invoke(currentMessages, visibleTools, {
        maxTokens: Math.min(session.budget, 4096),
      });

      if (response.usage) {
        turn.usage = response.usage;
        // Deduct from budget (simplified)
        session.budget = Math.max(0, session.budget - response.usage.completionTokens);
        turn.remainingBudget = session.budget;
        // Notify caller so it can persist the updated budget to the session store
        this.options.onBudgetUpdate?.(session.budget);
      }

      if (!response.toolCalls || response.toolCalls.length === 0) {
        // No tool calls — this is the final response
        turn.assistantMessage = response.content;
        this.conversationHistory.push(
          { role: 'user', content: userMessage },
          { role: 'assistant', content: response.content }
        );
        break;
      }

      // Dispatch tool calls
      const toolResultMessages: ModelMessage[] = [];
      for (const toolCall of response.toolCalls) {
        const request: ToolRequest = {
          id: uuidv4(),
          sessionId: session.id,
          taskId: task.id,
          toolName: toolCall.name,
          params: toolCall.params,
          principalId: principal.id,
        };

        const policyCtx: PolicyContext = {
          ...basePolicyCtx,
          toolName: toolCall.name,
          toolRiskClass: broker.getToolSchema(toolCall.name)?.riskClass ?? 'A',
          runtimeTarget: broker.getToolSchema(toolCall.name)?.defaultRuntimeTarget ?? 'sandbox',
        };

        const brokerResult = await broker.dispatch(request, policyCtx, {
          capabilitySet: task.capabilitySet,
          sandboxClass: task.sandboxClass,
        });

        this.emit({
          type: brokerResult.denied ? 'policy.denied' : 'tool.finished',
          payload: {
            toolName: toolCall.name,
            denied: brokerResult.denied,
            invocationId: brokerResult.invocation.id,
          },
          emittedAt: new Date().toISOString(),
        });

        turn.toolInvocations.push({
          toolName: toolCall.name,
          params: toolCall.params,
          result: brokerResult.receipt ?? brokerResult.invocation.error,
          denied: brokerResult.denied,
        });

        const resultContent = brokerResult.denied
          ? JSON.stringify({ error: 'denied', reason: brokerResult.policyDecision.reason })
          : JSON.stringify(brokerResult.receipt ?? { status: 'executed' });

        toolResultMessages.push({
          role: 'tool',
          content: resultContent,
          toolCallId: toolCall.id,
          toolName: toolCall.name,
        });
      }

      // Add model response and tool results to message history for next round
      currentMessages = [
        ...currentMessages,
        { role: 'assistant', content: response.content },
        ...toolResultMessages,
      ];
    }

    turn.remainingBudget = session.budget;
    return turn;
  }

  private buildSystemPrompt(visibleTools: ToolSchema[]): string {
    const toolList = visibleTools
      .map((t) => `  - ${t.name} (class ${t.riskClass}): ${t.description}`)
      .join('\n');

    return [
      'You are a helpful assistant operating under strict policy constraints.',
      'You may only use the tools listed below.',
      'You must not attempt to use tools not listed here.',
      'Every tool call is audited and policy-checked before execution.',
      '',
      'Available tools:',
      toolList || '  (none)',
      '',
      'Always be explicit about what actions you are taking and why.',
    ].join('\n');
  }

  private emit(event: GatewayEvent): void {
    if (this.options.onEvent) {
      this.options.onEvent(event);
    }
  }
}

// ---------------------------------------------------------------------------
// Stub model provider (for testing)
// ---------------------------------------------------------------------------

/**
 * StubModelProvider returns a deterministic response without calling any real model.
 * Useful for unit tests.
 */
export class StubModelProvider implements ModelProvider {
  readonly name = 'stub';
  private responses: ModelResponse[];
  private index = 0;

  constructor(responses: ModelResponse[] = []) {
    this.responses = responses.length > 0 ? responses : [
      { content: 'Hello! How can I help you today?' },
    ];
  }

  async invoke(
    _messages: ModelMessage[],
    _tools: ToolSchema[],
    _options?: { maxTokens?: number }
  ): Promise<ModelResponse> {
    const response = this.responses[this.index % this.responses.length];
    this.index++;
    return response;
  }
}
