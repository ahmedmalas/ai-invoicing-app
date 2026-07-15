import { z } from 'zod';
import type { FastifyPluginAsync } from 'fastify';

export interface SupabaseAuthOptions {
  url?: string | undefined;
  anonKey?: string | undefined;
}

const credentialsSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(12).max(128),
});
const refreshSchema = z.object({ refreshToken: z.string().min(1).max(4096) });

async function supabaseRequest(
  options: SupabaseAuthOptions,
  path: string,
  init: RequestInit,
  key: string,
): Promise<Response> {
  if (!options.url) throw new Error('AUTH_PROVIDER_NOT_CONFIGURED');
  return await fetch(new URL(path, options.url), {
    ...init,
    headers: {
      apikey: key,
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
}

export function createSystemRoutes(options: SupabaseAuthOptions): FastifyPluginAsync {
  return async (app) => {
    app.get('/api/config', async () => ({
      productName: 'ABoss Invoicing',
      environment: process.env.NODE_ENV ?? 'development',
    }));

    app.get('/api/system/setup/status', async () => ({
      setupRequired: false,
    }));

    app.post('/api/auth/sign-in', async (request, reply) => {
      const key = options.anonKey;
      if (!key) throw new Error('AUTH_PROVIDER_NOT_CONFIGURED');
      const body = credentialsSchema.parse(request.body);
      const response = await supabaseRequest(
        options,
        '/auth/v1/token?grant_type=password',
        { method: 'POST', body: JSON.stringify(body) },
        key,
      );
      const payload = (await response.json()) as Record<string, unknown>;
      if (!response.ok) {
        app.log.warn(
          {
            event: 'auth.provider_sign_in_rejected',
            providerHost: new URL(options.url!).hostname,
            providerStatus: response.status,
            providerCode:
              typeof payload.error_code === 'string'
                ? payload.error_code
                : typeof payload.code === 'string'
                  ? payload.code
                  : 'UNKNOWN',
          },
          'authentication provider rejected sign-in',
        );
        return reply.code(401).send({ message: 'Invalid email or password' });
      }
      return reply.send(payload);
    });

    app.post('/api/auth/refresh', async (request, reply) => {
      const key = options.anonKey;
      if (!key) throw new Error('AUTH_PROVIDER_NOT_CONFIGURED');
      const body = refreshSchema.parse(request.body);
      const response = await supabaseRequest(
        options,
        '/auth/v1/token?grant_type=refresh_token',
        { method: 'POST', body: JSON.stringify({ refresh_token: body.refreshToken }) },
        key,
      );
      const payload = await response.json();
      if (!response.ok) return reply.code(401).send({ message: 'Session expired' });
      return reply.send(payload);
    });

    app.post('/api/auth/sign-out', async (request, reply) => {
      const key = options.anonKey;
      const authorization = request.headers.authorization;
      if (key && authorization) {
        await supabaseRequest(
          options,
          '/auth/v1/logout',
          { method: 'POST', headers: { authorization } },
          key,
        ).catch(() => undefined);
      }
      return reply.code(204).send();
    });

    app.get('/api/auth/me', async (request) => {
      const user = await app.db.getUserById(request.auth.userId);
      if (!user) throw new Error('AUTH_UNAUTHENTICATED');
      return {
        user,
        permissions: { isAdmin: request.auth.isAdmin, canWrite: request.auth.canWrite },
      };
    });
  };
}
