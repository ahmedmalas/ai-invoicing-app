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
 */
const base = (process.env.PREVIEW_BASE_URL || '').replace(/\/$/, '');
const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET || '';
const share = process.env.VERCEL_SHARE_TOKEN || '';

if (!base) {
  console.error('PREVIEW_BASE_URL is required');
  process.exit(2);
}

/** @type {string[]} */
const cookieJar = [];

function rememberCookies(response) {
  const raw = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
  for (const entry of raw) {
    const pair = String(entry).split(';')[0]?.trim();
    if (!pair) continue;
    const name = pair.split('=')[0];
    const next = cookieJar.filter((item) => !item.startsWith(name + '='));
    next.push(pair);
    cookieJar.length = 0;
    cookieJar.push(...next);
  }
}

function buildUrl(path, { includeShare = false } = {}) {
  const url = new URL(path, base + '/');
  if (bypass) url.searchParams.set('x-vercel-protection-bypass', bypass);
  if (includeShare && share) url.searchParams.set('_vercel_share', share);
  if (bypass) url.searchParams.set('x-vercel-set-bypass-cookie', 'true');
  return url.toString();
}

async function establishShareSession() {
  if (!share && !bypass) return;
  const response = await fetch(buildUrl('/', { includeShare: true }), {
    redirect: 'follow',
    headers: {
      ...(bypass ? { 'x-vercel-protection-bypass': bypass } : {}),
      ...(bypass ? { 'x-vercel-set-bypass-cookie': 'true' } : {}),
    },
  });
  rememberCookies(response);
  await response.arrayBuffer();
}

async function timedFetch(path, { timeoutMs = 45_000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    const response = await fetch(buildUrl(path), {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        ...(bypass ? { 'x-vercel-protection-bypass': bypass } : {}),
        ...(bypass ? { 'x-vercel-set-bypass-cookie': 'true' } : {}),
        ...(cookieJar.length ? { cookie: cookieJar.join('; ') } : {}),
      },
    });
    rememberCookies(response);
    const text = await response.text();
    return {
      path,
      status: response.status,
      ms: Date.now() - started,
      finalUrl: response.url,
      body: text.slice(0, 240),
    };
  } catch (error) {
    return {
      path,
      status: 0,
      ms: Date.now() - started,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

const report = { ok: false, base, probes: [] };

async function main() {
  await establishShareSession();

  // Prefer the public liveness route (not /api/health/live, which requires auth).
  const live1 = await timedFetch('/health/live');
  report.probes.push(live1);
  console.log('probe1', live1);

  const live2 = await timedFetch('/health/live');
  report.probes.push(live2);
  console.log('probe2', live2);

  const ready = await timedFetch('/health/ready');
  report.probes.push(ready);
  console.log('ready', { status: ready.status, ms: ready.ms, body: ready.body });

  const editor = await timedFetch('/assets/invoice-editor.js');
  report.probes.push(editor);
  console.log('editor', { status: editor.status, ms: editor.ms, snippet: editor.body?.slice(0, 80) });

  const oldAsset = await timedFetch('/assets/invoice-workspace.js');
  report.probes.push(oldAsset);
  console.log('oldAsset', { status: oldAsset.status, ms: oldAsset.ms });

  const blockedBySso =
    report.probes.some((p) => p.status === 401 || p.status === 403) ||
    report.probes.some((p) => /vercel\.com\/sso|Authentication Required/i.test(p.body || ''));
  const timedOut = report.probes.some(
    (p) => p.status === 504 || /timeout/i.test(p.error || '') || /timeout/i.test(p.body || ''),
  );
  const liveOk = live1.status === 200 && live2.status === 200 && /"status"\s*:\s*"ok"/.test(live1.body || '');
  const readyOk = ready.status === 200 && /"status"\s*:\s*"ready"/.test(ready.body || '');
  const editorOk = editor.status === 200 && /createInvoiceEditor|data-invoice-editor/.test(editor.body || '');
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
  if (!report.ok) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
