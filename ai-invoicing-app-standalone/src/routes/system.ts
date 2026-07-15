import { z } from 'zod';
import type { FastifyPluginAsync } from 'fastify';

export interface SupabaseAuthOptions {
  url?: string | undefined;
  anonKey?: string | undefined;
  publicAppUrl?: string | undefined;
}

const passwordSchema = z
  .string()
  .min(12, 'Password must be at least 12 characters')
  .max(128, 'Password must be no more than 128 characters')
  .regex(/[a-z]/, 'Password must include a lowercase letter')
  .regex(/[A-Z]/, 'Password must include an uppercase letter')
  .regex(/[0-9]/, 'Password must include a number');
const credentialsSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(12).max(128),
});
const signUpSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    email: z.string().trim().email().transform((email) => email.toLowerCase()),
    password: passwordSchema,
    passwordConfirmation: z.string(),
  })
  .refine((value) => value.password === value.passwordConfirmation, {
    message: 'Passwords do not match',
    path: ['passwordConfirmation'],
  });
const forgotPasswordSchema = z.object({
  email: z.string().trim().email().transform((email) => email.toLowerCase()),
});
const resetPasswordSchema = z
  .object({ password: passwordSchema, passwordConfirmation: z.string() })
  .refine((value) => value.password === value.passwordConfirmation, {
    message: 'Passwords do not match',
    path: ['passwordConfirmation'],
  });
const refreshSchema = z.object({ refreshToken: z.string().min(1).max(4096) });

const neutralRecoveryMessage =
  'If an account exists for that email, a password reset link has been sent.';

function redirectUrl(options: SupabaseAuthOptions, pathname: string): string {
  if (!options.publicAppUrl) throw new Error('PUBLIC_APP_URL_REQUIRED');
  const base = new URL(options.publicAppUrl);
  if (base.protocol !== 'https:' && base.hostname !== 'localhost') {
    throw new Error('PUBLIC_APP_URL_INVALID');
  }
  return new URL(pathname, base).toString();
}

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

