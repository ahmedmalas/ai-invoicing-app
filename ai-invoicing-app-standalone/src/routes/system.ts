import { z } from 'zod';
import type { FastifyPluginAsync } from 'fastify';

export interface SupabaseAuthOptions {
  url?: string | undefined;
  anonKey?: string | undefined;
  serviceRoleKey?: string | undefined;
}

const credentialsSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(12).max(128),
});
const setupSchema = credentialsSchema.extend({
  displayName: z.string().trim().min(2).max(120),
});
const refreshSchema = z.object({ refreshToken: z.string().min(20) });

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
  const setupAttempts = new Map<string, { count: number; resetAt: number }>();
  return async (app) => {
    app.get('/api/config', async () => ({
      productName: 'ABoss Invoicing',
      environment: process.env.NODE_ENV ?? 'development',
    }));

    app.get('/api/system/setup/status', async () => ({
      setupRequired: (await app.db.listUsers({ limit: 1 })).length === 0,
    }));

    app.post('/api/system/setup', async (request, reply) => {
      const key = options.serviceRoleKey;
      if (!key) throw new Error('AUTH_PROVIDER_NOT_CONFIGURED');
      const now = Date.now();
      const address = request.ip;
      const current = setupAttempts.get(address);
      const windowState =
        !current || current.resetAt <= now ? { count: 0, resetAt: now + 15 * 60_000 } : current;
      windowState.count += 1;
      setupAttempts.set(address, windowState);
      if (windowState.count > 5) {
        request.log.warn({ event: 'owner_setup_rejected', reason: 'rate_limited' });
        return reply.code(429).send({ message: 'Too many setup attempts' });
      }
      if ((await app.db.listUsers({ limit: 1 })).length > 0) {
        request.log.warn({ event: 'owner_setup_rejected', reason: 'already_initialized' });
        return reply.code(409).send({ message: 'OWNER_ALREADY_PROVISIONED' });
      }

      const body = setupSchema.parse(request.body);
      const authResponse = await supabaseRequest(
        options,
        '/auth/v1/admin/users',
        {
          method: 'POST',
          body: JSON.stringify({
            email: body.email,
            password: body.password,
            email_confirm: true,
            user_metadata: { display_name: body.displayName },
          }),
        },
        key,
      );
      const authPayload = (await authResponse.json()) as {
        id?: string;
        msg?: string;
        message?: string;
      };
      if (!authResponse.ok || !authPayload.id) {
        request.log.warn({ event: 'owner_setup_rejected', reason: 'auth_provider_rejected' });
        return reply
          .code(authResponse.status >= 400 && authResponse.status < 500 ? 409 : 502)
          .send({
            message: 'Owner authentication account could not be created',
          });
      }

      try {
        await app.db.provisionOwner({
          id: authPayload.id,
          displayName: body.displayName,
          email: body.email,
        });
      } catch (error) {
        await supabaseRequest(
          options,
          `/auth/v1/admin/users/${encodeURIComponent(authPayload.id)}`,
          { method: 'DELETE' },
          key,
        ).catch(() => undefined);
        throw error;
      }
      request.log.info({ event: 'owner_setup_provisioned' });
      return reply.code(201).send({ provisioned: true });
    });

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
      const payload = await response.json();
      if (!response.ok) return reply.code(401).send({ message: 'Invalid email or password' });
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
