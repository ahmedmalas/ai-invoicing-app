/**
 * Cold-start probe for a deployed preview/production URL.
 *
 * Usage:
 *   PREVIEW_BASE_URL=https://....vercel.app \
 *   VERCEL_AUTOMATION_BYPASS_SECRET=... \
 *   node scripts/verify-preview-cold-start.mjs
 *
 * Optionally set VERCEL_SHARE_TOKEN for ?_vercel_share= links
 * (required when the preview has Vercel Authentication enabled).
 *
 * Uses curl so Vercel share/bypass cookies persist across redirects
 * (Node fetch does not keep a cookie jar across SSO redirects).
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const base = (process.env.PREVIEW_BASE_URL || '').replace(/\/$/, '');
const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET || '';
const share = process.env.VERCEL_SHARE_TOKEN || '';

if (!base) {
  console.error('PREVIEW_BASE_URL is required');
  process.exit(2);
}

const jarDir = mkdtempSync(join(tmpdir(), 'preview-cold-start-'));
const jarPath = join(jarDir, 'cookies.txt');
writeFileSync(jarPath, '');

function buildUrl(path, { includeShare = false } = {}) {
  const url = new URL(path, base + '/');
  if (bypass) url.searchParams.set('x-vercel-protection-bypass', bypass);
  if (includeShare && share) url.searchParams.set('_vercel_share', share);
  if (bypass) url.searchParams.set('x-vercel-set-bypass-cookie', 'true');
  return url.toString();
}

function curlFetch(url, { timeoutMs = 45_000 } = {}) {
  const bodyPath = join(jarDir, `body-${Date.now()}-${Math.random().toString(16).slice(2)}.txt`);
  const started = Date.now();
  const result = spawnSync(
    'curl',
    [
      '-sS',
      '-L',
      '--max-time',
      String(Math.ceil(timeoutMs / 1000)),
      '-c',
      jarPath,
      '-b',
      jarPath,
      '-o',
      bodyPath,
      '-w',
      '%{http_code}\n%{url_effective}',
      ...(bypass
        ? ['-H', `x-vercel-protection-bypass: ${bypass}`, '-H', 'x-vercel-set-bypass-cookie: true']
        : []),
      url,
    ],
    { encoding: 'utf8' },
  );
  const ms = Date.now() - started;
  if (result.error) {
    return { status: 0, ms, error: result.error.message, body: '', finalUrl: url };
  }
  if (result.status !== 0) {
    return {
      status: 0,
      ms,
      error: (result.stderr || result.stdout || 'curl failed').trim(),
      body: '',
      finalUrl: url,
    };
  }
  const [statusLine = '0', finalUrl = url] = String(result.stdout || '').trim().split('\n');
  let body = '';
  try {
    body = readFileSync(bodyPath, 'utf8').slice(0, 240);
  } catch {
    body = '';
  }
  return { status: Number(statusLine) || 0, ms, body, finalUrl };
}

function establishShareSession() {
  if (!share && !bypass) return;
  const home = curlFetch(buildUrl('/', { includeShare: true }));
  console.log('shareSession', { status: home.status, ms: home.ms, finalUrl: home.finalUrl });
}

function timedFetch(path) {
  const result = curlFetch(buildUrl(path));
  return { path, ...result };
}

const report = { ok: false, base, probes: [] };

function cleanup() {
  try {
    rmSync(jarDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

try {
  establishShareSession();

  const live1 = timedFetch('/health/live');
  report.probes.push(live1);
  console.log('probe1', live1);

  const live2 = timedFetch('/health/live');
  report.probes.push(live2);
  console.log('probe2', live2);

  const ready = timedFetch('/health/ready');
  report.probes.push(ready);
  console.log('ready', { status: ready.status, ms: ready.ms, body: ready.body });

  const editor = timedFetch('/assets/invoice-editor.js');
  report.probes.push(editor);
  console.log('editor', { status: editor.status, ms: editor.ms, snippet: editor.body?.slice(0, 80) });

  const oldAsset = timedFetch('/assets/invoice-workspace.js');
  report.probes.push(oldAsset);
  console.log('oldAsset', { status: oldAsset.status, ms: oldAsset.ms });

  const blockedBySso =
    report.probes.some((p) => p.status === 401 || p.status === 403) ||
    report.probes.some(
      (p) =>
        /vercel\.com\/(login|sso)/i.test(p.finalUrl || '') ||
        /Authentication Required|vercel\.com\/login/i.test(p.body || ''),
    );
  const timedOut = report.probes.some(
    (p) =>
      p.status === 504 ||
      /FUNCTION_INVOCATION_TIMEOUT|timed?\s*out|ETIMEDOUT|abort/i.test(p.error || '') ||
      /FUNCTION_INVOCATION_TIMEOUT|Gateway Timeout/i.test(p.body || ''),
  );
  const liveOk = live1.status === 200 && live2.status === 200 && /"status"\s*:\s*"ok"/.test(live1.body || '');
  const readyOk = ready.status === 200 && /"status"\s*:\s*"ready"/.test(ready.body || '');
  const editorOk =
    editor.status === 200 && /createInvoiceEditor|data-invoice-field|INVOICE_EDITOR_STORAGE_KEY/.test(editor.body || '');
  const oldGone =
    oldAsset.status === 404 || (oldAsset.status === 200 && !/mountInvoiceWorkspace/.test(oldAsset.body || ''));

  report.ok = liveOk && readyOk && editorOk && !timedOut && !blockedBySso;
  report.checks = {
    liveOk,
    readyOk,
    editorOk,
    oldGone,
    timedOut,
    blockedBySso,
    coldStartMs: live1.ms,
    warmMs: live2.ms,
  };
  console.log(JSON.stringify(report, null, 2));
  cleanup();
  if (!report.ok) process.exit(1);
} catch (error) {
  cleanup();
  console.error(error);
  process.exit(1);
}
