import { randomUUID } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { getWorkspaceContext } from '../auth/workspace-context.js';
import {
  BASIQ_STATE_COOKIE,
  completeBasiqCallback,
  disconnectBankFeed,
  startBasiqConnect,
} from '../domain/banking/connection-service.js';
import { assertBankRateLimit } from '../domain/banking/rate-limit.js';
import { syncBankConnection } from '../domain/banking/sync-service.js';
import {
  BasiqClientError,
  checkBasiqHealth,
  fingerprintPayload,
  verifyBasiqWebhookSignature,
} from '../services/basiq-client.js';

function businessIdFromAuth(request: {
  auth?: { workspaceId?: string; userId?: string };
}): string {
  const workspace = getWorkspaceContext();
  const id = workspace?.workspaceId || request.auth?.workspaceId;
  if (!id) throw new Error('AUTH_UNAUTHENTICATED');
  return id;
}

function clientKey(request: { ip?: string; auth?: { workspaceId?: string; userId?: string } }): string {
  return `${request.auth?.workspaceId || request.auth?.userId || 'anon'}:${request.ip || 'ip'}`;
}

const statusCache = new Map<string, { expiresAt: number; value: unknown }>();
const STATUS_CACHE_MS = 15_000;

function getCachedStatus(businessId: string): unknown | null {
  const hit = statusCache.get(businessId);
  if (!hit || hit.expiresAt <= Date.now()) return null;
  return hit.value;
}

function setCachedStatus(businessId: string, value: unknown): void {
  statusCache.set(businessId, { value, expiresAt: Date.now() + STATUS_CACHE_MS });
}

function bustStatusCache(businessId: string): void {
  statusCache.delete(businessId);
}

function redirectBanking(
  reply: {
    redirect: (url: string) => unknown;
    header: (name: string, value: string) => unknown;
  },
  query: Record<string, string>,
) {
  // Connection results land in Settings → Bank Feeds; Banking remains the transactions workspace.
  const url = new URL('/settings', 'https://ai-invoicing-app.vercel.app');
  url.searchParams.set('tab', 'bank-feeds');
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value);
  }
  return reply.redirect(url.pathname + url.search);
}

