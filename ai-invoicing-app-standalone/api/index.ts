import type { IncomingMessage, ServerResponse } from 'node:http';

import type { FastifyInstance } from 'fastify';

import { buildApp } from '../src/app.js';
import { env } from '../src/config/env.js';
import { resolveSupabaseAuthConfig } from '../src/config/supabase-auth.js';

type AppBuilder = () => Promise<FastifyInstance>;
export type VercelNodeHandler = (
  request: IncomingMessage,
  response: ServerResponse,
) => Promise<void>;

/** Keep startup under the Vercel 60s hard kill; leave headroom for the request itself. */
export const APP_INITIALIZATION_TIMEOUT_MS = 25_000;
const REQUEST_HARD_TIMEOUT_MS = 55_000;

export type VercelHandlerOptions = {
  initializationTimeoutMs?: number;
};

async function buildProductionApp(): Promise<FastifyInstance> {
  const auth = resolveSupabaseAuthConfig({
    ...(env.SUPABASE_URL !== undefined ? { supabaseUrl: env.SUPABASE_URL } : {}),
    ...((env.SUPABASE_ANON_KEY ??
      env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
      env.SUPABASE_PUBLISHABLE_KEY) !== undefined
      ? {
          supabaseAnonKey:
            env.SUPABASE_ANON_KEY ??
            env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
            env.SUPABASE_PUBLISHABLE_KEY,
        }
      : {}),
  });
  return buildApp({
    ...(env.DATABASE_URL !== undefined ? { databaseUrl: env.DATABASE_URL } : {}),
    dbPoolMax: env.DB_POOL_MAX,
    enableStructuredLogging: env.ENABLE_STRUCTURED_LOGGING,
    logLevel: env.LOG_LEVEL,
    serviceName: env.SERVICE_NAME,
    organizationId: env.ORGANIZATION_ID,
    nodeEnv: env.NODE_ENV,
    corsOrigin: env.CORS_ORIGIN,
    publicAppUrl: env.PUBLIC_APP_URL,
    requestBodyLimit: env.REQUEST_BODY_LIMIT,
    serveFrontend: env.ENABLE_BROWSER_APP,
    abossOnlyAuth: env.ABOSS_ONLY_AUTH,
    ...(env.ABOSS_INTEGRATION_SECRET !== undefined
      ? { abossIntegrationSecret: env.ABOSS_INTEGRATION_SECRET }
      : {}),
    ...(env.ABOSS_INTEGRATION_ACTOR_USER_ID !== undefined
      ? { abossIntegrationActorUserId: env.ABOSS_INTEGRATION_ACTOR_USER_ID }
      : {}),
    ...(env.ABOSS_ALLOWED_ORGANIZATION_ID !== undefined
      ? { abossAllowedOrganizationId: env.ABOSS_ALLOWED_ORGANIZATION_ID }
      : {}),
    ...(auth.supabaseUrl !== undefined ? { supabaseUrl: auth.supabaseUrl } : {}),
    ...(auth.supabaseAnonKey !== undefined ? { supabaseAnonKey: auth.supabaseAnonKey } : {}),
  });
}

function withTimeout<T>(promise: Promise<T>, ms: number, code: string, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(Object.assign(new Error(message), { code }));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export function createVercelHandler(
  build: AppBuilder = buildProductionApp,
  options: VercelHandlerOptions = {},
): VercelNodeHandler {
  let appPromise: Promise<FastifyInstance> | undefined;
  const initializationTimeoutMs = options.initializationTimeoutMs ?? APP_INITIALIZATION_TIMEOUT_MS;

  const getApp = (): Promise<FastifyInstance> => {
    if (!appPromise) {
      const startedAt = Date.now();
      appPromise = withTimeout(
        build().then(async (app) => {
          await app.ready();
          console.info(
            JSON.stringify({
              event: 'vercel.app.ready',
              durationMs: Date.now() - startedAt,
            }),
          );
          return app;
        }),
        initializationTimeoutMs,
        'APP_INITIALIZATION_TIMEOUT',
        'Application initialization timed out',
      ).catch((error: unknown) => {
        // Allow the next request to retry boot after a failed/hung cold start.
        appPromise = undefined;
        console.error(
          JSON.stringify({
            event: 'vercel.app.init_failed',
            durationMs: Date.now() - startedAt,
            code:
              error && typeof error === 'object' && 'code' in error
                ? (error as { code?: string }).code
                : 'APP_INITIALIZATION_FAILED',
            message: error instanceof Error ? error.message : 'unknown',
          }),
        );
        throw error;
      });
    }
    return appPromise;
  };

  return async (request, response) => {
    let hardTimeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const app = await getApp();
      await Promise.race([
        new Promise<void>((resolve, reject) => {
          const cleanup = (): void => {
            response.off('finish', onFinish);
            response.off('close', onClose);
            response.off('error', onError);
          };
          const onFinish = (): void => {
            cleanup();
            resolve();
          };
          const onClose = (): void => {
            cleanup();
            resolve();
          };
          const onError = (error: Error): void => {
            cleanup();
            reject(error);
          };

          response.once('finish', onFinish);
          response.once('close', onClose);
          response.once('error', onError);
          app.server.emit('request', request, response);
        }),
        new Promise<void>((_, reject) => {
          hardTimeout = setTimeout(() => {
            reject(
              Object.assign(new Error('REQUEST_TIMEOUT'), {
                code: 'REQUEST_TIMEOUT',
              }),
            );
          }, REQUEST_HARD_TIMEOUT_MS);
        }),
      ]);
    } catch (error) {
      const code =
        error && typeof error === 'object' && 'code' in error
          ? (error as { code?: string }).code
          : undefined;
      const isTimeout = code === 'REQUEST_TIMEOUT' || code === 'APP_INITIALIZATION_TIMEOUT';
      const startupError = {
        name: error instanceof Error ? error.name : 'UnknownError',
        code: code ?? 'APP_INITIALIZATION_FAILED',
      };
      console.error(
        isTimeout ? 'Vercel request timed out' : 'Vercel application initialization failed',
        startupError,
      );
      if (!response.headersSent) {
        response.statusCode = isTimeout ? 504 : 500;
        response.setHeader('content-type', 'application/json; charset=utf-8');
        response.end(
          JSON.stringify({
            status: isTimeout ? 504 : 500,
            code: isTimeout
              ? code === 'APP_INITIALIZATION_TIMEOUT'
                ? 'APP_INITIALIZATION_TIMEOUT'
                : 'REQUEST_TIMEOUT'
              : 'INTERNAL_SERVER_ERROR',
            message: isTimeout
              ? code === 'APP_INITIALIZATION_TIMEOUT'
                ? 'Application initialization timed out'
                : 'Request timed out'
              : 'Internal server error',
          }),
        );
      } else if (!response.writableEnded) {
        response.end();
      }
    } finally {
      if (hardTimeout) clearTimeout(hardTimeout);
    }
  };
}

const handler = createVercelHandler();

export default handler;
