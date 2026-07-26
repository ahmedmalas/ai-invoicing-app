import { randomUUID } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { getWorkspaceContext } from '../auth/workspace-context.js';
import {
  BASIQ_CONNECTIONS_NOT_ENABLED_CODE,
  BASIQ_CONNECTIONS_NOT_ENABLED_MESSAGE,
  classifyBasiqHostedError,
} from '../domain/banking/basiq-errors.js';
import {
  BASIQ_STATE_COOKIE,
  completeBasiqCallback,
  disconnectBankFeed,
  startBasiqConnect,
} from '../domain/banking/connection-service.js';
import { InvalidAustralianMobileError } from '../domain/banking/phone.js';
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

function connectFailurePayload(error: BasiqClientError): {
  code: string;
  category: string;
  message: string;
  providerDetail: string | null;
} {
  if (error.category === 'connections_not_enabled') {
    return {
      code: BASIQ_CONNECTIONS_NOT_ENABLED_CODE,
      category: error.category,
      message: BASIQ_CONNECTIONS_NOT_ENABLED_MESSAGE,
      providerDetail: error.providerDetail || null,
    };
  }
  return {
    code: 'BASIQ_CONNECT_FAILED',
    category: error.category,
    message: error.providerDetail || error.message || 'Unable to start Basiq bank connection.',
    providerDetail: error.providerDetail || null,
  };
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
      hooliObInstitutionAvailable: health.hooliObInstitutionAvailable,
      hooliObOpenBankingMethod: health.hooliObOpenBankingMethod,
    });
  });

  app.get('/banking/status', async (request, reply) => {
    const businessId = businessIdFromAuth(request);
    const cached = getCachedStatus(businessId);
    if (cached) return reply.send(cached);
    // Detect hosted Consent UI failures (e.g. Connections not enabled) via recent jobs.
    try {
      await app.db.reconcileBasiqHostedFailures(businessId);
    } catch {
      // Status must still load if job reconciliation fails.
    }
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
    // Connect + resend AuthLink share this limiter (sensible resend spacing).
    assertBankRateLimit(`connect:${clientKey(request)}`, { limit: 6, windowMs: 60_000 });
    const businessId = businessIdFromAuth(request);
    const workspace = getWorkspaceContext();
    if (!workspace) throw new Error('AUTH_UNAUTHENTICATED');

    const body = z
      .object({
        mobile: z.string().min(8).max(32).optional(),
        /** Explicit resend of AuthLink (same connect path, clearer UX). */
        resend: z.boolean().optional(),
        /** Force a new mobile (invalidates prior AuthLink and updates Basiq user). */
        changeMobile: z.boolean().optional(),
        /**
         * Revoke active Basiq consent and start a fresh AuthLink.
         * Use when Consent UI is stuck on manage-home / Stop sharing.
         */
        freshConsent: z.boolean().optional(),
      })
      .parse(request.body ?? {});

    const profile = await app.db.getBusinessProfile();
    const email =
      (profile?.email && String(profile.email).trim()) ||
      `${businessId.replaceAll('-', '').slice(0, 12)}@users.aleya.app`;
    // Explicit body mobile wins. Otherwise profile phone seeds first connect;
    // reconnect/resend reuse the last confirmed AuthLink mobile inside the service.
    const mobile =
      body.mobile?.trim() ||
      (body.changeMobile ? null : body.resend ? null : profile?.phone?.trim() || null);

    try {
      const started = await app.db.startBasiqBankConnect({
        businessId,
        workspaceId: workspace.workspaceId,
        workspaceSchema: workspace.schemaName,
        email,
        mobile,
        changeMobile: Boolean(body.changeMobile),
        freshConsent: Boolean(body.freshConsent),
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
        environment: started.environment,
        sandbox: started.sandbox,
        deliveryMode: started.deliveryMode,
        launchMode: started.launchMode,
        activeConsentId: started.activeConsentId,
        redirectUrlRequired: started.redirectUrlRequired,
        authLinkMobileMasked: started.authLinkMobileMasked,
        message: body.freshConsent
          ? `Fresh consent started. SMS verification will go to ${started.authLinkMobileMasked}.`
          : body.changeMobile
            ? `Mobile updated. New AuthLink created — SMS verification will go to ${started.authLinkMobileMasked}.`
            : body.resend
              ? started.launchMode === 'consent_ui_connect'
                ? started.message
                : `AuthLink regenerated. SMS verification will go to ${started.authLinkMobileMasked}.`
              : started.message,
        // Never include the full mobile, tokens, or secrets.
      });
    } catch (error) {
      if (error instanceof BasiqClientError) {
        const payload = connectFailurePayload(error);
        return reply
          .code(error.category === 'not_configured' ? 503 : 502)
          .send(payload);
      }
      if (error instanceof InvalidAustralianMobileError) {
        return reply.code(400).send({
          code: error.code,
          message: error.message,
        });
      }
      throw error;
    }
  });

  /**
   * Persist a hosted Consent UI failure reported by callback query params or the client.
   * Used when Basiq shows "Connections not enabled" / access-denied inside AuthLink.
   */
  app.post('/banking/basiq/report-hosted-error', async (request, reply) => {
    assertBankRateLimit(`hosted-error:${clientKey(request)}`, { limit: 20, windowMs: 60_000 });
    const businessId = businessIdFromAuth(request);
    const body = z
      .object({
        error: z.string().max(200).optional(),
        errorDescription: z.string().max(500).optional(),
        code: z.string().max(200).optional(),
        title: z.string().max(300).optional(),
        detail: z.string().max(500).optional(),
        message: z.string().max(500).optional(),
      })
      .parse(request.body ?? {});

    const classified = classifyBasiqHostedError(body);
    const connection = await app.db.reportBasiqHostedFailure(businessId, {
      error: body.error,
      errorDescription: body.errorDescription,
      code: body.code,
      title: body.title,
      detail: body.detail,
      message: body.message,
    });
    bustStatusCache(businessId);
    return reply.send({
      recorded: Boolean(connection),
      reason: classified.reason,
      code: classified.connectionsNotEnabled
        ? BASIQ_CONNECTIONS_NOT_ENABLED_CODE
        : 'BASIQ_HOSTED_ERROR',
      message: classified.message,
      status: connection?.status || null,
    });
  });

  app.get('/banking/basiq/callback', async (request, reply) => {
    assertBankRateLimit(`callback:${request.ip || 'ip'}`, { limit: 30, windowMs: 60_000 });
    const query = z
      .object({
        state: z.string().min(8).max(200).optional(),
        error: z.string().max(200).optional(),
        error_description: z.string().max(500).optional(),
        errorDescription: z.string().max(500).optional(),
        code: z.string().max(200).optional(),
        title: z.string().max(300).optional(),
        detail: z.string().max(500).optional(),
      })
      .passthrough()
      .parse(request.query);

    const cookieHeader = String(request.headers.cookie || '');
    const cookieMatch = cookieHeader.match(
      new RegExp(`(?:^|;\\s*)${BASIQ_STATE_COOKIE}=([^;]+)`),
    );
    const cookieState = cookieMatch?.[1] ? decodeURIComponent(cookieMatch[1]) : null;
    const stateToken = query.state || cookieState;

    const hostedErrorInput = {
      error: query.error,
      errorDescription: query.error_description || query.errorDescription,
      code: query.code || query.error,
      title: query.title,
      detail: query.detail || query.error_description || query.errorDescription,
      message: query.error_description || query.errorDescription || query.error,
    };
    const hasHostedError = Boolean(
      query.error ||
        query.error_description ||
        query.errorDescription ||
        (query.title && /connection/i.test(query.title)),
    );

    if (hasHostedError) {
      const classified = classifyBasiqHostedError(hostedErrorInput);
      if (stateToken && (!cookieState || cookieState === stateToken)) {
        try {
          await app.db.failBasiqBankCallback({
            stateToken,
            cookieState,
            ...hostedErrorInput,
          });
        } catch {
          // Still redirect with the classified reason.
        }
      }
      reply.header(
        'Set-Cookie',
        `${BASIQ_STATE_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
      );
      return redirectBanking(reply, {
        banking: 'error',
        reason: classified.reason,
      });
    }

    if (!stateToken) {
      return redirectBanking(reply, { banking: 'error', reason: 'missing_state' });
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
        if (error.category === 'connections_not_enabled') {
          try {
            await app.db.reportBasiqHostedFailure(businessId, {
              message: error.providerDetail || error.message,
              detail: error.providerDetail || error.message,
              code: error.category,
            });
            bustStatusCache(businessId);
          } catch {
            // ignore persist failure
          }
          return reply.code(502).send({
            code: BASIQ_CONNECTIONS_NOT_ENABLED_CODE,
            category: error.category,
            message: BASIQ_CONNECTIONS_NOT_ENABLED_MESSAGE,
          });
        }
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
