import { config } from 'dotenv';
import { z } from 'zod';

config();

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  DB_PATH: z.string().default('./data/slice1.db'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']).default('info'),
  SERVICE_NAME: z.string().min(1).default('ai-business-os'),
  DB_BUSY_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(5000),
  ENABLE_STRUCTURED_LOGGING: z
    .enum(['0', '1'])
    .default('1')
    .transform((value) => value === '1'),
});

export const env = envSchema.parse(process.env);
