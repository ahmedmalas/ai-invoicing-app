import { config } from 'dotenv';
import { z } from 'zod';

config();

const envSchema = z
  .object({
    PORT: z.coerce.number().int().positive().default(3000),
    DB_PATH: z.string().min(1).optional(),
    DATABASE_URL: z.string().url().optional(),
    DB_POOL_MAX: z.coerce.number().int().min(1).max(20).default(5),
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    LOG_LEVEL: z
      .enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'])
      .default('info'),
    SERVICE_NAME: z.string().min(1).default('ai-business-os'),
    ORGANIZATION_ID: z.string().min(1).default('single-tenant'),
    DB_BUSY_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(5000),
    ENABLE_STRUCTURED_LOGGING: z
      .enum(['0', '1'])
      .default('1')
      .transform((value) => value === '1'),
    CORS_ORIGIN: z
      .string()
      .url()
      .refine((value) => new URL(value).origin === value, 'CORS_ORIGIN must be a URL origin')
      .default('https://ai-invoicing-app.vercel.app'),
    PUBLIC_APP_URL: z
      .string()
      .url()
      .refine((value) => new URL(value).origin === value, 'PUBLIC_APP_URL must be a URL origin')
      .default('https://ai-invoicing-app.vercel.app'),
    REQUEST_BODY_LIMIT: z.coerce.number().int().min(1024).max(15_728_640).default(5_242_880),
    ABOSS_INTEGRATION_SECRET: z.string().min(32).optional(),
    ABOSS_INTEGRATION_ACTOR_USER_ID: z.string().uuid().optional(),
    ABOSS_ALLOWED_ORGANIZATION_ID: z.string().uuid().optional(),
    ABOSS_ONLY_AUTH: z.enum(['0', '1']).default('0').transform((value) => value === '1'),
    SUPABASE_URL: z.string().trim().url().optional(),
    SUPABASE_ANON_KEY: z.string().trim().min(1).optional(),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().trim().min(1).optional(),
    SUPABASE_PUBLISHABLE_KEY: z.string().trim().min(1).optional(),
    ENABLE_BROWSER_APP: z.enum(['0', '1']).default('0').transform((value) => value === '1'),
  })
  .superRefine((value, context) => {
    if (value.NODE_ENV === 'production' && value.DATABASE_URL === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['DATABASE_URL'],
        message: 'DATABASE_URL is required in production',
      });
    }
    if (value.NODE_ENV === 'production' && value.DB_PATH !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['DB_PATH'],
        message: 'DB_PATH is not supported in production',
      });
    }
    if (value.NODE_ENV === 'production' && value.ABOSS_ONLY_AUTH) {
      for (const [path, configured] of [
        ['ABOSS_INTEGRATION_SECRET', value.ABOSS_INTEGRATION_SECRET],
        ['ABOSS_INTEGRATION_ACTOR_USER_ID', value.ABOSS_INTEGRATION_ACTOR_USER_ID],
      ] as const) {
        if (!configured) context.addIssue({ code: 'custom', path: [path], message: `${path} is required when ABOSS_ONLY_AUTH=1` });
      }
    }
    if (value.NODE_ENV === 'production' && value.ENABLE_BROWSER_APP && value.SUPABASE_URL === undefined) {
      context.addIssue({ code: 'custom', path: ['SUPABASE_URL'], message: 'SUPABASE_URL is required in production' });
    }
    if (
      value.NODE_ENV === 'production' &&
      value.ENABLE_BROWSER_APP &&
      value.SUPABASE_ANON_KEY === undefined &&
      value.NEXT_PUBLIC_SUPABASE_ANON_KEY === undefined &&
      value.SUPABASE_PUBLISHABLE_KEY === undefined
    ) {
      context.addIssue({ code: 'custom', path: ['SUPABASE_ANON_KEY'], message: 'A Supabase public key is required in production' });
    }
  });

export type RuntimeEnv = z.infer<typeof envSchema>;

export function parseEnv(input: NodeJS.ProcessEnv): RuntimeEnv {
  return envSchema.parse({
    ...input,
    DATABASE_URL: input.DATABASE_URL?.trim() || input.POSTGRES_URL,
  });
}

export const env = parseEnv(process.env);
