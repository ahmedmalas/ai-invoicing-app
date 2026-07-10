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
      .default('http://localhost:3000'),
    REQUEST_BODY_LIMIT: z.coerce.number().int().min(1024).max(10_485_760).default(1_048_576),
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
  });

export type RuntimeEnv = z.infer<typeof envSchema>;

export function parseEnv(input: NodeJS.ProcessEnv): RuntimeEnv {
  return envSchema.parse(input);
}

export const env = parseEnv(process.env);
