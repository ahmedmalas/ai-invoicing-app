/**
 * Local browser proof: paste into Unit Price commits immediately, recalculates,
 * survives Enter / blur / save / reopen / PDF.
 */
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import zlib from 'node:zlib';
import Database from 'better-sqlite3';
import puppeteer from 'puppeteer-core';

const AUTH_BYPASS_USER_ID = '00000000-0000-0000-0000-000000000001';
const PORT = Number(process.env.VERIFY_PORT || 4193);
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = process.env.CHROME_PATH || '/usr/local/bin/google-chrome';
const OUT = process.env.ARTIFACT_DIR || '/opt/cursor/artifacts/invoice-line-paste-live';
const report = { ok: false, checks: {}, errors: [], steps: [] };

mkdirSync(OUT, { recursive: true });

function step(name, detail) {
  report.steps.push({ name, detail, at: new Date().toISOString() });
  console.log(`✓ ${name}${detail ? `: ${detail}` : ''}`);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitFor(page, predicate, timeoutMs = 20000, label = 'condition') {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return;
    await sleep(120);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function extractPdfText(pdf) {
  const source = pdf.toString('latin1');
  const parts = [];
  for (const match of source.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    let decoded = '';
    try {
      decoded = zlib.inflateSync(Buffer.from(match[1] ?? '', 'latin1')).toString('latin1');
    } catch {
      decoded = match[1] ?? '';
    }
    for (const tj of decoded.matchAll(/\[(.*?)\]\s*TJ/gs)) {
      let run = '';
      for (const token of (tj[1] ?? '').matchAll(/<([0-9a-fA-F]+)>|\(([^)\\]*(?:\\.[^)\\]*)*)\)/g)) {
        if (token[1]) {
          for (let i = 0; i + 1 < token[1].length; i += 2) {
            run += String.fromCharCode(Number.parseInt(token[1].slice(i, i + 2), 16));
          }
        } else if (token[2] !== undefined) run += token[2];
      }
      if (run) parts.push(run);
    }
  }
  return parts.join(' ');
}

function seedBypassActor(dbPath) {
  const db = new Database(dbPath);
  try {
    const now = new Date().toISOString();
    const roleId = randomUUID();
    db.prepare(
      `INSERT OR IGNORE INTO roles (id, name, can_be_assigned, can_manage_assignments, created_at, updated_at)
       VALUES (?, 'Auth Bypass Admin', 1, 1, ?, ?)`,
    ).run(roleId, now, now);
    const role =
      db.prepare(`SELECT id FROM roles WHERE name = ?`).get('Auth Bypass Admin') ||
      db.prepare(`SELECT id FROM roles LIMIT 1`).get();
    db.prepare(
      `INSERT OR IGNORE INTO users (id, display_name, email, is_active, created_at, updated_at)
       VALUES (?, 'Auth Bypass Actor', 'bypass@example.test', 1, ?, ?)`,
    ).run(AUTH_BYPASS_USER_ID, now, now);
    db.prepare(
      `INSERT OR IGNORE INTO user_role_links (id, user_id, role_id, created_at)
       VALUES (?, ?, ?, ?)`,
    ).run(randomUUID(), AUTH_BYPASS_USER_ID, role.id, now);
    db.prepare(
      `INSERT OR IGNORE INTO auth_workspace_memberships (auth_user_id, workspace_id, role, created_at)
       VALUES (?, '00000000-0000-0000-0000-000000000001', 'owner', ?)`,
    ).run(AUTH_BYPASS_USER_ID, now);
  } finally {
    db.close();
  }
}

async function pasteInto(page, selector, text) {
  await page.evaluate((sel) => {
    document.querySelector(sel)?.focus();
  }, selector);
  // Use CDP insertText via keyboard paste simulation: set clipboard through evaluate + paste event.
  await page.evaluate(
    (sel, value) => {
      const el = document.querySelector(sel);
      if (!el) throw new Error('missing ' + sel);
      el.focus();
      const dt = new DataTransfer();
      dt.setData('text/plain', value);
      const evt = new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: dt,
      });
      el.dispatchEvent(evt);
    },
    selector,
    text,
  );
}

