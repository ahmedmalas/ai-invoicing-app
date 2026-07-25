/**
 * Server-only Basiq API client.
 * Never import this from browser bundles. Credentials stay in process env.
 */

import { createHash } from 'node:crypto';

const BASIQ_API_BASE = process.env.BASIQ_API_BASE_URL || 'https://au-api.basiq.io';
const BASIQ_VERSION = process.env.BASIQ_API_VERSION || '3.0';
const TOKEN_SKEW_MS = 60_000;
const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_RETRIES = 2;

export type BasiqErrorCategory =
  | 'not_configured'
  | 'auth_failed'
  | 'rate_limited'
  | 'not_found'
  | 'provider_error'
  | 'network'
  | 'timeout'
  | 'invalid_response';

export class BasiqClientError extends Error {
  readonly category: BasiqErrorCategory;
  readonly status?: number | undefined;
  readonly endpoint?: string | undefined;

  constructor(
    category: BasiqErrorCategory,
    message: string,
    options?: { status?: number; endpoint?: string },
  ) {
    super(message);
    this.name = 'BasiqClientError';
    this.category = category;
    this.status = options?.status;
    this.endpoint = options?.endpoint;
  }
}

interface CachedToken {
  accessToken: string;
  expiresAtMs: number;
}

let cachedServerToken: CachedToken | null = null;

export function basiqConfigured(): boolean {
  return Boolean(process.env.BASIQ_API_KEY?.trim());
}

export function basiqEnvironmentLabel(): 'sandbox' | 'production' | 'unknown' {
  const explicit = (process.env.BASIQ_ENVIRONMENT || '').toLowerCase();
  if (explicit === 'sandbox' || explicit === 'production') return explicit;
  // Development integrations default to sandbox semantics.
  return process.env.NODE_ENV === 'production' ? 'production' : 'sandbox';
}

function apiKey(): string {
  const key = process.env.BASIQ_API_KEY?.trim();
  if (!key) {
    throw new BasiqClientError('not_configured', 'BASIQ_API_KEY is not configured');
  }
  return key;
}

function categorizeStatus(status: number): BasiqErrorCategory {
  if (status === 401 || status === 403) return 'auth_failed';
  if (status === 404) return 'not_found';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'provider_error';
  return 'provider_error';
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new BasiqClientError('timeout', 'Basiq request timed out');
    }
    throw new BasiqClientError('network', 'Basiq network error');
  } finally {
    clearTimeout(timer);
  }
}

function logSafe(
  level: 'info' | 'warn' | 'error',
  payload: Record<string, unknown>,
): void {
  const line = JSON.stringify({
    service: 'basiq-client',
    ...payload,
  });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.info(line);
}

