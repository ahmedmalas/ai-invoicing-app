/**
 * Cold-start probe for a deployed preview/production URL.
 *
 * Usage:
 *   PREVIEW_BASE_URL=https://....vercel.app \
 *   VERCEL_AUTOMATION_BYPASS_SECRET=... \
 *   node scripts/verify-preview-cold-start.mjs
 *
 * Optionally set VERCEL_SHARE_TOKEN for ?_vercel_share= links.
 */
const base = (process.env.PREVIEW_BASE_URL || '').replace(/\/$/, '');
const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET || '';
const share = process.env.VERCEL_SHARE_TOKEN || '';

if (!base) {
  console.error('PREVIEW_BASE_URL is required');
  process.exit(2);
}

function buildUrl(path) {
  const url = new URL(path, base + '/');
  if (bypass) url.searchParams.set('x-vercel-protection-bypass', bypass);
  if (share) url.searchParams.set('_vercel_share', share);
  if (bypass) url.searchParams.set('x-vercel-set-bypass-cookie', 'true');
  return url.toString();
}

async function timedFetch(path, { timeoutMs = 45_000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    const response = await fetch(buildUrl(path), {
      signal: controller.signal,
      redirect: 'manual',
      headers: {
        ...(bypass ? { 'x-vercel-protection-bypass': bypass } : {}),
        ...(bypass ? { 'x-vercel-set-bypass-cookie': 'true' } : {}),
      },
    });
    const text = await response.text();
    return {
      path,
      status: response.status,
      ms: Date.now() - started,
      location: response.headers.get('location'),
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
  // First hit is the true cold start.
  const live1 = await timedFetch('/api/health/live');
  report.probes.push(live1);
  console.log('probe1', live1);

  // Immediate second hit should be warm / cached isolate.
  const live2 = await timedFetch('/api/health/live');
  report.probes.push(live2);
  console.log('probe2', live2);

  const editor = await timedFetch('/assets/invoice-editor.js');
  report.probes.push(editor);
  console.log('editor', { status: editor.status, ms: editor.ms, snippet: editor.body?.slice(0, 80) });

  const oldAsset = await timedFetch('/assets/invoice-workspace.js');
  report.probes.push(oldAsset);
  console.log('oldAsset', { status: oldAsset.status, ms: oldAsset.ms });

  const blockedBySso =
    report.probes.some((p) => p.status === 401 || p.status === 403) ||
    report.probes.some((p) => (p.location || '').includes('vercel.com/sso') || (p.location || '').includes('/login'));
  const timedOut = report.probes.some((p) => p.status === 504 || /timeout/i.test(p.error || '') || /timeout/i.test(p.body || ''));
  const liveOk = live1.status === 200 && live2.status === 200;
  const editorOk = editor.status === 200 && /createInvoiceEditor|data-invoice-editor/.test(editor.body || '');
  const oldGone = oldAsset.status === 404 || oldAsset.status === 200 && !/mountInvoiceWorkspace/.test(oldAsset.body || '');

  report.ok = liveOk && editorOk && !timedOut && !blockedBySso;
  report.checks = { liveOk, editorOk, oldGone, timedOut, blockedBySso, coldStartMs: live1.ms, warmMs: live2.ms };
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
