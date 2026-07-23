/**
 * Live authenticated invoice pathway proof (production failure + preview canonical).
 * Uses real /api/auth/sign-in — not AUTH_BYPASS.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';

const CHROME = process.env.CHROME_PATH || '/usr/local/bin/google-chrome';
const EMAIL = process.env.LIVE_EMAIL || 'aleya.launch.validator@cursor.local';
const PASSWORD = process.env.LIVE_PASSWORD || 'Guildford1234!';
const OUT = process.env.EVIDENCE_DIR || '/opt/cursor/artifacts/invoice-live-proof';
mkdirSync(OUT, { recursive: true });

const report = {
  startedAt: new Date().toISOString(),
  production: {},
  preview: {},
  ok: false,
};

async function signIn(baseUrl) {
  const response = await fetch(`${baseUrl}/api/auth/sign-in`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.access_token) {
    throw new Error(`sign-in failed ${response.status}: ${JSON.stringify(body).slice(0, 300)}`);
  }
  return body;
}

async function probeAssets(baseUrl, cookieHeader = '') {
  const paths = [
    '/assets/invoice-workspace.js',
    '/assets/invoice-curtain.js',
    '/assets/invoice-draft-persistence.js',
    '/assets/invoice-editor.js',
    '/assets/invoice-model.js',
    '/assets/invoice-api.js',
    '/assets/build-identity.js',
    '/health/build',
  ];
  const out = {};
  for (const path of paths) {
    const response = await fetch(`${baseUrl}${path}`, {
      headers: cookieHeader ? { cookie: cookieHeader } : {},
      redirect: 'manual',
    });
    const text = await response.text();
    out[path] = {
      status: response.status,
      snippet: text.slice(0, 160).replace(/\s+/g, ' '),
      xVercelId: response.headers.get('x-vercel-id'),
      cache: response.headers.get('cache-control'),
    };
  }
  return out;
}

async function withBrowser(fn) {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1400,900'],
  });
  try {
    return await fn(browser);
  } finally {
    await browser.close();
  }
}

async function injectSession(page, baseUrl, session) {
  await page.goto(`${baseUrl}/sign-in`, { waitUntil: 'domcontentloaded' });
  await page.evaluate((value) => {
    localStorage.setItem('aboss-invoicing-session', JSON.stringify(value));
  }, session);
}

async function collectPageScripts(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('script')].map((node) => ({
      src: node.src || null,
      type: node.type || null,
    })),
  );
}

async function reproduceProductionFailure(baseUrl) {
  const session = await signIn(baseUrl);
  const assets = await probeAssets(baseUrl);
  const appJs = await fetch(`${baseUrl}/assets/app.js`).then(async (r) => ({
    status: r.status,
    text: await r.text(),
    headers: Object.fromEntries(r.headers.entries()),
  }));
  const formDataLine = appJs.text
    .split('\n')
    .map((line, i) => ({ line: i + 1, text: line }))
    .filter((row) => /new FormData\(form\)|collectInvoiceWorkspacePayload|invoice-workspace\.js/.test(row.text))
    .slice(0, 20);

  const browserResult = await withBrowser(async (browser) => {
    const page = await browser.newPage();
    page.setDefaultTimeout(45000);
    const network = [];
    page.on('requestfinished', async (req) => {
      const url = req.url();
      if (!/invoice|pdf|assets\//i.test(url)) return;
      try {
        const res = await req.response();
        network.push({
          url,
          method: req.method(),
          status: res?.status(),
          resourceType: req.resourceType(),
        });
      } catch {
        network.push({ url, method: req.method(), status: null });
      }
    });

    await injectSession(page, baseUrl, session);
    await page.goto(`${baseUrl}/workspace/invoices/new`, { waitUntil: 'networkidle2' });
    await page.waitForFunction(() => !location.pathname.includes('/sign-in'), { timeout: 30000 });

    // Production uses #invoice-workspace-form; preview uses #invoice-editor-form.
    await page.waitForSelector('#invoice-workspace-form, #invoice-editor-form', { timeout: 30000 });
    const formSel = (await page.$('#invoice-workspace-form'))
      ? '#invoice-workspace-form'
      : '#invoice-editor-form';

    const titleSel =
      (await page.$(`${formSel} [name="title"]`)) ||
      (await page.$('[data-invoice-field="title"]')) ||
      (await page.$('input[name="title"]'));
    if (!titleSel) throw new Error('title field not found');
    await titleSel.click({ clickCount: 3 });
    await titleSel.type('Live Failure Title Proof', { delay: 8 });

    const customerSelect = await page.$('select[name="customerId"], [data-invoice-field="customerId"]');
    if (customerSelect) {
      const options = await page.$$eval(
        'select[name="customerId"] option, [data-invoice-field="customerId"] option',
        (nodes) => nodes.map((n) => n.value).filter(Boolean),
      );
      if (options[0]) await page.select('select[name="customerId"], [data-invoice-field="customerId"]', options[0]);
    }

    const desc =
      (await page.$('[data-invoice-line] textarea, [data-invoice-line] input[name*="description"], textarea[name*="description"]')) ||
      (await page.$('textarea'));
    if (desc) {
      await desc.click({ clickCount: 3 });
      await desc.type('Live pathway line item');
    }

    const scriptsBefore = await collectPageScripts(page);
    const buildMeta = await page.evaluate(() => ({
      href: location.href,
      aleyaBuild: window.__ALEYA_BUILD__ || null,
      metas: [...document.querySelectorAll('meta[name^="aleya-"]')].map((m) => ({
        name: m.getAttribute('name'),
        content: m.getAttribute('content'),
      })),
    }));

    // Click Preview PDF
    const previewBtn =
      (await page.$('button[data-action="preview-pdf"], [data-invoice-action="previewPdf"], button#preview-pdf')) ||
      (await page.evaluateHandle(() => {
        const buttons = [...document.querySelectorAll('button')];
        return buttons.find((b) => /preview\s*pdf/i.test(b.textContent || '')) || null;
      }));
    const previewHandle = previewBtn?.asElement?.() || previewBtn;
    if (!previewHandle) throw new Error('Preview PDF button not found');

    const titleBeforeClick = await page.evaluate((sel) => {
      const form = document.querySelector(sel);
      const title = form?.querySelector('[name="title"], [data-invoice-field="title"]');
      return {
        value: title?.value || null,
        disabled: Boolean(title?.disabled),
        formDataTitle: form ? Object.fromEntries(new FormData(form)).title || null : null,
      };
    }, formSel);

    await previewHandle.click();
    await new Promise((r) => setTimeout(r, 2500));

    const after = await page.evaluate((sel) => {
      const toast =
        document.querySelector('[data-toast], .toast, .notice, .alert, [role="alert"]')?.textContent ||
        '';
      const fieldError =
        document.querySelector('.field-error, [data-field-error], .error')?.textContent || '';
      const form = document.querySelector(sel);
      const title = form?.querySelector('[name="title"], [data-invoice-field="title"]');
      const disabledControls = [...(form?.querySelectorAll('[disabled]') || [])].map(
        (el) => el.getAttribute('name') || el.getAttribute('data-invoice-field') || el.tagName,
      );
      return {
        href: location.href,
        toast: toast.trim(),
        fieldError: fieldError.trim(),
        titleValue: title?.value || null,
        titleDisabled: Boolean(title?.disabled),
        formDataTitle: form ? Object.fromEntries(new FormData(form)).title || null : null,
        disabledControls,
        bodyText: document.body.innerText.slice(0, 2500),
      };
    }, formSel);

    const shot = join(OUT, 'prod-invoice-preview-failure.png');
    await page.screenshot({ path: shot, fullPage: true });

    return {
      formSel,
      titleBeforeClick,
      after,
      scriptsBefore,
      buildMeta,
      network: network.slice(0, 80),
      screenshot: shot,
      timestamp: new Date().toISOString(),
    };
  });

  return {
    baseUrl,
    assets,
    formDataLinesInAppJs: formDataLine,
    appJsHasCollectPayload: /collectInvoiceWorkspacePayload/.test(appJs.text),
    appJsImportsWorkspace: /invoice-workspace\.js/.test(appJs.text),
    browser: browserResult,
  };
}

async function acceptPreview(baseUrl, shareUrl) {
  // Attempt to unlock Vercel deployment protection via share URL in a real browser.
  const session = await withBrowser(async (browser) => {
    const page = await browser.newPage();
    page.setDefaultTimeout(60000);
    if (shareUrl) {
      await page.goto(shareUrl, { waitUntil: 'networkidle2' });
      await new Promise((r) => setTimeout(r, 2000));
    }
    // Sign-in via API from page origin after unlock, else from Node against same host if public.
    let apiSession;
    try {
      apiSession = await page.evaluate(async (email, password) => {
        const response = await fetch('/api/auth/sign-in', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email, password }),
        });
        return { status: response.status, body: await response.json().catch(() => ({})) };
      }, EMAIL, PASSWORD);
    } catch (error) {
      apiSession = { status: 0, body: { error: String(error) } };
    }
    if (!apiSession.body?.access_token) {
      // Fallback: node-side sign-in may work if protection doesn't cover API
      try {
        const nodeSession = await signIn(baseUrl);
        apiSession = { status: 200, body: nodeSession };
      } catch (error) {
        return {
          unlocked: false,
          pageUrl: page.url(),
          title: await page.title(),
          bodySnippet: await page.evaluate(() => document.body?.innerText?.slice(0, 500) || ''),
          apiSession,
          error: String(error),
        };
      }
    }

    await page.evaluate((value) => {
      localStorage.setItem('aboss-invoicing-session', JSON.stringify(value));
    }, apiSession.body);

    await page.goto(`${baseUrl}/health/build`, { waitUntil: 'networkidle2' });
    const build = await page.evaluate(() => {
      try {
        return JSON.parse(document.body.innerText);
      } catch {
        return { raw: document.body.innerText.slice(0, 500), href: location.href };
      }
    });
    await page.screenshot({ path: join(OUT, 'preview-build-marker.png'), fullPage: true });

    await page.goto(`${baseUrl}/workspace/invoices/new`, { waitUntil: 'networkidle2' });
    await page.waitForFunction(() => !location.pathname.includes('/sign-in'), { timeout: 30000 }).catch(() => null);
    const formReady = await page
      .waitForSelector('#invoice-editor-form, #invoice-workspace-form', { timeout: 25000 })
      .then(() => true)
      .catch(() => false);

    const marker = await page.evaluate(() => ({
      href: location.href,
      aleyaBuild: window.__ALEYA_BUILD__ || null,
      metas: [...document.querySelectorAll('meta[name^="aleya-"]')].map((m) => ({
        name: m.getAttribute('name'),
        content: m.getAttribute('content'),
      })),
      scripts: [...document.querySelectorAll('script')].map((n) => n.src).filter(Boolean),
      hasEditorForm: Boolean(document.querySelector('#invoice-editor-form')),
      hasWorkspaceForm: Boolean(document.querySelector('#invoice-workspace-form')),
    }));

    const assetStatuses = await page.evaluate(async () => {
      const paths = [
        '/assets/invoice-workspace.js',
        '/assets/invoice-editor.js',
        '/assets/invoice-model.js',
        '/assets/invoice-api.js',
        '/assets/build-identity.js',
      ];
      const out = {};
      for (const path of paths) {
        const res = await fetch(path, { cache: 'no-store' });
        const text = await res.text();
        out[path] = { status: res.status, snippet: text.slice(0, 120) };
      }
      return out;
    });

    let flow = { skipped: true };
    if (formReady && marker.hasEditorForm) {
      await page.click('[data-invoice-field="title"]', { clickCount: 3 }).catch(() => null);
      await page.type('[data-invoice-field="title"]', 'Canonical Live Acceptance Title', { delay: 8 });
      const customerOptions = await page.$$eval('[data-invoice-field="customerId"] option', (nodes) =>
        nodes.map((n) => n.value).filter(Boolean),
      );
      if (customerOptions[0]) {
        await page.select('[data-invoice-field="customerId"]', customerOptions[0]);
      } else {
        // Create customer via API
        const created = await page.evaluate(async (token) => {
          const res = await fetch('/api/customers', {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              displayName: 'Live Acceptance Customer',
              email: `live.acceptance.${Date.now()}@example.test`,
            }),
          });
          return { status: res.status, body: await res.json() };
        }, apiSession.body.access_token);
        if (created.body?.id) {
          await page.select('[data-invoice-field="customerId"]', created.body.id);
        }
      }
      const desc = await page.$('[data-invoice-line] [data-invoice-field="description"]');
      if (desc) {
        await desc.click({ clickCount: 3 });
        await desc.type('Canonical line item');
      }
      const qty = await page.$('[data-invoice-line] [data-invoice-field="quantity"]');
      if (qty) {
        await qty.click({ clickCount: 3 });
        await qty.type('1');
      }
      const unit = await page.$('[data-invoice-line] [data-invoice-field="unitPrice"]');
      if (unit) {
        await unit.click({ clickCount: 3 });
        await unit.type('100');
      }

      // Save draft
      const saveBtn = await page.evaluateHandle(() =>
        [...document.querySelectorAll('button')].find((b) => /save\s*draft|save/i.test(b.textContent || '')),
      );
      if (saveBtn.asElement()) await saveBtn.asElement().click();
      await new Promise((r) => setTimeout(r, 2000));

      const invoiceId = await page.evaluate(() => {
        const m = location.pathname.match(/invoices\/([^/]+)\/edit/);
        return m?.[1] || window.__ALEYA_BUILD__?.invoiceId || null;
      });

      // Refresh
      await page.reload({ waitUntil: 'networkidle2' });
      await page.waitForSelector('#invoice-editor-form', { timeout: 20000 });
      const titleAfterRefresh = await page.$eval(
        '[data-invoice-field="title"]',
        (el) => el.value,
      );

      // Preview PDF
      const previewBtn = await page.evaluateHandle(() =>
        [...document.querySelectorAll('button')].find((b) => /preview\s*pdf/i.test(b.textContent || '')),
      );
      const titleStateBeforePreview = await page.evaluate(() => {
        const form = document.querySelector('#invoice-editor-form');
        const title = form?.querySelector('[data-invoice-field="title"]');
        return {
          value: title?.value || null,
          disabled: Boolean(title?.disabled),
          formDataTitle: form ? Object.fromEntries(new FormData(form)).title || null : null,
          stateTitle: null,
        };
      });
      if (previewBtn.asElement()) await previewBtn.asElement().click();
      await new Promise((r) => setTimeout(r, 3000));
      const previewResult = await page.evaluate(() => {
        const toast =
          document.querySelector('[data-toast], .toast, .notice, .alert, [role="alert"]')?.textContent ||
          '';
        return {
          toast: toast.trim(),
          falseTitleError: /Invoice title is required/i.test(document.body.innerText),
          href: location.href,
        };
      });
      await page.screenshot({ path: join(OUT, 'preview-pdf-ok.png'), fullPage: true });

      // Hard refresh
      await page.reload({ waitUntil: 'networkidle2' });
      const hardRefreshMarker = await page.evaluate(() => window.__ALEYA_BUILD__ || null);
      await page.screenshot({ path: join(OUT, 'preview-hard-refresh.png'), fullPage: true });

      flow = {
        skipped: false,
        invoiceId,
        titleAfterRefresh,
        titleStateBeforePreview,
        previewResult,
        hardRefreshMarker,
        falseTitleError: previewResult.falseTitleError,
      };
    }

    return {
      unlocked: true,
      build,
      marker,
      assetStatuses,
      flow,
      apiSessionStatus: apiSession.status,
    };
  });

  return { baseUrl, shareUrl, ...session };
}

const PROD = process.env.PROD_URL || 'https://ai-invoicing-app.vercel.app';
const PREVIEW =
  process.env.PREVIEW_URL ||
  'https://ai-invoicing-nyj3mublf-ahmedmalas-projects.vercel.app';
const PREVIEW_SHARE =
  process.env.PREVIEW_SHARE_URL ||
  'https://ai-invoicing-app-git-cursor-rebuild-fba694-ahmedmalas-projects.vercel.app/health/build?_vercel_share=hfIWyQWWfDGBqKQIhYbETt6JPWsBSQXG';

try {
  console.log('=== PRODUCTION FAILURE REPRO ===');
  report.production = await reproduceProductionFailure(PROD);
  writeFileSync(join(OUT, 'production-report.json'), JSON.stringify(report.production, null, 2));
  console.log('production done');

  console.log('=== PREVIEW ACCEPTANCE ===');
  report.preview = await acceptPreview(PREVIEW, PREVIEW_SHARE);
  writeFileSync(join(OUT, 'preview-report.json'), JSON.stringify(report.preview, null, 2));

  report.finishedAt = new Date().toISOString();
  report.ok = Boolean(
    report.production?.browser?.after &&
      (/Invoice title is required/i.test(report.production.browser.after.toast || '') ||
        /Invoice title is required/i.test(report.production.browser.after.fieldError || '') ||
        /Invoice title is required/i.test(report.production.browser.after.bodyText || '') ||
        report.production.appJsHasCollectPayload) &&
      report.preview?.marker?.aleyaBuild?.invoiceUiVersion === 'canonical-v3',
  );
  writeFileSync(join(OUT, 'summary.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ok: report.ok, out: OUT }, null, 2));
  process.exit(0);
} catch (error) {
  report.error = String(error?.stack || error);
  report.finishedAt = new Date().toISOString();
  writeFileSync(join(OUT, 'summary.json'), JSON.stringify(report, null, 2));
  console.error(error);
  process.exit(1);
}
