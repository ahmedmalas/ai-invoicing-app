import { generateText, stepCountIs, type ModelMessage } from 'ai';

import type { AppDatabase } from '../db/database.js';
import {
  appendMessages,
  createConversation,
  getConversation,
  setPendingConfirmation,
} from './conversation-store.js';
import { getAleyaRegistry } from './registry.js';
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

const DEFAULT_MODEL = process.env.ALEYA_AI_MODEL || 'openai/gpt-5.4';
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
}

function providerConfigured(): boolean {
  return Boolean(
    process.env.AI_GATEWAY_API_KEY ||
      process.env.VERCEL_OIDC_TOKEN ||
      process.env.ALEYA_AI_ALLOW_UNCONFIGURED === '1',
  );
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

/**
 * Deterministic multi-tool executor for tests / offline mode.
 * Parses a simple JSON plan from the user message when prefixed with `ALEYA_PLAN:`.
 */
export async function runDeterministicPlan(
  input: RunAleyaAgentInput,
  plan: Array<{ toolName: string; input: unknown }>,
): Promise<RunAleyaAgentResult> {
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
    if (!result.ok) break;
  }

  const assistantMessage = pending
    ? `Confirmation required before continuing:\n\n${pending.summary}\n\nReply confirm to proceed.`
    : toolCalls
        .map((item) =>
          item.result.ok
            ? `✓ ${item.toolName}: ${item.result.summary}`
            : `✗ ${item.toolName}: ${item.result.message}`,
        )
        .join('\n');

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
    providerConfigured: providerConfigured(),
  };
}

export async function runAleyaAgent(input: RunAleyaAgentInput): Promise<RunAleyaAgentResult> {
  const registry = ensureAleyaToolsRegistered();
  const planMatch = input.message.match(/^ALEYA_PLAN:\s*(\[[\s\S]*\])\s*$/);
  if (planMatch) {
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
      'Aleya AI is installed as a full tool-operating layer, but no AI Gateway credentials are configured yet. Set AI_GATEWAY_API_KEY (or Vercel OIDC) to enable the model. Registered tools remain available via the capability API and deterministic ALEYA_PLAN test harness.';
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

  const result = await generateText({
    model: DEFAULT_MODEL,
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
  if (!assistantMessage) {
    if (pendingNow) {
      assistantMessage = `Confirmation required:\n\n${pendingNow.summary}`;
    } else {
      assistantMessage =
        toolCalls
          .map((item) => {
            const toolResult = item.result;
            return toolResult.ok
              ? `✓ ${item.toolName}: ${toolResult.summary}`
              : `✗ ${item.toolName}: ${toolResult.message}`;
          })
          .join('\n') || 'Done.';
    }
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
    model: DEFAULT_MODEL,
    providerConfigured: true,
  };
}
