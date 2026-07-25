import { generateText, stepCountIs, type ModelMessage } from 'ai';

import type { AppDatabase } from '../db/database.js';
import {
  appendMessages,
  createConversation,
  getConversation,
  setPendingConfirmation,
} from './conversation-store.js';
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
  error?: {
    kind: 'provider' | 'tool' | 'configuration' | 'plan_disabled';
    message: string;
    failedToolName?: string;
  };
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
  const status = getProviderStatus();
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

  const history: ModelMessage[] = conversation.messages
    .filter((item) => item.role === 'user' || item.role === 'assistant')
    .map((item) => ({
      role: item.role as 'user' | 'assistant',
      content: item.content,
    }));
  history.push({ role: 'user', content: input.message });

  const toolCalls: Array<{ toolName: string; result: ToolResult }> = [];
  let ui: UiSyncInstruction = {};
  const decisions: string[] = [];

  try {
    const result = await generateText({
      model: ALEYA_DEFAULT_MODEL,
      system: buildAleyaSystemPrompt({
        toolNames: registry.names(),
        visibleState: ctx.visibleState,
        businessName: profile?.companyName ?? null,
      }),
      messages: history,
      tools: registry.toAiSdkTools(ctx),
      stopWhen: stepCountIs(MAX_STEPS),
      onStepFinish: async ({ toolResults }) => {
        for (const toolResult of toolResults || []) {
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

    let assistantMessage = result.text?.trim() || '';
    const pendingNow = pendingRef.current;
    const progress = summariseToolProgress(toolCalls);
    const failed = toolCalls.find((item) => item.result && !item.result.ok && !item.result.needsConfirmation);

    if (!assistantMessage) {
      if (pendingNow) {
        assistantMessage = `Confirmation required:\n\n${pendingNow.summary}`;
      } else if (failed) {
        assistantMessage =
          `A tool step failed.\n\n${progress}\n\nCompleted valid work above was preserved. You can retry safely — Aleya will not claim success for the failed step.`;
      } else {
        assistantMessage = progress || 'Done.';
      }
    } else if (progress && !assistantMessage.includes('✓') && toolCalls.length) {
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

    return {
      conversationId: conversation.id,
      assistantMessage,
      toolCalls,
      pendingConfirmation: pendingNow,
      ui,
      decisions,
      model: ALEYA_DEFAULT_MODEL,
      providerConfigured: true,
      authMethod: status.authMethod,
      provider: status.provider,
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

    return {
      conversationId: conversation.id,
      assistantMessage,
      toolCalls,
      pendingConfirmation: null,
      ui,
      decisions,
      model: ALEYA_DEFAULT_MODEL,
      providerConfigured: true,
      authMethod: status.authMethod,
      provider: status.provider,
      error: {
        kind: 'provider',
        message: providerMessage,
      },
    };
  }
}

// Re-export for callers/tests that previously imported from this module.
export { providerConfigured, getProviderStatus };
