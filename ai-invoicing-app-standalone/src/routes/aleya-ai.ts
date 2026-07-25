import { z } from 'zod';
import type { FastifyPluginAsync } from 'fastify';

import { runAleyaAgent } from '../ai/agent-runner.js';
import {
  createConversation,
  getConversation,
  listConversations,
} from '../ai/conversation-store.js';
import { latencyTraceEnabled } from '../ai/latency.js';
import { PRODUCT_CAPABILITIES } from '../ai/product-capabilities.js';
import { getProviderStatus } from '../ai/provider.js';
import { getAleyaRegistry } from '../ai/registry.js';
import { ensureAleyaToolsRegistered } from '../ai/tools/register-all.js';
import { getWorkspaceContext } from '../auth/workspace-context.js';

const visibleStateSchema = z
  .object({
    activeInvoiceId: z.string().uuid().nullable().optional(),
    activeCustomerId: z.string().uuid().nullable().optional(),
    activeTemplateId: z.string().uuid().nullable().optional(),
    currentPath: z.string().nullable().optional(),
    selectedInvoiceIds: z.array(z.string().uuid()).optional(),
  })
  .optional();

const chatSchema = z.object({
  message: z.string().min(1),
  conversationId: z.string().uuid().nullable().optional(),
  visibleState: visibleStateSchema,
  confirmationToken: z.string().optional(),
  confirm: z.boolean().optional(),
});

function actorIds(_request: unknown): {
  userId: string;
  organizationId: string;
} {
  const workspace = getWorkspaceContext();
  const userId = workspace?.authUserId || workspace?.workspaceId || 'anonymous';
  const organizationId = workspace?.workspaceId || process.env.ORGANIZATION_ID || 'single-tenant';
  return { userId, organizationId };
}

/** Expose only safe identifiers / totals — never raw tool inputs or secrets. */
function pickPublicToolData(toolName: string, data: unknown): Record<string, unknown> | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const row = data as Record<string, unknown>;
  const allow = [
    'invoiceId',
    'id',
    'invoiceNumber',
    'draftNumber',
    'status',
    'customerId',
    'customerName',
    'templateId',
    'templateName',
    'subtotal',
    'taxTotal',
    'gstTotal',
    'total',
    'dueDate',
    'issueDate',
    'count',
    'matched',
    'scanned',
    'bindingsKnown',
    'templateNeedle',
    'ignoredStatusFilterForTemplateSearch',
    'invoices',
    'implemented',
    'connected',
    'status',
    'provider',
    'institution',
    'maskedAccount',
    'lastSuccessfulSyncAt',
    'warning',
    'nextAction',
    'distinction',
    'capabilities',
    'appExists',
    'aiAccess',
    'limitation',
    'priority',
    'found',
    'message',
    'feature',
  ] as const;
  const picked: Record<string, unknown> = { tool: toolName };
  for (const key of allow) {
    if (row[key] !== undefined) picked[key] = row[key];
  }
  return Object.keys(picked).length > 1 ? picked : { tool: toolName };
}

