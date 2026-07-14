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
    requestBodyLimit: env.REQUEST_BODY_LIMIT,
    ...(env.SUPABASE_URL !== undefined ? { supabaseUrl: env.SUPABASE_URL } : {}),
    ...((env.SUPABASE_ANON_KEY ?? env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? env.SUPABASE_PUBLISHABLE_KEY) !== undefined
      ? { supabaseAnonKey: env.SUPABASE_ANON_KEY ?? env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? env.SUPABASE_PUBLISHABLE_KEY }
      : {}),
    ...((env.SUPABASE_SERVICE_ROLE_KEY ?? env.SUPABASE_SECRET_KEY) !== undefined
      ? { supabaseServiceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY ?? env.SUPABASE_SECRET_KEY }
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
    try {
      const app = await getApp();
      await new Promise<void>((resolve, reject) => {
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
      });
    } catch {
      if (!response.headersSent) {
        response.statusCode = 500;
        response.setHeader('content-type', 'application/json; charset=utf-8');
        response.end(
          JSON.stringify({
            status: 500,
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Internal server error',
          }),
        );
      } else if (!response.writableEnded) {
        response.end();
      }
    }
  };
}

const handler = createVercelHandler();

export default handler;