export const bankingRoutes: FastifyPluginAsync = async (app) => {
  app.get('/banking/health', async (request, reply) => {
    businessIdFromAuth(request);
    const health = await checkBasiqHealth();
    return reply.send({
      configured: health.configured,
      authenticated: health.authenticated,
      providerReachable: health.providerReachable,
      environment: health.environment,
      latencyMs: health.latencyMs,
      errorCategory: health.errorCategory,
    });
  });

  app.get('/banking/status', async (request, reply) => {
    const businessId = businessIdFromAuth(request);
    const cached = getCachedStatus(businessId);
    if (cached) return reply.send(cached);
    const status = await app.db.getBankFeedStatus(businessId);
    setCachedStatus(businessId, status);
    return reply.send(status);
  });

  app.get('/banking/accounts', async (request, reply) => {
    const businessId = businessIdFromAuth(request);
    const accounts = await app.db.listBankAccounts(businessId, true);
    return reply.send({ accounts });
  });

  app.get('/banking/transactions', async (request, reply) => {
    const businessId = businessIdFromAuth(request);
    const query = z
      .object({
        accountId: z.string().uuid().optional(),
        search: z.string().max(200).optional(),
        limit: z.coerce.number().int().min(1).max(100).optional(),
        offset: z.coerce.number().int().min(0).optional(),
      })
      .parse(request.query);
    const filter: {
      businessId: string;
      accountId?: string;
      search?: string;
      limit: number;
      offset: number;
    } = {
      businessId,
      limit: query.limit ?? 25,
      offset: query.offset ?? 0,
    };
    if (query.accountId) filter.accountId = query.accountId;
    if (query.search) filter.search = query.search;
    const result = await app.db.listBankTransactions(filter);
    return reply.send({
      transactions: result.items,
      total: result.total,
      limit: query.limit ?? 25,
      offset: query.offset ?? 0,
    });
  });

  app.post('/banking/basiq/connect', async (request, reply) => {
    assertBankRateLimit(`connect:${clientKey(request)}`, { limit: 8, windowMs: 60_000 });
    const businessId = businessIdFromAuth(request);
    const workspace = getWorkspaceContext();
    if (!workspace) throw new Error('AUTH_UNAUTHENTICATED');

    const body = z
      .object({
        mobile: z.string().min(8).max(32).optional(),
      })
      .parse(request.body ?? {});

    const profile = await app.db.getBusinessProfile();
    const email =
      (profile?.email && String(profile.email).trim()) ||
      `${businessId.replaceAll('-', '').slice(0, 12)}@users.aleya.app`;
    const mobile = body.mobile?.trim() || profile?.phone?.trim() || null;
    if (!mobile) {
      return reply.code(400).send({
        code: 'BANK_CONNECT_MOBILE_REQUIRED',
        message:
          'A mobile number is required for Basiq AuthLink SMS verification. Add a phone on the business profile or pass mobile in the connect request.',
      });
    }

    try {
      const started = await app.db.startBasiqBankConnect({
        businessId,
        workspaceId: workspace.workspaceId,
        workspaceSchema: workspace.schemaName,
        email,
        mobile,
        firstName: profile?.companyName?.split(/\s+/)[0] || 'Aleya',
        lastName: 'Business',
      });
      reply.header(
        'Set-Cookie',
        `${BASIQ_STATE_COOKIE}=${started.stateToken}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=1800`,
      );
      bustStatusCache(businessId);
      return reply.code(201).send({
        authLinkUrl: started.authLinkUrl,
        connectionId: started.connection.id,
        status: started.connection.status,
        expiresAt: started.expiresAt,
        // Never include tokens or secrets.
      });
    } catch (error) {
      if (error instanceof BasiqClientError) {
        return reply.code(error.category === 'not_configured' ? 503 : 502).send({
          code: 'BASIQ_CONNECT_FAILED',
          category: error.category,
          message: 'Unable to start Basiq bank connection.',
        });
      }
      throw error;
    }
  });

  app.get('/banking/basiq/callback', async (request, reply) => {
    assertBankRateLimit(`callback:${request.ip || 'ip'}`, { limit: 30, windowMs: 60_000 });
    const query = z
      .object({
        state: z.string().min(8).max(200).optional(),
        error: z.string().max(200).optional(),
      })
      .passthrough()
      .parse(request.query);

    const cookieHeader = String(request.headers.cookie || '');
    const cookieMatch = cookieHeader.match(
      new RegExp(`(?:^|;\\s*)${BASIQ_STATE_COOKIE}=([^;]+)`),
    );
    const cookieState = cookieMatch?.[1] ? decodeURIComponent(cookieMatch[1]) : null;
    const stateToken = query.state || cookieState;
    if (!stateToken) {
      return redirectBanking(reply, { banking: 'error', reason: 'missing_state' });
    }
    if (query.error) {
      return redirectBanking(reply, { banking: 'error', reason: 'provider_error' });
    }

    try {
      const completed = await app.db.completeBasiqBankCallback({
        stateToken,
        cookieState,
      });
      reply.header(
        'Set-Cookie',
        `${BASIQ_STATE_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
      );
      return redirectBanking(reply, {
        banking: 'connected',
        accounts: String(completed.sync.accountsUpserted),
        imported: String(completed.sync.transactionsUpserted),
      });
    } catch (error) {
      const reason =
        error instanceof Error && error.message.startsWith('BANK_CONNECT_')
          ? error.message.toLowerCase()
          : 'callback_failed';
      return redirectBanking(reply, { banking: 'error', reason });
    }
  });

  app.post('/banking/refresh', async (request, reply) => {
    assertBankRateLimit(`refresh:${clientKey(request)}`, { limit: 12, windowMs: 60_000 });
    const businessId = businessIdFromAuth(request);
    try {
      const result = await app.db.refreshBankFeed(businessId);
      bustStatusCache(businessId);
      return reply.send(result);
    } catch (error) {
      if (error instanceof Error && error.message === 'BANK_CONNECTION_NOT_FOUND') {
        return reply.code(404).send({ code: 'BANK_CONNECTION_NOT_FOUND' });
      }
      if (error instanceof BasiqClientError) {
        return reply.code(502).send({
          code: 'BANK_REFRESH_FAILED',
          category: error.category,
          message: 'Bank refresh failed.',
        });
      }
      throw error;
    }
  });

  app.post('/banking/disconnect', async (request, reply) => {
    assertBankRateLimit(`disconnect:${clientKey(request)}`, { limit: 8, windowMs: 60_000 });
    const businessId = businessIdFromAuth(request);
    const body = z
      .object({
        confirm: z.literal(true),
      })
      .parse(request.body ?? {});
    try {
      const connection = await app.db.disconnectBankFeed(businessId, body.confirm);
      bustStatusCache(businessId);
      return reply.send({
        status: connection.status,
        connectionId: connection.id,
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'BANK_DISCONNECT_CONFIRMATION_REQUIRED') {
        return reply.code(400).send({
          code: 'BANK_DISCONNECT_CONFIRMATION_REQUIRED',
          message: 'Disconnect requires explicit confirmation.',
        });
      }
      if (error instanceof Error && error.message === 'BANK_CONNECTION_NOT_FOUND') {
        return reply.code(404).send({ code: 'BANK_CONNECTION_NOT_FOUND' });
      }
      throw error;
    }
  });

  app.post('/banking/basiq/webhook', async (request, reply) => {
    assertBankRateLimit(`webhook:${request.ip || 'ip'}`, { limit: 120, windowMs: 60_000 });
    const rawBody =
      typeof request.body === 'string'
        ? request.body
        : JSON.stringify(request.body ?? {});
    const signature =
      singleHeader(request.headers['x-basiq-signature']) ||
      singleHeader(request.headers['basiq-signature']);
    if (!verifyBasiqWebhookSignature(rawBody, signature)) {
      return reply.code(401).send({ code: 'WEBHOOK_SIGNATURE_INVALID' });
    }
    // Acknowledge only — do not log payload contents. Fingerprint for ops correlation.
    return reply.code(202).send({
      accepted: true,
      fingerprint: fingerprintPayload(rawBody),
      eventId: randomUUID(),
    });
  });
};

function singleHeader(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

/** Used by AppDatabase wiring — re-export service helpers for db methods. */
export {
  completeBasiqCallback,
  disconnectBankFeed,
  startBasiqConnect,
  syncBankConnection,
};
