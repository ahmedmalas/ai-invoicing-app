import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyPluginAsync } from 'fastify';

function asset(name: string): string {
  return readFileSync(join(process.cwd(), 'public', name), 'utf8');
}

export const frontendRoutes: FastifyPluginAsync = async (app) => {
  app.get('/assets/styles.css', async (_request, reply) =>
    reply
      .type('text/css; charset=utf-8')
      .header('Cache-Control', 'public, max-age=3600')
      .send(asset('styles.css')),
  );
  app.get('/assets/app.js', async (_request, reply) =>
    reply
      .type('application/javascript; charset=utf-8')
      .header('Cache-Control', 'no-cache')
      .send(asset('app.js')),
  );
  app.get('/favicon.svg', async (_request, reply) =>
    reply
      .type('image/svg+xml')
      .header('Cache-Control', 'public, max-age=86400')
      .send(asset('favicon.svg')),
  );

  const shell = async (
    _request: unknown,
    reply: {
      type: (value: string) => {
        header: (name: string, value: string) => { send: (value: string) => unknown };
      };
    },
  ) =>
    reply
      .type('text/html; charset=utf-8')
      .header('Cache-Control', 'no-cache')
      .send(asset('index.html'));
  for (const path of [
    '/',
    '/sign-in',
    '/system/setup',
    '/dashboard',
    '/customers',
    '/quotes',
    '/invoices',
    '/payments',
    '/reports',
    '/timeline',
    '/settings',
  ]) {
    app.get(path, shell);
  }
};
