import type { FastifyPluginAsync } from 'fastify';

import { getWorkspaceContext } from '../auth/workspace-context.js';
import {
  BANK_FEEDS_RETIRED_CODE,
  BANK_FEEDS_RETIRED_MESSAGE,
  retiredBankFeedStatus,
} from '../domain/banking/retired.js';

function businessIdFromAuth(request: {
  auth?: { workspaceId?: string; userId?: string };
}): string {
  const workspace = getWorkspaceContext();
  const id = workspace?.workspaceId || request.auth?.workspaceId;
  if (!id) throw new Error('AUTH_UNAUTHENTICATED');
  return id;
}

function retiredPayload() {
  return {
    status: 410,
    code: BANK_FEEDS_RETIRED_CODE,
    message: BANK_FEEDS_RETIRED_MESSAGE,
  };
}

/**
 * Bank Feeds HTTP surface after Basiq retirement.
 * Status remains for UI/AI; connect/consent/webhook/sync paths are gone.
 */
export const bankingRoutes: FastifyPluginAsync = async (app) => {
  app.get('/banking/health', async (request, reply) => {
    businessIdFromAuth(request);
    return reply.send({
      configured: false,
      authenticated: false,
      providerReachable: false,
      environment: null,
      latencyMs: null,
      errorCategory: 'provider_retired',
      retired: true,
      code: BANK_FEEDS_RETIRED_CODE,
      message: BANK_FEEDS_RETIRED_MESSAGE,
    });
  });

  app.get('/banking/status', async (request, reply) => {
    businessIdFromAuth(request);
    // Clear any leftover Basiq connection / mobile / consent state so it cannot be reused.
    try {
      await app.db.clearRetiredBankFeedProviderState();
    } catch {
      // Status must still load.
    }
    return reply.send(retiredBankFeedStatus());
  });

  app.get('/banking/accounts', async (request, reply) => {
    businessIdFromAuth(request);
    return reply.send({ accounts: [] });
  });

  app.get('/banking/transactions', async (request, reply) => {
    businessIdFromAuth(request);
    return reply.send({ items: [], total: 0, limit: 25, offset: 0 });
  });

  const gone = async (_request: unknown, reply: { code: (n: number) => { send: (b: unknown) => unknown } }) =>
    reply.code(410).send(retiredPayload());

  app.post('/banking/basiq/connect', gone);
  app.post('/banking/basiq/report-hosted-error', gone);
  app.get('/banking/basiq/callback', async (_request, reply) => {
    // Old AuthLink / Consent redirects must not resume a connection.
    const url = new URL('/settings', 'https://ai-invoicing-app.vercel.app');
    url.searchParams.set('tab', 'bank-feeds');
    url.searchParams.set('banking', 'retired');
    return reply.redirect(url.pathname + url.search);
  });
  app.post('/banking/basiq/webhook', gone);
  app.post('/banking/refresh', gone);
  app.post('/banking/disconnect', gone);
};
