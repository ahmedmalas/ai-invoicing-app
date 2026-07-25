import { generateText, stepCountIs, type ModelMessage } from 'ai';

import type { AppDatabase } from '../db/database.js';
import {
  appendMessages,
  createConversation,
  getConversation,
  setPendingConfirmation,
} from './conversation-store.js';
import { LatencyTrace } from './latency.js';
import {
  answerForStatusIntent,
  matchStatusIntent,
} from './product-capabilities.js';
import {
  ALEYA_DEFAULT_MODEL,
  deterministicPlanAllowed,
  formatProviderError,
  getProviderStatus,
  providerConfigured,
} from './provider.js';
import { buildAleyaSystemPrompt } from './system-prompt.js';
import { approveConfirmationToken, createToolContext } from './tool-context.js';
import { ensureAleyaToolsRegistered } from './tools/register-all.js';
import type {
  AgentVisibleState,
  ChatMessage,
  PendingConfirmation,
  ToolResult,
  UiSyncInstruction,
} from './types.js';

/** High ceiling — Aleya must chain many tools for compound workflows. */
const MAX_STEPS = Number(process.env.ALEYA_AI_MAX_STEPS || 48);
const MAX_HISTORY_MESSAGES = Number(process.env.ALEYA_AI_MAX_HISTORY_MESSAGES || 12);
const FAST_MODEL = process.env.ALEYA_AI_FAST_MODEL || process.env.ALEYA_AI_MODEL || ALEYA_DEFAULT_MODEL;

export interface RunAleyaAgentInput {
  db: AppDatabase;
  userId: string;
  organizationId: string;
  conversationId?: string | null;
  message: string;
  visibleState?: AgentVisibleState;
  /** Confirm a previously requested high-impact action and continue. */
  confirmationToken?: string | null;
  confirm?: boolean;
  /** When true, include developer-only latencyTrace on the result. */
  includeLatencyTrace?: boolean;
}

export interface RunAleyaAgentResult {
  conversationId: string;
  assistantMessage: string;
  toolCalls: Array<{ toolName: string; result: ToolResult }>;
  pendingConfirmation: PendingConfirmation | null;
  ui: UiSyncInstruction;
  decisions: string[];
  model: string | null;
  providerConfigured: boolean;
  authMethod: 'api-key' | 'oidc' | 'none';
  provider: 'vercel-ai-gateway';
  path?: 'status_fast_path' | 'model' | 'configuration' | 'plan_disabled' | 'deterministic_plan';
  latencyTrace?: {
    totalMs: number;
    events: Array<{ mark: string; atMs: number; detail?: Record<string, unknown> }>;
  };
  error?: {
    kind: 'provider' | 'tool' | 'configuration' | 'plan_disabled';
    message: string;
    failedToolName?: string;
  };
}

function truncateHistory(messages: ModelMessage[]): ModelMessage[] {
  if (messages.length <= MAX_HISTORY_MESSAGES) return messages;
  return messages.slice(-MAX_HISTORY_MESSAGES);
}

function looksLikeSimpleRead(message: string): boolean {
  const text = message.trim().toLowerCase();
  if (text.length > 180) return false;
  if (/\b(create|update|finalise|finalize|delete|duplicate|send|record payment|bulk)\b/.test(text)) {
    return false;
  }
  return /^(what|which|who|when|where|why|how|is|are|do|does|can|list|show|explain)\b/.test(text);
}

function mergeUi(target: UiSyncInstruction, next?: UiSyncInstruction): UiSyncInstruction {
  if (!next) return target;
  const refresh = [...new Set([...(target.refresh || []), ...(next.refresh || [])])] as NonNullable<
    UiSyncInstruction['refresh']
  >;
  const merged: UiSyncInstruction = {};
  if (refresh.length) merged.refresh = refresh;
  const openRoute = next.openRoute ?? target.openRoute;
  const focusInvoiceId = next.focusInvoiceId ?? target.focusInvoiceId;
  const focusCustomerId = next.focusCustomerId ?? target.focusCustomerId;
  if (openRoute !== undefined) merged.openRoute = openRoute;
  if (focusInvoiceId !== undefined) merged.focusInvoiceId = focusInvoiceId;
  if (focusCustomerId !== undefined) merged.focusCustomerId = focusCustomerId;
  return merged;
}

