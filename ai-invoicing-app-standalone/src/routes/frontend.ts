import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyPluginAsync } from 'fastify';

const tracedAssets = {
  'index.html': new URL('../../public/index.html', import.meta.url),
  'styles.css': new URL('../../public/styles.css', import.meta.url),
  'app.js': new URL('../../public/app.js', import.meta.url),
  'favicon.svg': new URL('../../public/favicon.svg', import.meta.url),
} as const;

function asset(name: keyof typeof tracedAssets): string {
  const candidates = [
    fileURLToPath(tracedAssets[name]),
    join(process.cwd(), 'public', name),
    join(process.cwd(), 'ai-invoicing-app-standalone', 'public', name),
  ];
  for (const candidate of candidates) {
    try {
      return readFileSync(candidate, 'utf8');
    } catch {
      continue;
    }
  }
  throw new Error('FRONTEND_ASSET_UNAVAILABLE');
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
    '/dashboard',
    '/workspace/customers',
    '/workspace/quotes',
    '/workspace/invoices',
    '/workspace/payments',
    '/reports',
    '/timeline',
    '/settings',
  ]) {
    app.get(path, shell);
  }
};