export const aleyaAiRoutes: FastifyPluginAsync = async (app) => {
  ensureAleyaToolsRegistered();

  app.get('/aleya-ai/capabilities', async (request) => {
    const registry = ensureAleyaToolsRegistered();
    const provider = getProviderStatus();
    const query = (request.query || {}) as { detail?: string };
    const detail = query.detail === 'full';
    const rows = registry.capabilityRows();
    return {
      productGoal:
        'Natural-language assistant for Aleya Invoicing via registered tools. Expanding coverage — not yet a complete operating layer over every screen.',
      coverageNote:
        'Use list_product_capabilities / get_feature_status for accurate feature existence vs AI access. Bank feeds are not implemented.',
      toolCount: registry.names().length,
      maxSteps: Number(process.env.ALEYA_AI_MAX_STEPS || 48),
      model: provider.model,
      provider: provider.provider,
      authMethod: provider.authMethod,
      providerConfigured: provider.providerConfigured,
      deterministicPlanAllowed: provider.deterministicPlanAllowed,
      // Concise catalog by default — full schemas stay server-side on the registry.
      tools: detail
        ? rows
        : rows.map((row) => ({
            tool: row.tool,
            category: row.category,
            confirmation: row.confirmation,
            undo: row.undo,
            domain: row.domain,
            mutates: row.mutates,
          })),
      productCapabilities: PRODUCT_CAPABILITIES.map((item) => ({
        id: item.id,
        label: item.label,
        appExists: item.appExists,
        aiAccess: item.aiAccess,
        priority: item.priority,
      })),
      artificialLimitsForbidden: [
        'one tool call per message',
        'one invoice action per command',
        'predefined sentence patterns only',
        'example commands only',
        'currently open invoice only',
        'text generation only',
        'simulated actions only',
        'small hardcoded intent list',
        'silent ALEYA_PLAN / fake success fallback',
        'calling unrelated tools after a capability gap',
      ],
    };
  });

  app.get('/aleya-ai/conversations', async (request) => {
    const { userId } = actorIds(request as never);
    const conversations = await listConversations(app.db, userId);
    return {
      conversations: conversations.map((item) => ({
        id: item.id,
        title: item.title,
        updatedAt: item.updatedAt,
        messageCount: item.messages.length,
        pendingConfirmation: Boolean(item.pendingConfirmation),
      })),
    };
  });

  app.post('/aleya-ai/conversations', async (request, reply) => {
    const { userId } = actorIds(request as never);
    const body = z
      .object({
        title: z.string().optional(),
        visibleState: visibleStateSchema,
      })
      .parse(request.body || {});
    const conversation = await createConversation(
      app.db,
      userId,
      body.title || 'Aleya AI session',
      (body.visibleState || {}) as import('../ai/types.js').AgentVisibleState,
    );
    return reply.code(201).send({ conversation });
  });

  app.get('/aleya-ai/conversations/:conversationId', async (request, reply) => {
    const { userId } = actorIds(request as never);
    const params = z.object({ conversationId: z.string().uuid() }).parse(request.params);
    const conversation = await getConversation(app.db, userId, params.conversationId);
    if (!conversation) return reply.code(404).send({ message: 'Conversation not found' });
    return { conversation };
  });

  app.post('/aleya-ai/chat', async (request, reply) => {
    const body = chatSchema.parse(request.body);
    const { userId, organizationId } = actorIds(request as never);
    const includeLatencyTrace = latencyTraceEnabled(
      request.headers as Record<string, unknown>,
    );
    const result = await runAleyaAgent({
      db: app.db,
      userId,
      organizationId,
      conversationId: body.conversationId ?? null,
      message: body.message,
      visibleState: (body.visibleState || {}) as import('../ai/types.js').AgentVisibleState,
      includeLatencyTrace,
      ...(body.confirmationToken ? { confirmationToken: body.confirmationToken } : {}),
      ...(body.confirm != null ? { confirm: body.confirm } : {}),
    });
    // Browser-safe payload: summaries only — never system prompt, credentials, or raw tool inputs.
    return reply.send({
      conversationId: result.conversationId,
      assistantMessage: result.assistantMessage,
      pendingConfirmation: result.pendingConfirmation
        ? {
            token: result.pendingConfirmation.token,
            toolName: result.pendingConfirmation.toolName,
            summary: result.pendingConfirmation.summary,
            createdAt: result.pendingConfirmation.createdAt,
            expiresAt: result.pendingConfirmation.expiresAt,
          }
        : null,
      ui: result.ui,
      decisions: result.decisions,
      model: result.model,
      providerConfigured: result.providerConfigured,
      authMethod: result.authMethod,
      provider: result.provider,
      path: result.path,
      toolCalls: result.toolCalls.map((item) => ({
        toolName: item.toolName,
        result: {
          ok: item.result.ok,
          summary: item.result.ok ? item.result.summary : undefined,
          message: item.result.ok ? undefined : item.result.message,
          needsConfirmation: item.result.ok ? undefined : item.result.needsConfirmation,
          code: item.result.ok ? undefined : item.result.code,
          data: item.result.ok
            ? pickPublicToolData(item.toolName, item.result.data)
            : undefined,
        },
      })),
      ...(result.error ? { error: result.error } : {}),
      // Developer-only timing — omitted unless explicitly requested.
      ...(includeLatencyTrace && result.latencyTrace
        ? { latencyTrace: result.latencyTrace }
        : {}),
    });
  });

  app.get('/aleya-ai/health', async () => {
    const provider = getProviderStatus();
    return {
      ok: true,
      registrySize: getAleyaRegistry().names().length || ensureAleyaToolsRegistered().names().length,
      providerConfigured: provider.providerConfigured,
      authMethod: provider.authMethod,
      model: provider.model,
      provider: provider.provider,
    };
  });
};
