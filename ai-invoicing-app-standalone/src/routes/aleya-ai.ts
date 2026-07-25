import { z } from 'zod';
import type { FastifyPluginAsync } from 'fastify';

import { runAleyaAgent } from '../ai/agent-runner.js';
import {
  createConversation,
  getConversation,
  listConversations,
} from '../ai/conversation-store.js';
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

export const aleyaAiRoutes: FastifyPluginAsync = async (app) => {
  ensureAleyaToolsRegistered();

  app.get('/aleya-ai/capabilities', async () => {
    const registry = ensureAleyaToolsRegistered();
    return {
      productGoal: 'A full natural-language operating layer for Aleya Invoicing.',
      toolCount: registry.names().length,
      maxSteps: Number(process.env.ALEYA_AI_MAX_STEPS || 48),
      model: process.env.ALEYA_AI_MODEL || 'openai/gpt-5.4',
      providerConfigured: Boolean(
        process.env.AI_GATEWAY_API_KEY ||
          process.env.VERCEL_OIDC_TOKEN ||
          process.env.ALEYA_AI_ALLOW_UNCONFIGURED === '1',
      ),
      tools: registry.capabilityRows(),
      artificialLimitsForbidden: [
        'one tool call per message',
        'one invoice action per command',
        'predefined sentence patterns only',
        'example commands only',
        'currently open invoice only',
        'text generation only',
        'simulated actions only',
        'small hardcoded intent list',
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
    const result = await runAleyaAgent({
      db: app.db,
      userId,
      organizationId,
      conversationId: body.conversationId ?? null,
      message: body.message,
      visibleState: (body.visibleState || {}) as import('../ai/types.js').AgentVisibleState,
      ...(body.confirmationToken ? { confirmationToken: body.confirmationToken } : {}),
      ...(body.confirm != null ? { confirm: body.confirm } : {}),
    });
    return reply.send(result);
  });

  app.get('/aleya-ai/health', async () => ({
    ok: true,
    registrySize: getAleyaRegistry().names().length || ensureAleyaToolsRegistered().names().length,
  }));
};