async function main() {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_ANON_KEY;
  delete process.env.SUPABASE_PUBLISHABLE_KEY;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  process.env.NODE_ENV = 'test';
  process.env.AI_BUSINESS_OS_TEST_AUTH_BYPASS = '1';
  process.env.ENABLE_BROWSER_APP = '1';

  const dir = mkdtempSync(join(tmpdir(), 'invoice-line-paste-'));
  const dbPath = join(dir, 'verify.sqlite');
  process.env.DB_PATH = dbPath;
  process.env.PORT = String(PORT);
  process.env.PUBLIC_APP_URL = BASE;
  process.env.CORS_ORIGIN = BASE;

  const { buildApp } = await import('../dist/src/app.js').catch(async () => import('../src/app.ts'));
  const bootstrap = await buildApp({
    dbPath,
    authBypassForTesting: true,
    serveFrontend: true,
    nodeEnv: 'test',
    supabaseUrl: undefined,
    supabaseAnonKey: undefined,
  });
  await bootstrap.db.upsertBusinessProfile({
    companyName: 'Paste Verify Co',
    legalName: 'Paste Verify Co Pty Ltd',
    abnTaxId: '51824753556',
    address: '1 Paste St, Sydney NSW 2000',
    email: 'paste@example.test',
    phone: '0400000002',
    primaryColor: '#0F172A',
    secondaryColor: '#2563EB',
  });
  await bootstrap.close();
  seedBypassActor(dbPath);

  const app = await buildApp({
    dbPath,
    authBypassForTesting: true,
    serveFrontend: true,
    nodeEnv: 'test',
    supabaseUrl: undefined,
    supabaseAnonKey: undefined,
    publicAppUrl: BASE,
    corsOrigin: BASE,
  });
  await app.listen({ port: PORT, host: '127.0.0.1' });
  step('server_started', BASE);

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(30000);
  page.on('dialog', async (dialog) => {
    try {
      await dialog.accept();
    } catch {
      /* ignore */
    }
  });

  try {
    await page.goto(BASE + '/sign-in', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      localStorage.setItem(
        'aboss-invoicing-session',
        JSON.stringify({
          access_token: 'test-bypass-token',
          refresh_token: 'test-bypass-refresh',
          expires_in: 3600,
          token_type: 'bearer',
        }),
      );
    });
    await page.goto(BASE + '/dashboard', { waitUntil: 'domcontentloaded' });
    await waitFor(page, async () => !(await page.url()).includes('/sign-in'), 20000, 'dashboard');

    const customerResp = await page.evaluate(async () => {
      const response = await fetch('/api/customers', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer test-bypass-token',
        },
        body: JSON.stringify({
          displayName: 'Paste Commit Customer',
          email: 'paste.commit@example.test',
        }),
      });
      return { status: response.status, body: await response.json() };
    });
    if (customerResp.status !== 201) throw new Error('customer create failed');
    const customerId = customerResp.body.id;

    await page.goto(BASE + '/workspace/invoices/new', { waitUntil: 'domcontentloaded' });
    await waitFor(page, async () => Boolean(await page.$('#invoice-editor-form')), 15000, 'editor');
    await page.select('[data-invoice-field="customerId"]', customerId);
    await page.click('[data-invoice-field="title"]', { clickCount: 3 });
    await page.type('[data-invoice-field="title"]', 'Paste Commit Live Check');

    // Ensure 3 rows with qty 1 + GST.
    while ((await page.$$('[data-invoice-line]')).length < 3) {
      await page.click('[data-add-line]');
      await sleep(100);
    }
    await page.evaluate(() => {
      document.querySelectorAll('[data-invoice-line]').forEach((row, index) => {
        const desc = row.querySelector('[data-invoice-field="description"]');
        const qty = row.querySelector('[data-invoice-field="quantity"]');
        const gst = row.querySelector('[data-invoice-field="gstApplicable"]');
        if (desc) {
          desc.value = `Line ${index + 1}`;
          desc.dispatchEvent(new Event('input', { bubbles: true }));
        }
        if (qty) {
          qty.value = '1';
          qty.dispatchEvent(new Event('input', { bubbles: true }));
        }
        if (gst) {
          gst.value = 'true';
          gst.dispatchEvent(new Event('change', { bubbles: true }));
        }
      });
    });

    // 1) Paste into first Unit Price
    await pasteInto(
      page,
      '[data-invoice-line][data-line-index="0"] [data-invoice-field="unitPrice"]',
      '$350',
    );
    await sleep(150);
    let snap = await page.evaluate(() => {
      const row = document.querySelector('[data-invoice-line][data-line-index="0"]');
      return {
        value: row?.querySelector('[data-invoice-field="unitPrice"]')?.value,
        total: row?.querySelector('[data-line-total]')?.textContent,
        grand: document.querySelector('[data-total-grand]')?.textContent,
      };
    });
    report.checks.singlePaste = snap.value === '350' && String(snap.total).includes('385');
    step('single_paste', JSON.stringify(snap));

    // 2) Paste same price column into remaining rows from row 1
    await pasteInto(
      page,
      '[data-invoice-line][data-line-index="1"] [data-invoice-field="unitPrice"]',
      '350\n350',
    );
    await sleep(200);
    snap = await page.evaluate(() =>
      [...document.querySelectorAll('[data-invoice-line]')].map((row) => ({
        value: row.querySelector('[data-invoice-field="unitPrice"]')?.value,
        total: row.querySelector('[data-line-total]')?.textContent,
      })),
    );
    report.checks.multiPaste = snap.length >= 3 && snap.every((row) => String(row.total).includes('385'));
    step('multi_paste', JSON.stringify(snap));

    // 3) TSV paste onto a fresh row description
    await page.click('[data-add-line]');
    await sleep(120);
    await pasteInto(
      page,
      '[data-invoice-line][data-line-index="3"] [data-invoice-field="description"]',
      'Spreadsheet\t1\t350\ttrue',
    );
    await sleep(150);
    const tsv = await page.evaluate(() => {
      const row = document.querySelector('[data-invoice-line][data-line-index="3"]');
      return {
        description: row?.querySelector('[data-invoice-field="description"]')?.value,
        quantity: row?.querySelector('[data-invoice-field="quantity"]')?.value,
        unitPrice: row?.querySelector('[data-invoice-field="unitPrice"]')?.value,
        total: row?.querySelector('[data-line-total]')?.textContent,
      };
    });
    report.checks.tsvPaste =
      tsv.description === 'Spreadsheet' &&
      tsv.quantity === '1' &&
      tsv.unitPrice === '350' &&
      String(tsv.total).includes('385');
    step('tsv_paste', JSON.stringify(tsv));

    // 4) Enter immediately after paste on row 0
    await pasteInto(
      page,
      '[data-invoice-line][data-line-index="0"] [data-invoice-field="unitPrice"]',
      '350.00',
    );
    await page.keyboard.press('Enter');
    await sleep(200);
    const afterEnter = await page.evaluate(() => ({
      activeField: document.activeElement?.getAttribute('data-invoice-field'),
      activeIndex: document.activeElement?.closest('[data-invoice-line]')?.getAttribute('data-line-index'),
      firstPrice: document.querySelector(
        '[data-invoice-line][data-line-index="0"] [data-invoice-field="unitPrice"]',
      )?.value,
      firstTotal: document.querySelector(
        '[data-invoice-line][data-line-index="0"] [data-line-total]',
      )?.textContent,
    }));
    report.checks.enterAfterPaste =
      afterEnter.firstPrice === '350' &&
      String(afterEnter.firstTotal).includes('385') &&
      afterEnter.activeField === 'unitPrice';
    step('enter_after_paste', JSON.stringify(afterEnter));

    // 5) Click outside immediately after paste
    await pasteInto(
      page,
      '[data-invoice-line][data-line-index="1"] [data-invoice-field="unitPrice"]',
      '350,00',
    );
    await page.click('[data-invoice-field="title"]');
    await sleep(150);
    const afterBlur = await page.evaluate(() => ({
      price: document.querySelector(
        '[data-invoice-line][data-line-index="1"] [data-invoice-field="unitPrice"]',
      )?.value,
      total: document.querySelector(
        '[data-invoice-line][data-line-index="1"] [data-line-total]',
      )?.textContent,
    }));
    report.checks.blurAfterPaste =
      afterBlur.price === '350' && String(afterBlur.total).includes('385');
    step('blur_after_paste', JSON.stringify(afterBlur));

    // 6) Save without retyping — wait for autosave URL rewrite, then explicit Save Draft.
    await sleep(2000);
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((el) =>
        /save draft/i.test(el.textContent || ''),
      );
      btn?.click();
    });
    await sleep(1000);
    await waitFor(
      page,
      async () => /\/workspace\/invoices\/[^/]+\/edit$/.test(page.url()),
      30000,
      'saved edit URL',
    );
    const invoiceId = page.url().match(/\/workspace\/invoices\/([^/]+)\/edit$/)?.[1];
    report.invoiceId = invoiceId;

    const api = await page.evaluate(async (id) => {
      const response = await fetch('/api/invoices/' + id, {
        headers: { authorization: 'Bearer test-bypass-token' },
      });
      return { status: response.status, body: await response.json() };
    }, invoiceId);
    report.checks.apiPayload =
      api.status === 200 &&
      Array.isArray(api.body.lineItems) &&
      api.body.lineItems.filter((line) => Number(line.unitPrice) === 350).length >= 3;
    step('api_payload', `status=${api.status} prices=${api.body.lineItems?.map((l) => l.unitPrice)}`);

    // Reopen
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitFor(page, async () => Boolean(await page.$('#invoice-editor-form')), 15000, 'reopen');
    const reopened = await page.evaluate(() =>
      [...document.querySelectorAll('[data-invoice-line]')].map((row) => ({
        unitPrice: row.querySelector('[data-invoice-field="unitPrice"]')?.value,
        total: row.querySelector('[data-line-total]')?.textContent,
      })),
    );
    report.checks.reopened = reopened.filter((row) => row.unitPrice === '350').length >= 3;
    step('reopened', JSON.stringify(reopened));

    // PDF
    const pdfResp = await page.evaluate(async (id) => {
      const response = await fetch('/api/invoices/' + id + '/pdf', {
        headers: { authorization: 'Bearer test-bypass-token' },
      });
      const buf = new Uint8Array(await response.arrayBuffer());
      return { status: response.status, bytes: Array.from(buf) };
    }, invoiceId);
    const pdfText = extractPdfText(Buffer.from(pdfResp.bytes));
    report.checks.pdfContainsPaste =
      pdfResp.status === 200 && (/350/.test(pdfText) || /385/.test(pdfText));
    report.pdfSnippet = pdfText.slice(0, 400);
    step('pdf', `status=${pdfResp.status} has350=${/350/.test(pdfText)} has385=${/385/.test(pdfText)}`);

    report.ok = Object.values(report.checks).every(Boolean);
    await page.screenshot({ path: join(OUT, 'paste-commit-browser.png'), fullPage: true });
  } catch (error) {
    report.errors.push(String(error?.stack || error));
    try {
      await page.screenshot({ path: join(OUT, 'paste-commit-error.png'), fullPage: true });
    } catch {
      /* ignore */
    }
  } finally {
    writeFileSync(join(OUT, 'PASTE_COMMIT_VERDICT.json'), JSON.stringify(report, null, 2));
    await browser.close();
    await app.close();
  }

  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
}

main();
