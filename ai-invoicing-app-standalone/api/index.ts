import type { IncomingMessage, ServerResponse } from 'node:http';

import type { FastifyInstance } from 'fastify';

import { buildApp } from '../src/app.js';
import { env } from '../src/config/env.js';

type AppBuilder = () => Promise<FastifyInstance>;
export type VercelNodeHandler = (
  request: IncomingMessage,
  response: ServerResponse,
) => Promise<void>;

async function buildProductionApp(): Promise<FastifyInstance> {
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
    ...(env.ABOSS_INTEGRATION_SECRET !== undefined ? { abossIntegrationSecret: env.ABOSS_INTEGRATION_SECRET } : {}),
    ...(env.ABOSS_INTEGRATION_ACTOR_USER_ID !== undefined ? { abossIntegrationActorUserId: env.ABOSS_INTEGRATION_ACTOR_USER_ID } : {}),
    ...(env.ABOSS_ALLOWED_ORGANIZATION_ID !== undefined ? { abossAllowedOrganizationId: env.ABOSS_ALLOWED_ORGANIZATION_ID } : {}),
    ...(env.SUPABASE_URL !== undefined ? { supabaseUrl: env.SUPABASE_URL } : {}),
    ...((env.SUPABASE_ANON_KEY ?? env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? env.SUPABASE_PUBLISHABLE_KEY) !== undefined
      ? { supabaseAnonKey: env.SUPABASE_ANON_KEY ?? env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? env.SUPABASE_PUBLISHABLE_KEY }
      : {}),
  });
}

export function createVercelHandler(build: AppBuilder = buildProductionApp): VercelNodeHandler {
  let appPromise: Promise<FastifyInstance> | undefined;

  const getApp = (): Promise<FastifyInstance> => {
    appPromise ??= build().then(async (app) => {
      await app.ready();
      return app;
    });
    return appPromise;
  };

  return async (request, response) => {
    const REQUEST_HARD_TIMEOUT_MS = 55_000;
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
      const startupError =
        error && typeof error === 'object'
          ? {
              name: error instanceof Error ? error.name : 'UnknownError',
              code:
                'code' in error && typeof error.code === 'string'
                  ? error.code
                  : 'APP_INITIALIZATION_FAILED',
            }
          : { name: 'UnknownError', code: 'APP_INITIALIZATION_FAILED' };
      const isTimeout =
        error &&
        typeof error === 'object' &&
        'code' in error &&
        (error as { code?: string }).code === 'REQUEST_TIMEOUT';
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
            code: isTimeout ? 'REQUEST_TIMEOUT' : 'INTERNAL_SERVER_ERROR',
            message: isTimeout ? 'Request timed out' : 'Internal server error',
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