/** Exchange API key for SERVER_ACCESS token; cache until near expiry. */
export async function getBasiqAccessToken(): Promise<string> {
  const now = Date.now();
  if (cachedServerToken && cachedServerToken.expiresAtMs - TOKEN_SKEW_MS > now) {
    return cachedServerToken.accessToken;
  }

  const key = apiKey();
  const started = Date.now();
  const response = await fetchWithTimeout(`${BASIQ_API_BASE}/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${key}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'basiq-version': BASIQ_VERSION,
      Accept: 'application/json',
    },
    body: 'scope=SERVER_ACCESS',
  });
  const durationMs = Date.now() - started;
  if (!response.ok) {
    logSafe('warn', {
      event: 'basiq.token',
      endpoint: '/token',
      status: response.status,
      durationMs,
      category: categorizeStatus(response.status),
    });
    throw new BasiqClientError(categorizeStatus(response.status), 'Basiq authentication failed', {
      status: response.status,
      endpoint: '/token',
    });
  }
  const body = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
  };
  if (!body.access_token) {
    throw new BasiqClientError('invalid_response', 'Basiq token response missing access_token');
  }
  const expiresInSec = Number(body.expires_in || 3600);
  cachedServerToken = {
    accessToken: body.access_token,
    expiresAtMs: Date.now() + expiresInSec * 1000,
  };
  logSafe('info', {
    event: 'basiq.token',
    endpoint: '/token',
    status: response.status,
    durationMs,
    category: 'ok',
  });
  return body.access_token;
}

/** Test helper — clear cached token between tests. */
export function resetBasiqTokenCacheForTests(): void {
  cachedServerToken = null;
}

export async function basiqRequest<T = unknown>(
  method: string,
  path: string,
  options?: { body?: unknown; query?: Record<string, string | number | undefined> },
): Promise<T> {
  let attempt = 0;
  let lastError: unknown;
  while (attempt <= MAX_RETRIES) {
    attempt += 1;
    const token = await getBasiqAccessToken();
    const url = new URL(path.startsWith('http') ? path : `${BASIQ_API_BASE}${path}`);
    if (options?.query) {
      for (const [key, value] of Object.entries(options.query)) {
        if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
      }
    }
    const started = Date.now();
    try {
      const response = await fetchWithTimeout(url.toString(), {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'basiq-version': BASIQ_VERSION,
        },
        ...(options?.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
      });
      const durationMs = Date.now() - started;
      if (response.status === 401 && attempt <= MAX_RETRIES) {
        cachedServerToken = null;
        lastError = new BasiqClientError('auth_failed', 'Basiq token rejected', {
          status: 401,
          endpoint: path,
        });
        continue;
      }
      if (response.status === 429 && attempt <= MAX_RETRIES) {
        logSafe('warn', {
          event: 'basiq.request',
          endpoint: path,
          method,
          status: 429,
          durationMs,
          category: 'rate_limited',
          attempt,
        });
        await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
        continue;
      }
      if (!response.ok) {
        logSafe('warn', {
          event: 'basiq.request',
          endpoint: path,
          method,
          status: response.status,
          durationMs,
          category: categorizeStatus(response.status),
        });
        throw new BasiqClientError(
          categorizeStatus(response.status),
          `Basiq ${method} ${path} failed`,
          { status: response.status, endpoint: path },
        );
      }
      logSafe('info', {
        event: 'basiq.request',
        endpoint: path,
        method,
        status: response.status,
        durationMs,
        category: 'ok',
      });
      if (response.status === 204) return undefined as T;
      return (await response.json()) as T;
    } catch (error) {
      lastError = error;
      if (
        error instanceof BasiqClientError &&
        (error.category === 'timeout' || error.category === 'network') &&
        attempt <= MAX_RETRIES
      ) {
        continue;
      }
      throw error;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new BasiqClientError('provider_error', 'Basiq request failed');
}

export interface BasiqHealthResult {
  configured: boolean;
  authenticated: boolean;
  providerReachable: boolean;
  environment: 'sandbox' | 'production' | 'unknown';
  latencyMs: number | null;
  errorCategory: BasiqErrorCategory | null;
}

export async function checkBasiqHealth(): Promise<BasiqHealthResult> {
  if (!basiqConfigured()) {
    return {
      configured: false,
      authenticated: false,
      providerReachable: false,
      environment: basiqEnvironmentLabel(),
      latencyMs: null,
      errorCategory: 'not_configured',
    };
  }
  const started = Date.now();
  try {
    await getBasiqAccessToken();
    // Lightweight authenticated probe — list institutions (limit 1).
    await basiqRequest('GET', '/institutions', { query: { limit: 1 } });
    return {
      configured: true,
      authenticated: true,
      providerReachable: true,
      environment: basiqEnvironmentLabel(),
      latencyMs: Date.now() - started,
      errorCategory: null,
    };
  } catch (error) {
    const category =
      error instanceof BasiqClientError ? error.category : ('provider_error' as BasiqErrorCategory);
    return {
      configured: true,
      authenticated: category !== 'auth_failed' && category !== 'not_configured',
      providerReachable: category !== 'network' && category !== 'timeout',
      environment: basiqEnvironmentLabel(),
      latencyMs: Date.now() - started,
      errorCategory: category,
    };
  }
}

export async function createBasiqUser(input: {
  email: string;
  mobile?: string | null | undefined;
  firstName?: string | null | undefined;
  lastName?: string | null | undefined;
}): Promise<{ id: string }> {
  const body: Record<string, string> = { email: input.email };
  if (input.mobile) body.mobile = input.mobile;
  if (input.firstName) body.firstName = input.firstName;
  if (input.lastName) body.lastName = input.lastName;
  const created = await basiqRequest<{ id: string }>('POST', '/users', { body });
  return { id: created.id };
}

export async function createBasiqAuthLink(userId: string): Promise<{
  publicUrl: string;
  expiresAt: string | null;
}> {
  const created = await basiqRequest<{
    expiresAt?: string;
    links?: { public?: string };
  }>('POST', `/users/${encodeURIComponent(userId)}/auth_link`, { body: {} });
  const publicUrl = created.links?.public;
  if (!publicUrl) {
    throw new BasiqClientError('invalid_response', 'Basiq auth_link missing public URL');
  }
  return { publicUrl, expiresAt: created.expiresAt || null };
}

export async function listBasiqConnections(userId: string): Promise<unknown[]> {
  const result = await basiqRequest<{ data?: unknown[] }>(
    'GET',
    `/users/${encodeURIComponent(userId)}/connections`,
  );
  return Array.isArray(result?.data) ? result.data : Array.isArray(result) ? (result as unknown[]) : [];
}

export async function listBasiqAccounts(userId: string): Promise<unknown[]> {
  const result = await basiqRequest<{ data?: unknown[] }>(
    'GET',
    `/users/${encodeURIComponent(userId)}/accounts`,
  );
  return Array.isArray(result?.data) ? result.data : [];
}

export async function listBasiqTransactions(
  userId: string,
  options?: { filter?: string; limit?: number; next?: string },
): Promise<{ data: unknown[]; next?: string | null }> {
  if (options?.next) {
    const result = await basiqRequest<{ data?: unknown[]; links?: { next?: string } }>(
      'GET',
      options.next,
    );
    return { data: result.data || [], next: result.links?.next || null };
  }
  const result = await basiqRequest<{ data?: unknown[]; links?: { next?: string } }>(
    'GET',
    `/users/${encodeURIComponent(userId)}/transactions`,
    {
      query: {
        limit: options?.limit || 500,
        ...(options?.filter ? { filter: options.filter } : {}),
      },
    },
  );
  return { data: result.data || [], next: result.links?.next || null };
}

export async function refreshBasiqConnection(
  userId: string,
  connectionId: string,
): Promise<{ jobId?: string }> {
  // POST refresh — Basiq v2/v3 uses refresh endpoint on connection.
  const result = await basiqRequest<{ id?: string }>(
    'POST',
    `/users/${encodeURIComponent(userId)}/connections/${encodeURIComponent(connectionId)}/refresh`,
    { body: {} },
  );
  return result?.id ? { jobId: result.id } : {};
}

export async function deleteBasiqConnection(
  userId: string,
  connectionId: string,
): Promise<void> {
  await basiqRequest(
    'DELETE',
    `/users/${encodeURIComponent(userId)}/connections/${encodeURIComponent(connectionId)}`,
  );
}

/** Stable fingerprint for webhook dedupe — never logs payload contents. */
export function fingerprintPayload(payload: string): string {
  return createHash('sha256').update(payload).digest('hex').slice(0, 32);
}

export function verifyBasiqWebhookSignature(
  rawBody: string,
  signatureHeader: string | undefined,
): boolean {
  const secret = process.env.BASIQ_WEBHOOK_SECRET?.trim();
  if (!secret) {
    // If no secret configured, reject webhooks in production; allow in test with explicit bypass.
    if (process.env.NODE_ENV === 'test' && process.env.BASIQ_WEBHOOK_ALLOW_UNSIGNED === '1') {
      return true;
    }
    return false;
  }
  if (!signatureHeader) return false;
  const expected = createHash('sha256').update(`${secret}.${rawBody}`).digest('hex');
  // Constant-time-ish compare
  const a = Buffer.from(expected);
  const b = Buffer.from(signatureHeader.replace(/^sha256=/i, ''));
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) mismatch |= a[i]! ^ b[i]!;
  return mismatch === 0;
}
