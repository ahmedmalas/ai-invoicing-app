import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyPluginAsync } from 'fastify';

import { createBuildIdentity, formatBuildIdentityLog } from '../build-identity.js';

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
  'invoice-number.js': new URL('../../public/invoice-number.js', import.meta.url),
  'invoice-model.js': new URL('../../public/invoice-model.js', import.meta.url),
  'invoice-api.js': new URL('../../public/invoice-api.js', import.meta.url),
  'invoice-editor.js': new URL('../../public/invoice-editor.js', import.meta.url),
  'logo-studio-ui.js': new URL('../../public/logo-studio-ui.js', import.meta.url),
  'launch-app.js': new URL('../../public/launch-app.js', import.meta.url),
  'auth-controls.css': new URL('../../public/auth-controls.css', import.meta.url),
  'auth-controls.js': new URL('../../public/auth-controls.js', import.meta.url),
  'favicon.svg': new URL('../../public/favicon.svg', import.meta.url),
} as const;

const DELETED_LEGACY_ASSETS = [
  'invoice-workspace.js',
  'invoice-curtain.js',
  'invoice-draft-persistence.js',
] as const;

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

function buildIdentity() {
  return createBuildIdentity(process.env);
}

function assetVersion(): string {
  const identity = buildIdentity();
  return identity.appCommitSha.slice(0, 12);
}

function renderShellHtml(): string {
  const identity = buildIdentity();
  const version = assetVersion();
  const html = asset('index.html');
  const stamped = html
    .replaceAll('/assets/styles.css', `/assets/styles.css?v=${version}`)
    .replaceAll('/assets/auth-controls.css', `/assets/auth-controls.css?v=${version}`)
    .replaceAll('/assets/launch-app.js', `/assets/launch-app.js?v=${version}`)
    .replaceAll('/assets/auth-controls.js', `/assets/auth-controls.js?v=${version}`)
    .replace(
      '</head>',
      [
        `<meta name="aleya-app-commit" content="${identity.appCommitSha}">`,
        `<meta name="aleya-app-build" content="${identity.appBuildId}">`,
        `<meta name="aleya-invoice-ui" content="${identity.invoiceUiVersion}">`,
        `<meta name="aleya-invoice-pathway" content="${identity.invoicePathway}">`,
        `<script type="module" src="/assets/build-identity.js?v=${version}"></script>`,
        '</head>',
      ].join('\n    '),
    );
  return stamped;
}

function buildIdentityModuleSource(): string {
  const identity = buildIdentity();
  const logLine = formatBuildIdentityLog(identity);
  return (
    `export const APP_COMMIT_SHA = ${JSON.stringify(identity.appCommitSha)};\n` +
    `export const APP_BUILD_ID = ${JSON.stringify(identity.appBuildId)};\n` +
    `export const INVOICE_UI_VERSION = ${JSON.stringify(identity.invoiceUiVersion)};\n` +
    `export const INVOICE_PATHWAY = ${JSON.stringify(identity.invoicePathway)};\n` +
    `export const BUILD_IDENTITY = Object.freeze(${JSON.stringify(identity)});\n` +
    `if (typeof window !== 'undefined') {\n` +
    `  window.__ALEYA_BUILD__ = BUILD_IDENTITY;\n` +
    `  console.info(${JSON.stringify(logLine)});\n` +
    `  // Hard fail if a stale tab somehow still loads deleted legacy invoice scripts.\n` +
    `  const legacy = ['/assets/invoice-workspace.js','/assets/invoice-curtain.js','/assets/invoice-draft-persistence.js'];\n` +
    `  for (const href of legacy) {\n` +
    `    if ([...document.scripts].some((node) => String(node.src || '').includes(href))) {\n` +
    `      console.error('[Aleya build] Legacy invoice script detected:', href);\n` +
    `    }\n` +
    `  }\n` +
    `}\n`
  );
}

function sendJs(reply: { type: (v: string) => { header: (n: string, v: string) => { send: (v: string) => unknown } } }, body: string) {
  return reply
    .type('application/javascript; charset=utf-8')
    .header('Cache-Control', 'no-cache, no-store, must-revalidate')
    .header('Pragma', 'no-cache')
    .send(body);
}

export const frontendRoutes: FastifyPluginAsync = async (app) => {
  for (const legacy of DELETED_LEGACY_ASSETS) {
    app.get(`/assets/${legacy}`, async (_request, reply) =>
      reply
        .code(410)
        .type('application/json; charset=utf-8')
        .header('Cache-Control', 'no-store')
        .send({
          status: 410,
          code: 'LEGACY_INVOICE_ASSET_REMOVED',
          message:
            `${legacy} was deleted. Use invoice-model.js + invoice-api.js + invoice-editor.js ` +
            `(invoice UI ${buildIdentity().invoiceUiVersion}).`,
          build: buildIdentity(),
        }),
    );
  }

  app.get('/assets/build-identity.js', async (_request, reply) =>
    sendJs(reply, buildIdentityModuleSource()),
  );

  app.get('/assets/styles.css', async (_request, reply) =>
    reply
      .type('text/css; charset=utf-8')
      .header('Cache-Control', 'no-cache, no-store, must-revalidate')
      .send(asset('styles.css')),
  );
  app.get('/assets/auth-controls.css', async (_request, reply) =>
    reply
      .type('text/css; charset=utf-8')
      .header('Cache-Control', 'no-cache, no-store, must-revalidate')
      .send(asset('auth-controls.css')),
  );
  app.get('/assets/app.js', async (_request, reply) => sendJs(reply, asset('app.js')));
  app.get('/assets/form-interaction-guards.js', async (_request, reply) =>
    sendJs(reply, asset('form-interaction-guards.js')),
  );
  app.get('/assets/business-profile-readiness.js', async (_request, reply) =>
    sendJs(reply, asset('business-profile-readiness.js')),
  );
  app.get('/assets/invoice-totals.js', async (_request, reply) =>
    sendJs(reply, asset('invoice-totals.js')),
  );
  app.get('/assets/invoice-number.js', async (_request, reply) =>
    sendJs(reply, asset('invoice-number.js')),
  );
  app.get('/assets/invoice-model.js', async (_request, reply) =>
    sendJs(reply, asset('invoice-model.js')),
  );
  app.get('/assets/invoice-api.js', async (_request, reply) => sendJs(reply, asset('invoice-api.js')));
  app.get('/assets/invoice-editor.js', async (_request, reply) =>
    sendJs(reply, asset('invoice-editor.js')),
  );
  app.get('/assets/logo-studio-ui.js', async (_request, reply) =>
    sendJs(reply, asset('logo-studio-ui.js')),
  );
  app.get('/assets/launch-app.js', async (_request, reply) => {
    const version = assetVersion();
    const source = asset('launch-app.js').replace(
      "application.src = '/assets/app.js';",
      `application.src = '/assets/app.js?v=${version}';`,
    );
    return sendJs(reply, source);
  });
  app.get('/assets/auth-controls.js', async (_request, reply) =>
    sendJs(reply, asset('auth-controls.js')),
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
      .header('Cache-Control', 'no-cache, no-store, must-revalidate')
      .header('Pragma', 'no-cache')
      .send(renderShellHtml());
  for (const path of [
    '/',
    '/sign-in',
    '/create-account',
    '/setup-workspace',
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
