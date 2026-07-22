import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyPluginAsync } from 'fastify';

const tracedAssets = {
  'index.html': new URL('../../public/index.html', import.meta.url),
  'styles.css': new URL('../../public/styles.css', import.meta.url),
  'app.js': new URL('../../public/app.js', import.meta.url),
  'form-interaction-guards.js': new URL('../../public/form-interaction-guards.js', import.meta.url),
  'business-profile-readiness.js': new URL(
    '../../public/business-profile-readiness.js',
    import.meta.url,
  ),
  'invoice-totals.js': new URL('../../public/invoice-totals.js', import.meta.url),
  'invoice-draft-persistence.js': new URL(
    '../../public/invoice-draft-persistence.js',
    import.meta.url,
  ),
  'invoice-title.js': new URL('../../public/invoice-title.js', import.meta.url),
  'invoice-workspace-payload.js': new URL(
    '../../public/invoice-workspace-payload.js',
    import.meta.url,
  ),
  'invoice-workspace.js': new URL('../../public/invoice-workspace.js', import.meta.url),
  'invoice-curtain.js': new URL('../../public/invoice-curtain.js', import.meta.url),
  'logo-studio-ui.js': new URL('../../public/logo-studio-ui.js', import.meta.url),
  'launch-app.js': new URL('../../public/launch-app.js', import.meta.url),
  'auth-controls.css': new URL('../../public/auth-controls.css', import.meta.url),
  'auth-controls.js': new URL('../../public/auth-controls.js', import.meta.url),
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
      // Keep CSS fresh so curtain timing/transform fixes ship immediately on deploy.
      .header('Cache-Control', 'no-cache')
      .send(asset('styles.css')),
  );
  app.get('/assets/auth-controls.css', async (_request, reply) =>
    reply
      .type('text/css; charset=utf-8')
      .header('Cache-Control', 'no-cache')
      .send(asset('auth-controls.css')),
  );
  app.get('/assets/app.js', async (_request, reply) =>
    reply
      .type('application/javascript; charset=utf-8')
      .header('Cache-Control', 'no-cache')
      .send(asset('app.js')),
  );
  app.get('/assets/form-interaction-guards.js', async (_request, reply) =>
    reply
      .type('application/javascript; charset=utf-8')
      .header('Cache-Control', 'no-cache')
      .send(asset('form-interaction-guards.js')),
  );
  app.get('/assets/business-profile-readiness.js', async (_request, reply) =>
    reply
      .type('application/javascript; charset=utf-8')
      .header('Cache-Control', 'no-cache')
      .send(asset('business-profile-readiness.js')),
  );
  app.get('/assets/invoice-totals.js', async (_request, reply) =>
    reply
      .type('application/javascript; charset=utf-8')
      .header('Cache-Control', 'no-cache')
      .send(asset('invoice-totals.js')),
  );
  app.get('/assets/invoice-draft-persistence.js', async (_request, reply) =>
    reply
      .type('application/javascript; charset=utf-8')
      .header('Cache-Control', 'no-cache')
      .send(asset('invoice-draft-persistence.js')),
  );
  app.get('/assets/invoice-title.js', async (_request, reply) =>
    reply
      .type('application/javascript; charset=utf-8')
      .header('Cache-Control', 'no-cache')
      .send(asset('invoice-title.js')),
  );
  app.get('/assets/invoice-workspace-payload.js', async (_request, reply) =>
    reply
      .type('application/javascript; charset=utf-8')
      .header('Cache-Control', 'no-cache')
      .send(asset('invoice-workspace-payload.js')),
  );
  app.get('/assets/invoice-workspace.js', async (_request, reply) =>
    reply
      .type('application/javascript; charset=utf-8')
      .header('Cache-Control', 'no-cache')
      .send(asset('invoice-workspace.js')),
  );
  app.get('/assets/invoice-curtain.js', async (_request, reply) =>
    reply
      .type('application/javascript; charset=utf-8')
      .header('Cache-Control', 'no-cache')
      .send(asset('invoice-curtain.js')),
  );
  app.get('/assets/logo-studio-ui.js', async (_request, reply) =>
    reply
      .type('application/javascript; charset=utf-8')
      .header('Cache-Control', 'no-cache')
      .send(asset('logo-studio-ui.js')),
  );
  app.get('/assets/launch-app.js', async (_request, reply) =>
    reply
      .type('application/javascript; charset=utf-8')
      .header('Cache-Control', 'no-cache')
      .send(asset('launch-app.js')),
  );
  app.get('/assets/auth-controls.js', async (_request, reply) =>
    reply
      .type('application/javascript; charset=utf-8')
      .header('Cache-Control', 'no-cache')
      .send(asset('auth-controls.js')),
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
    '/create-account',
    '/forgot-password',
    '/reset-password',
    '/auth/callback',
    '/dashboard',
    '/workspace/customers',
    '/workspace/quotes',
    '/workspace/invoices',
    '/workspace/invoices/new',
    '/workspace/payments',
    '/workspace/inventory',
    '/workspace/purchase-orders',
    '/workspace/suppliers',
    '/workspace/stocktakes',
    '/reports',
    '/timeline',
    '/settings',
    '/logo-creator',
  ]) {
    app.get(path, shell);
  }
  app.get('/workspace/invoices/:invoiceId/edit', shell);
};