function summariseToolProgress(
  toolCalls: Array<{ toolName: string; result: ToolResult }>,
): string {
  if (!toolCalls.length) return '';
  return toolCalls
    .map((item) => {
      const toolResult = item.result;
      if (toolResult.ok) {
        return `✓ ${item.toolName}: ${toolResult.summary}`;
      }
      return `✗ ${item.toolName}: ${toolResult.message}`;
    })
    .join('\n');
}

/**
 * Deterministic multi-tool executor for tests / offline harness only.
 * Enabled only when ALEYA_AI_ALLOW_DETERMINISTIC_PLAN=1 or NODE_ENV=test.
 */
export async function runDeterministicPlan(
  input: RunAleyaAgentInput,
  plan: Array<{ toolName: string; input: unknown }>,
): Promise<RunAleyaAgentResult> {
  const status = getProviderStatus();
  const registry = ensureAleyaToolsRegistered();
  let conversation = input.conversationId
    ? await getConversation(input.db, input.userId, input.conversationId)
    : null;
  if (!conversation) {
    conversation = await createConversation(
      input.db,
      input.userId,
      'Aleya AI session',
      input.visibleState || {},
    );
  }

  let pending: PendingConfirmation | null = null;
  const approved = new Set<string>();
  if (input.confirmationToken) {
    approveConfirmationToken(conversation.pendingConfirmation, input.confirmationToken, approved);
  }
  if (input.confirm && conversation.pendingConfirmation) {
    approveConfirmationToken(
      conversation.pendingConfirmation,
      conversation.pendingConfirmation.token,
      approved,
    );
  }

  const toolCalls: Array<{ toolName: string; result: ToolResult }> = [];
  let ui: UiSyncInstruction = {};
  const decisions: string[] = [];

  const ctx = createToolContext({
    db: input.db,
    userId: input.userId,
    organizationId: input.organizationId,
    conversationId: conversation.id,
    visibleState: { ...conversation.visibleState, ...input.visibleState },
    approvedTokens: approved,
    onConfirmation: (value) => {
      pending = value;
    },
  });

  let failedToolName: string | undefined;
  for (const step of plan) {
    const result = await registry.execute(step.toolName, step.input, ctx);
    toolCalls.push({ toolName: step.toolName, result });
    if (result.ok) {
      ui = mergeUi(ui, result.ui);
      if (result.decisions?.length) decisions.push(...result.decisions);
    }
    if (!result.ok && result.needsConfirmation) {
      pending = {
        token: result.confirmationToken!,
        toolName: step.toolName,
        input: step.input,
        summary: result.confirmationSummary || result.message,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
      };
      break;
    }
    if (!result.ok) {
      failedToolName = step.toolName;
      break;
    }
  }

  const progress = summariseToolProgress(toolCalls);
  const assistantMessage = pending
    ? `Confirmation required before continuing:\n\n${pending.summary}\n\nReply confirm to proceed.`
    : failedToolName
      ? `Stopped after a tool failure.\n\n${progress}\n\nCompleted valid work above was preserved. You can retry the failed step safely.`
      : progress || 'Done.';

  await appendMessages(
    input.db,
    input.userId,
    conversation.id,
    [
      { role: 'user', content: input.message },
      { role: 'assistant', content: assistantMessage },
    ],
    {
      pendingConfirmation: pending,
      ...(input.visibleState ? { visibleState: input.visibleState } : {}),
    },
  );
  await setPendingConfirmation(input.db, input.userId, conversation.id, pending);

  return {
    conversationId: conversation.id,
    assistantMessage,
    toolCalls,
    pendingConfirmation: pending,
    ui,
    decisions,
    model: null,
    providerConfigured: status.providerConfigured,
    authMethod: status.authMethod,
    provider: status.provider,
    ...(failedToolName
      ? {
          error: {
            kind: 'tool' as const,
            message: (() => {
              const failed = toolCalls.find((item) => item.toolName === failedToolName)?.result;
              return failed && !failed.ok ? failed.message : 'Tool failed';
            })(),
            failedToolName,
          },
        }
      : {}),
  };
}