async function responsePayload(response: Response): Promise<Record<string, unknown>> {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
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

    app.post('/api/auth/sign-up', async (request, reply) => {
      const key = options.anonKey;
      if (!key) throw new Error('AUTH_PROVIDER_NOT_CONFIGURED');
      const body = signUpSchema.parse(request.body);
      const path = `/auth/v1/signup?redirect_to=${encodeURIComponent(redirectUrl(options, '/auth/callback'))}`;
      const response = await supabaseRequest(
        options,
        path,
        {
          method: 'POST',
          body: JSON.stringify({
            email: body.email,
            password: body.password,
            data: {
              display_name: body.name,
              workspace_name: `${body.name}'s workspace`,
            },
          }),
        },
        key,
      );
      const payload = await responsePayload(response);
      const providerUser = (payload.user ?? payload) as {
        id?: unknown;
        identities?: unknown[] | null;
      };
      const providerCode =
        typeof payload.error_code === 'string'
          ? payload.error_code
          : typeof payload.code === 'string'
            ? payload.code
            : 'UNKNOWN';
      const duplicate =
        providerCode === 'user_already_exists' ||
        providerCode === 'email_exists' ||
        (response.ok && Array.isArray(providerUser?.identities) && providerUser.identities.length === 0);
      if (duplicate) {
        return reply.code(409).send({
          code: 'ACCOUNT_ALREADY_EXISTS',
          message: 'An account already exists for this email. Sign in or reset your password.',
        });
      }
      if (!response.ok || typeof providerUser?.id !== 'string') {
        app.log.warn(
          {
            event: 'auth.provider_sign_up_rejected',
            providerHost: new URL(options.url!).hostname,
            providerStatus: response.status,
            providerCode,
            ...(!response.ok ? {} : { providerPayloadKeys: Object.keys(payload).sort() }),
          },
          'authentication provider rejected sign-up',
        );
        const rateLimited = providerCode === 'over_email_send_rate_limit' || response.status === 429;
        return reply.code(rateLimited ? 429 : 400).send({
          code: rateLimited ? 'SIGN_UP_RATE_LIMITED' : 'SIGN_UP_FAILED',
          message: rateLimited
            ? 'Too many verification emails were requested. Wait a few minutes and try again.'
            : 'We could not create your account. Check your details and try again.',
        });
      }

      await app.db.provisionWorkspaceOwner({
        authUserId: providerUser.id,
        displayName: body.name,
        email: body.email,
        workspaceName: `${body.name}'s workspace`,
      });
      const session =
        (payload.session as Record<string, unknown> | null | undefined) ??
        (typeof payload.access_token === 'string' && typeof payload.refresh_token === 'string'
          ? payload
          : null);
      return reply.code(201).send({
        status: session ? 'active' : 'verification_required',
        message: session
          ? 'Your workspace is ready.'
          : 'Check your email to verify your account, then sign in.',
        ...(session ? { session } : {}),
      });
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
      const payload = await responsePayload(response);
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

    app.post('/api/auth/forgot-password', async (request, reply) => {
      const key = options.anonKey;
      if (!key) throw new Error('AUTH_PROVIDER_NOT_CONFIGURED');
      const body = forgotPasswordSchema.parse(request.body);
      const path = `/auth/v1/recover?redirect_to=${encodeURIComponent(redirectUrl(options, '/reset-password'))}`;
      const response = await supabaseRequest(
        options,
        path,
        { method: 'POST', body: JSON.stringify({ email: body.email }) },
        key,
      ).catch(() => undefined);
      if (response && !response.ok) {
        const payload = await responsePayload(response);
        app.log.warn(
          {
            event: 'auth.provider_recovery_not_sent',
            providerHost: new URL(options.url!).hostname,
            providerStatus: response.status,
            providerCode:
              typeof payload.error_code === 'string' ? payload.error_code : 'UNKNOWN',
          },
          'password recovery request was not sent',
        );
      }
      return reply.code(202).send({ message: neutralRecoveryMessage });
    });

    app.post('/api/auth/reset-password', async (request, reply) => {
      const key = options.anonKey;
      const authorization = request.headers.authorization;
      if (!key) throw new Error('AUTH_PROVIDER_NOT_CONFIGURED');
      if (!authorization?.startsWith('Bearer ')) {
        return reply.code(400).send({
          code: 'RECOVERY_LINK_INVALID',
          message: 'This password reset link is invalid or has expired.',
        });
      }
      const body = resetPasswordSchema.parse(request.body);
      const verify = await supabaseRequest(
        options,
        '/auth/v1/user',
        { method: 'GET', headers: { authorization } },
        key,
      );
      if (!verify.ok) {
        return reply.code(400).send({
          code: 'RECOVERY_LINK_INVALID',
          message: 'This password reset link is invalid or has expired.',
        });
      }
      const update = await supabaseRequest(
        options,
        '/auth/v1/user',
        { method: 'PUT', headers: { authorization }, body: JSON.stringify({ password: body.password }) },
        key,
      );
      if (!update.ok) {
        const payload = await responsePayload(update);
        app.log.warn(
          {
            event: 'auth.provider_password_reset_rejected',
            providerStatus: update.status,
            providerCode:
              typeof payload.error_code === 'string' ? payload.error_code : 'UNKNOWN',
          },
          'authentication provider rejected password reset',
        );
        return reply.code(400).send({
          code: 'RECOVERY_LINK_INVALID',
          message: 'This password reset link is invalid, expired, or has already been used.',
        });
      }
      await supabaseRequest(
        options,
        '/auth/v1/logout?scope=global',
        { method: 'POST', headers: { authorization } },
        key,
      ).catch(() => undefined);
      return reply.send({ message: 'Password updated. Sign in with your new password.' });
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
      const payload = await responsePayload(response);
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
