import { createServer, type Server } from 'node:http';

import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { createVercelHandler } from '../../api/index.js';
import { buildApp } from '../../src/app.js';

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Unable to resolve test server address');
  }
  return `http://127.0.0.1:${address.port}`;
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

describe('Vercel Node runtime handler', () => {
  let app: FastifyInstance | undefined;
  let server: Server | undefined;

  afterEach(async () => {
    if (server !== undefined) {
      await closeServer(server);
    }
    if (app !== undefined) {
      await app.close();
    }
  });

  it('lazily initializes once and handles real concurrent Node requests without listening', async () => {
    let builds = 0;
    const handler = createVercelHandler(async () => {
      builds += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      app = await buildApp({
        dbPath: ':memory:',
        nodeEnv: 'test',
        authBypassForTesting: true,
        corsOrigin: 'https://app.example.com',
        requestBodyLimit: 1024,
      });
      return app;
    });
    server = createServer((request, response) => {
      void handler(request, response);
    });
    const baseUrl = await listen(server);

    const [health, live, ready] = await Promise.all([
      fetch(`${baseUrl}/health?token=must-not-affect-routing`),
      fetch(`${baseUrl}/health/live`),
      fetch(`${baseUrl}/health/ready`),
    ]);

    expect([health.status, live.status, ready.status]).toEqual([200, 200, 200]);
    expect(builds).toBe(1);
    expect(app?.server.listening).toBe(false);
    expect(health.headers.get('x-content-type-options')).toBe('nosniff');
    expect(health.headers.get('content-security-policy')).toContain("default-src 'self'");
  });

  it('allows only the configured CORS origin and enforces the request body limit', async () => {
    const handler = createVercelHandler(async () => {
      app = await buildApp({
        dbPath: ':memory:',
        nodeEnv: 'test',
        authBypassForTesting: true,
        corsOrigin: 'https://app.example.com',
        requestBodyLimit: 1024,
      });
      return app;
    });
    server = createServer((request, response) => {
      void handler(request, response);
    });
    const baseUrl = await listen(server);

    const preflight = await fetch(`${baseUrl}/customers`, {
      method: 'OPTIONS',
      headers: {
        origin: 'https://app.example.com',
        'access-control-request-method': 'POST',
      },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBe('https://app.example.com');

    const oversized = await fetch(`${baseUrl}/customers`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'https://untrusted.example.com',
      },
      body: JSON.stringify({ displayName: 'x'.repeat(2048) }),
    });
    expect(oversized.status).toBe(413);
    expect(oversized.headers.get('access-control-allow-origin')).toBe('https://app.example.com');
  });

  it('returns a sanitized response when initialization fails', async () => {
    const handler = createVercelHandler(() =>
      Promise.reject(new Error('postgresql://secret-user:secret-password@host/database')),
    );
    server = createServer((request, response) => {
      void handler(request, response);
    });
    const baseUrl = await listen(server);

    const response = await fetch(`${baseUrl}/health`);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      status: 500,
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Internal server error',
    });
  });
});
