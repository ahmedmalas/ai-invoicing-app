/**
 * Prepare /public/assets for Vercel CDN filesystem serving.
 *
 * Browser URLs are /assets/<file>, but source files live in /public/<file>.
 * Without this copy, vercel.json's catch-all rewrite sends every asset through
 * the Node function (no CDN cache). Build stamps versioned URLs into index.html
 * and launch-app.js so long-cache headers stay safe.
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = join(root, 'public');
const assetsDir = join(publicDir, 'assets');

const STATIC_FILES = [
  'styles.css',
  'auth-controls.css',
  'app.js',
  'form-interaction-guards.js',
  'business-profile-readiness.js',
  'invoice-totals.js',
  'invoice-number.js',
  'invoice-model.js',
  'invoice-api.js',
  'invoice-line-keyboard.js',
  'invoice-line-clipboard.js',
  'invoice-editor.js',
  'invoice-templates-ui.js',
  'aleya-ai-ui.js',
  'banking-ui.js',
  'logo-studio-ui.js',
  'launch-app.js',
  'auth-controls.js',
  'favicon.svg',
];

const commit =
  String(process.env.VERCEL_GIT_COMMIT_SHA || process.env.APP_COMMIT_SHA || process.env.COMMIT_SHA || '')
    .trim() || 'local-dev';
const buildId =
  String(process.env.VERCEL_DEPLOYMENT_ID || process.env.APP_BUILD_ID || process.env.BUILD_ID || '')
    .trim() || 'local-dev';
const version = commit.slice(0, 12);

mkdirSync(assetsDir, { recursive: true });

for (const file of STATIC_FILES) {
  const source = join(publicDir, file);
  if (!existsSync(source)) {
    console.warn(`[prepare-cdn-assets] skip missing ${file}`);
    continue;
  }
  if (file === 'launch-app.js') {
    const sourceText = readFileSync(source, 'utf8').replace(
      "application.src = '/assets/app.js';",
      `application.src = '/assets/app.js?v=${version}';`,
    );
    writeFileSync(join(assetsDir, file), sourceText);
    continue;
  }
  copyFileSync(source, join(assetsDir, file));
}

const identity = {
  appCommitSha: commit,
  appBuildId: buildId,
  invoiceUiVersion: 'canonical-v3',
  invoicePathway: 'canonical-state-payload-api',
};
const identityModule =
  `export const buildIdentity = ${JSON.stringify(identity)};\n` +
  `export const APP_COMMIT_SHA = ${JSON.stringify(identity.appCommitSha)};\n` +
  `export const APP_BUILD_ID = ${JSON.stringify(identity.appBuildId)};\n` +
  `export const INVOICE_UI_VERSION = ${JSON.stringify(identity.invoiceUiVersion)};\n` +
  `export const INVOICE_PATHWAY = ${JSON.stringify(identity.invoicePathway)};\n` +
  `export const BUILD_IDENTITY = Object.freeze(buildIdentity);\n` +
  `if (typeof window !== 'undefined') {\n` +
  `  window.__ALEYA_BUILD__ = BUILD_IDENTITY;\n` +
  `  console.info(${JSON.stringify(
    `[Aleya build] commit=${identity.appCommitSha} build=${identity.appBuildId} invoiceUI=${identity.invoiceUiVersion} pathway=${identity.invoicePathway}`,
  )});\n` +
  `}\n`;
writeFileSync(join(assetsDir, 'build-identity.js'), identityModule);

// On Vercel only: stamp index.html so CDN-cached assets bust per deploy.
// Local builds leave the tracked index.html untouched.
if (process.env.VERCEL === '1') {
  const indexPath = join(publicDir, 'index.html');
  if (existsSync(indexPath)) {
    let html = readFileSync(indexPath, 'utf8');
    html = html
      .replace(/\/assets\/styles\.css(\?v=[^"']*)?/g, `/assets/styles.css?v=${version}`)
      .replace(
        /\/assets\/auth-controls\.css(\?v=[^"']*)?/g,
        `/assets/auth-controls.css?v=${version}`,
      )
      .replace(/\/assets\/launch-app\.js(\?v=[^"']*)?/g, `/assets/launch-app.js?v=${version}`)
      .replace(
        /\/assets\/auth-controls\.js(\?v=[^"']*)?/g,
        `/assets/auth-controls.js?v=${version}`,
      );
    if (!html.includes('build-identity.js')) {
      html = html.replace(
        '</head>',
        `    <script type="module" src="/assets/build-identity.js?v=${version}"></script>\n  </head>`,
      );
    } else {
      html = html.replace(
        /\/assets\/build-identity\.js(\?v=[^"']*)?/g,
        `/assets/build-identity.js?v=${version}`,
      );
    }
    writeFileSync(indexPath, html);
  }
}

console.info(
  JSON.stringify({
    event: 'cdn.assets.prepared',
    version,
    files: STATIC_FILES.length + 1,
    assetsDir,
  }),
);
