import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    env: {
      AI_BUSINESS_OS_TEST_AUTH_BYPASS: '1',
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      exclude: [
        'dist/**',
        'eslint.config.mjs',
        'prettier.config.cjs',
        'vitest.config.ts',
        'src/index.ts',
        'src/config/env.ts',
        'src/db/postgres-database.ts',
        'src/types/**',
        'src/domain/documents/interfaces.ts',
      ],
      thresholds: {
        lines: 85,
        functions: 85,
        branches: 75,
        statements: 85,
      },
    },
  },
});
