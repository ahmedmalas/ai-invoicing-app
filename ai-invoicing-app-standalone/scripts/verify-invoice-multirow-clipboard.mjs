/**
 * Local browser proof: multi-row select, copy, paste, duplicate, spreadsheet TSV,
 * save/reopen and PDF.
 */
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import zlib from 'node:zlib';
import Database from 'better-sqlite3';
import puppeteer from 'puppeteer-core';

const AUTH_BYPASS_USER_ID = '00000000-0000-0000-0000-000000000001';
const PORT = Number(process.env.VERIFY_PORT || 4195);
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = process.env.CHROME_PATH || '/usr/local/bin/google-chrome';
const OUT = process.env.ARTIFACT_DIR || '/opt/cursor/artifacts/invoice-multirow-clipboard-live';
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

async function main() {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_ANON_KEY;
  process.env.NODE_ENV = 'test';
  process.env.AI_BUSINESS_OS_TEST_AUTH_BYPASS = '1';
  process.env.ENABLE_BROWSER_APP = '1';
  const dir = mkdtempSync(join(tmpdir(), 'invoice-multirow-'));
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
    companyName: 'Multirow Co',
    legalName: 'Multirow Co Pty Ltd',
    abnTaxId: '51824753556',
    address: '1 Copy St, Sydney NSW 2000',
    email: 'copy@example.test',
    phone: '0400000004',
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
  page.on('dialog', async (d) => {
    try {
      await d.accept();
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
          displayName: 'Multirow Customer',
          email: 'multirow@example.test',
        }),
      });
      return { status: response.status, body: await response.json() };
    });
    if (customerResp.status !== 201) throw new Error('customer failed');
    const customerId = customerResp.body.id;

    await page.goto(BASE + '/workspace/invoices/new', { waitUntil: 'domcontentloaded' });
    await waitFor(page, async () => Boolean(await page.$('[data-line-select]')), 15000, 'select box');
    await page.evaluate((id) => {
      const select = document.querySelector('[data-invoice-field="customerId"]');
      if (select) {
        select.value = id;
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }
      const title = document.querySelector('[data-invoice-field="title"]');
      if (title) {
        title.value = 'Multirow Clipboard Proof';
        title.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }, customerId);

    while ((await page.$$('[data-invoice-line]')).length < 3) {
      await page.evaluate(() => document.querySelector('[data-add-line]')?.click());
      await sleep(80);
    }
    await page.evaluate(() => {
      document.querySelectorAll('[data-invoice-line]').forEach((row, index) => {
        const desc = row.querySelector('[data-invoice-field="description"]');
        const qty = row.querySelector('[data-invoice-field="quantity"]');
        const price = row.querySelector('[data-invoice-field="unitPrice"]');
        if (desc) {
          desc.value = `Labour Hire ${String(index + 8).padStart(2, '0')}-07-26`;
          desc.dispatchEvent(new Event('input', { bubbles: true }));
        }
        if (qty) {
          qty.value = '1';
          qty.dispatchEvent(new Event('input', { bubbles: true }));
        }
        if (price) {
          price.value = '350';
          price.dispatchEvent(new Event('input', { bubbles: true }));
        }
      });
    });

    // Shift-select range 0..2 via checkbox clicks
    await page.evaluate(() => {
      const boxes = [...document.querySelectorAll('[data-line-select]')];
      boxes[0].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      boxes[2].dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true, shiftKey: true }),
      );
    });
    await sleep(100);
    let sel = await page.evaluate(() => ({
      count: document.querySelector('[data-selection-count]')?.textContent,
      selected: [...document.querySelectorAll('[data-invoice-line].is-selected')].length,
      labels: [...document.querySelectorAll('[data-line-number]')].map((el) => el.textContent),
    }));
    report.checks.shiftSelect = sel.selected === 3 && /3 lines selected/.test(sel.count || '');
    step('shift_select', JSON.stringify(sel));

    // Duplicate selected
    await page.evaluate(() => document.querySelector('[data-duplicate-selected]')?.click());
    await sleep(200);
    sel = await page.evaluate(() => ({
      rows: document.querySelectorAll('[data-invoice-line]').length,
      totals: [...document.querySelectorAll('[data-line-total]')].map((el) => el.textContent),
      numbers: [...document.querySelectorAll('[data-line-number]')].map((el) => el.textContent),
      ids: [...document.querySelectorAll('[data-invoice-line]')].map((row) =>
        row.getAttribute('data-line-id'),
      ),
      grand: document.querySelector('[data-total-grand]')?.textContent,
    }));
    report.checks.duplicateSelected =
      sel.rows === 6 &&
      sel.totals.filter((t) => String(t).includes('385')).length === 6 &&
      sel.numbers.join(',') === '1,2,3,4,5,6' &&
      new Set(sel.ids).size === 6 &&
      String(sel.grand).includes('2,310');
    step('duplicate_selected', JSON.stringify(sel));

    // Spreadsheet paste of 2 rows at end
    await page.evaluate(() => {
      const form = document.querySelector('#invoice-editor-form');
      const dt = new DataTransfer();
      dt.setData(
        'text/plain',
        'Description\tQty\tUnit Price\tGST\nSheet A\t1\t350.00\t10%\nSheet B\t1\t350.00\t10%',
      );
      form.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }));
    });
    await sleep(200);
    const afterSheet = await page.evaluate(() => {
      const descs = [
        ...document.querySelectorAll('[data-invoice-line] [data-invoice-field="description"]'),
      ].map((el) => el.value);
      return {
        rows: document.querySelectorAll('[data-invoice-line]').length,
        descs,
        hasSheetA: descs.includes('Sheet A'),
        hasSheetB: descs.includes('Sheet B'),
        totals: [...document.querySelectorAll('[data-line-total]')].map((el) => el.textContent),
      };
    });
    report.checks.spreadsheetPaste =
      afterSheet.rows === 8 &&
      afterSheet.hasSheetA &&
      afterSheet.hasSheetB &&
      afterSheet.totals.filter((t) => String(t).includes('385')).length === 8;
    step('spreadsheet_paste', JSON.stringify(afterSheet));

    // Escape clears selection
    await page.keyboard.press('Escape');
    await sleep(80);
    report.checks.escapeClears = await page.evaluate(
      () => document.querySelectorAll('[data-invoice-line].is-selected').length === 0,
    );
    step('escape', String(report.checks.escapeClears));

    // Save / reopen / PDF
    await sleep(1800);
    await waitFor(
      page,
      async () => /\/workspace\/invoices\/[^/]+\/edit$/.test(page.url()),
      30000,
      'edit url',
    );
    const invoiceId = page.url().match(/\/workspace\/invoices\/([^/]+)\/edit$/)?.[1];
    report.invoiceId = invoiceId;

    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitFor(page, async () => Boolean(await page.$('#invoice-editor-form')), 15000, 'reopen');
    const reopened = await page.evaluate(() => ({
      rows: document.querySelectorAll('[data-invoice-line]').length,
      prices: [...document.querySelectorAll('[data-invoice-field="unitPrice"]')].map((el) => el.value),
      numbers: [...document.querySelectorAll('[data-line-number]')].map((el) => el.textContent),
    }));
    report.checks.reopened =
      reopened.rows === 8 &&
      reopened.prices.filter((p) => p === '350').length === 8 &&
      reopened.numbers.join(',') === '1,2,3,4,5,6,7,8';
    step('reopened', JSON.stringify(reopened));

    const pdfResp = await page.evaluate(async (id) => {
      const response = await fetch('/api/invoices/' + id + '/pdf', {
        headers: { authorization: 'Bearer test-bypass-token' },
      });
      const buf = new Uint8Array(await response.arrayBuffer());
      return { status: response.status, bytes: Array.from(buf) };
    }, invoiceId);
    const pdfText = extractPdfText(Buffer.from(pdfResp.bytes));
    report.checks.pdf =
      pdfResp.status === 200 &&
      /Sheet A/.test(pdfText) &&
      /Sheet B/.test(pdfText) &&
      /Labour Hire 08-07-26/.test(pdfText) &&
      /8 line items/.test(pdfText);
    report.pdfSnippet = pdfText.slice(0, 500);
    step('pdf', `status=${pdfResp.status}`);

    report.ok = Object.values(report.checks).every(Boolean);
    await page.screenshot({ path: join(OUT, 'multirow-clipboard-browser.png'), fullPage: true });
  } catch (error) {
    report.errors.push(String(error?.stack || error));
    try {
      await page.screenshot({ path: join(OUT, 'multirow-clipboard-error.png'), fullPage: true });
    } catch {
      /* ignore */
    }
  } finally {
    writeFileSync(join(OUT, 'MULTIROW_CLIPBOARD_VERDICT.json'), JSON.stringify(report, null, 2));
    await browser.close();
    await app.close();
  }
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
}

main();