export async function runAleyaAgent(input: RunAleyaAgentInput): Promise<RunAleyaAgentResult> {
  const trace = new LatencyTrace();
  trace.mark('request_received');
  const status = getProviderStatus();
  trace.mark('auth_completed', { authMethod: status.authMethod });
  const registry = ensureAleyaToolsRegistered();
  const planMatch = input.message.match(/^ALEYA_PLAN:\s*(\[[\s\S]*\])\s*$/);
  if (planMatch) {
    if (!deterministicPlanAllowed()) {
      let conversation = input.conversationId
        ? await getConversation(input.db, input.userId, input.conversationId)
        : null;
      if (!conversation) {
        conversation = await createConversation(
          input.db,
          input.userId,
          'Aleya AI session',
          input.visibleState || {},
        );
      }
      const assistantMessage =
        'Deterministic ALEYA_PLAN payloads are disabled in this environment. Natural-language requests require a configured AI Gateway model connection. This is not a simulated success.';
      await appendMessages(input.db, input.userId, conversation.id, [
        { role: 'user', content: input.message },
        { role: 'assistant', content: assistantMessage },
      ]);
      return {
        conversationId: conversation.id,
        assistantMessage,
        toolCalls: [],
        pendingConfirmation: null,
        ui: {},
        decisions: [],
        model: null,
        providerConfigured: status.providerConfigured,
        authMethod: status.authMethod,
        provider: status.provider,
        path: 'plan_disabled',
        ...(input.includeLatencyTrace ? { latencyTrace: trace.toJSON() } : {}),
        error: {
          kind: 'plan_disabled',
          message: assistantMessage,
        },
      };
    }
    const plan = JSON.parse(planMatch[1]!) as Array<{ toolName: string; input: unknown }>;
    return runDeterministicPlan(input, plan);
  }

  let conversation = input.conversationId
    ? await getConversation(input.db, input.userId, input.conversationId)
    : null;
  if (!conversation) {
    conversation = await createConversation(
      input.db,
      input.userId,
      input.message.slice(0, 80) || 'Aleya AI session',
      input.visibleState || {},
    );
  }
  trace.mark('context_loaded', {
    conversationId: conversation.id,
    historyMessages: conversation.messages.length,
  });

  // Known product-status intents: answer from the capability map without a model loop
  // and without fetching unrelated private profile fields.
  const statusIntent = matchStatusIntent(input.message);
  if (statusIntent && !input.confirm && !input.confirmationToken) {
    trace.mark('status_intent_matched', { intent: statusIntent });
    const answered = answerForStatusIntent(statusIntent);
    const toolResult: ToolResult = {
      ok: true,
      data: answered.data,
      summary: answered.assistantMessage,
    };
    await appendMessages(input.db, input.userId, conversation.id, [
      { role: 'user', content: input.message },
      { role: 'assistant', content: answered.assistantMessage },
    ]);
    trace.mark('persistence_completed');
    trace.mark('final_response_ready');
    return {
      conversationId: conversation.id,
      assistantMessage: answered.assistantMessage,
      toolCalls: [{ toolName: answered.toolName, result: toolResult }],
      pendingConfirmation: null,
      ui: {},
      decisions: [
        `Answered via product capability map (${statusIntent}); no unrelated tools called.`,
      ],
      model: null,
      providerConfigured: status.providerConfigured,
      authMethod: status.authMethod,
      provider: status.provider,
      path: 'status_fast_path',
      ...(input.includeLatencyTrace ? { latencyTrace: trace.toJSON() } : {}),
    };
  }

  if (!providerConfigured()) {
    const assistantMessage =
      'Action registry and tool execution infrastructure are deployed; production natural-language model connection is not yet configured. Set AI_GATEWAY_API_KEY or deploy on Vercel with AI Gateway OIDC enabled. Aleya will not simulate a successful response.';
    await appendMessages(input.db, input.userId, conversation.id, [
      { role: 'user', content: input.message },
      { role: 'assistant', content: assistantMessage },
    ]);
    return {
      conversationId: conversation.id,
      assistantMessage,
      toolCalls: [],
      pendingConfirmation: null,
      ui: {},
      decisions: [],
      model: null,
      providerConfigured: false,
      authMethod: 'none',
      provider: 'vercel-ai-gateway',
      path: 'configuration',
      ...(input.includeLatencyTrace ? { latencyTrace: trace.toJSON() } : {}),
      error: {
        kind: 'configuration',
        message: assistantMessage,
      },
    };
  }

  const pendingRef: { current: PendingConfirmation | null } = { current: null };
  const approved = new Set<string>();
  if (input.confirmationToken) {
    approveConfirmationToken(conversation.pendingConfirmation, input.confirmationToken, approved);
  }
  if (input.confirm && conversation.pendingConfirmation) {
    approveConfirmationToken(
      conversation.pendingConfirmation,
      conversation.pendingConfirmation.token,
      approved,
    );
  }

  // Only load business name for the system prompt — never dump profile fields into the answer.
  const profile = await input.db.getBusinessProfile();
  const ctx = createToolContext({
    db: input.db,
    userId: input.userId,
    organizationId: input.organizationId,
    conversationId: conversation.id,
    visibleState: { ...conversation.visibleState, ...input.visibleState },
    approvedTokens: approved,
    onConfirmation: (value) => {
      pendingRef.current = value;
    },
  });

  const history: ModelMessage[] = truncateHistory(
    conversation.messages
      .filter((item) => item.role === 'user' || item.role === 'assistant')
      .map((item) => ({
        role: item.role as 'user' | 'assistant',
        content: item.content.length > 2000 ? `${item.content.slice(0, 2000)}…` : item.content,
      })),
  );
  history.push({ role: 'user', content: input.message });

  const toolCalls: Array<{ toolName: string; result: ToolResult }> = [];
  let ui: UiSyncInstruction = {};
  const decisions: string[] = [];
  const simpleRead = looksLikeSimpleRead(input.message);
  const modelId = simpleRead ? FAST_MODEL : ALEYA_DEFAULT_MODEL;
  const maxSteps = simpleRead ? Math.min(MAX_STEPS, 8) : MAX_STEPS;

  try {
    trace.mark('model_request_started', { model: modelId, maxSteps, simpleRead });
    const result = await generateText({
      model: modelId,
      system: buildAleyaSystemPrompt({
        toolNames: registry.names(),
        visibleState: ctx.visibleState,
        businessName: profile?.companyName ?? null,
        toolRoutingHints: [
          'bank feed / sync / bank transactions → get_bank_feed_status only',
          'what can you control → list_product_capabilities',
          'does feature X exist → get_feature_status',
          'unpaid invoices → list_unpaid_invoices',
          'business contact/ABN/address → get_business_profile (only then)',
        ],
      }),
      messages: history,
      tools: registry.toAiSdkTools(ctx),
      stopWhen: stepCountIs(maxSteps),
      onStepFinish: async ({ toolResults }) => {
        for (const toolResult of toolResults || []) {
          trace.mark('tool_finished', { toolName: toolResult.toolName });
          const output = toolResult.output as ToolResult;
          toolCalls.push({ toolName: toolResult.toolName, result: output });
          if (output?.ok) {
            ui = mergeUi(ui, output.ui);
            if (output.decisions?.length) decisions.push(...output.decisions);
          }
          if (output && !output.ok && output.needsConfirmation) {
            pendingRef.current = {
              token: output.confirmationToken!,
              toolName: toolResult.toolName,
              input: toolResult.input,
              summary: output.confirmationSummary || output.message,
              createdAt: new Date().toISOString(),
              expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
            };
          }
        }
      },
    });
    trace.mark('model_finished', { toolCallCount: toolCalls.length });

    let assistantMessage = result.text?.trim() || '';
    const pendingNow = pendingRef.current;
    const progress = summariseToolProgress(toolCalls);
    const failed = toolCalls.find(
      (item) => item.result && !item.result.ok && !item.result.needsConfirmation,
    );

    if (!assistantMessage) {
      if (pendingNow) {
        assistantMessage = `Confirmation required:\n\n${pendingNow.summary}`;
      } else if (failed) {
        assistantMessage =
          `A tool step failed.\n\n${progress}\n\nCompleted valid work above was preserved. You can retry safely — Aleya will not claim success for the failed step.`;
      } else {
        assistantMessage = progress || 'Done.';
      }
    } else if (
      progress &&
      !assistantMessage.includes('✓') &&
      toolCalls.length > 0 &&
      toolCalls.length <= 6
    ) {
      assistantMessage = `${assistantMessage}\n\nSteps completed:\n${progress}`;
    }

    const messages: ChatMessage[] = [
      { role: 'user', content: input.message },
      { role: 'assistant', content: assistantMessage },
    ];
    await appendMessages(input.db, input.userId, conversation.id, messages, {
      pendingConfirmation: pendingNow,
      ...(input.visibleState ? { visibleState: input.visibleState } : {}),
    });
    await setPendingConfirmation(input.db, input.userId, conversation.id, pendingNow);
    trace.mark('persistence_completed');
    trace.mark('final_response_ready');

    return {
      conversationId: conversation.id,
      assistantMessage,
      toolCalls,
      pendingConfirmation: pendingNow,
      ui,
      decisions,
      model: modelId,
      providerConfigured: true,
      authMethod: status.authMethod,
      provider: status.provider,
      path: 'model',
      ...(input.includeLatencyTrace ? { latencyTrace: trace.toJSON() } : {}),
      ...(failed && !failed.result.ok
        ? {
            error: {
              kind: 'tool' as const,
              message: failed.result.message,
              failedToolName: failed.toolName,
            },
          }
        : {}),
    };
  } catch (error) {
    const providerMessage = formatProviderError(error);
    const progress = summariseToolProgress(toolCalls);
    const assistantMessage = progress
      ? `${providerMessage}\n\nWork completed before the failure:\n${progress}\n\nAleya did not invent a success state. You can retry; completed valid work was preserved.`
      : `${providerMessage}\n\nAleya did not invent a success state. No simulated response was returned. You can retry after the provider issue is resolved.`;

    await appendMessages(input.db, input.userId, conversation.id, [
      { role: 'user', content: input.message },
      { role: 'assistant', content: assistantMessage },
    ]);
    trace.mark('final_response_ready', { error: true });

    return {
      conversationId: conversation.id,
      assistantMessage,
      toolCalls,
      pendingConfirmation: null,
      ui,
      decisions,
      model: modelId,
      providerConfigured: true,
      authMethod: status.authMethod,
      provider: status.provider,
      path: 'model',
      ...(input.includeLatencyTrace ? { latencyTrace: trace.toJSON() } : {}),
      error: {
        kind: 'provider',
        message: providerMessage,
      },
    };
  }
}

// Re-export for callers/tests that previously imported from this module.
export { providerConfigured, getProviderStatus };
