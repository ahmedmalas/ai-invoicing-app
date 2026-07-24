/**
 * Local browser proof: natural drag-select copy across description cells,
 * no checkboxes, line numbers retained, spreadsheet TSV paste still works.
 */
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import puppeteer from 'puppeteer-core';

const AUTH_BYPASS_USER_ID = '00000000-0000-0000-0000-000000000001';
const PORT = Number(process.env.VERIFY_PORT || 4196);
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = process.env.CHROME_PATH || '/usr/local/bin/google-chrome';
const OUT = process.env.ARTIFACT_DIR || '/opt/cursor/artifacts/invoice-natural-text-select-live';
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
  const dir = mkdtempSync(join(tmpdir(), 'invoice-natural-select-'));
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
    companyName: 'Natural Select Co',
    legalName: 'Natural Select Co Pty Ltd',
    abnTaxId: '51824753556',
    address: '1 Select St, Sydney NSW 2000',
    email: 'select@example.test',
    phone: '0400000005',
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
          displayName: 'Natural Select Customer',
          email: 'natural@example.test',
        }),
      });
      return { status: response.status, body: await response.json() };
    });
    if (customerResp.status !== 201) throw new Error('customer failed');
    const customerId = customerResp.body.id;

    await page.goto(BASE + '/workspace/invoices/new', { waitUntil: 'domcontentloaded' });
    await waitFor(
      page,
      async () => Boolean(await page.$('[data-invoice-display="description"]')),
      15000,
      'description display cell',
    );

    const chromeCheck = await page.evaluate(() => ({
      checkboxes: document.querySelectorAll('[data-line-select], [data-select-all-lines]').length,
      selectCount: Boolean(document.querySelector('[data-selection-count]')),
      duplicateSelected: Boolean(document.querySelector('[data-duplicate-selected]')),
      lineNumbers: [...document.querySelectorAll('[data-line-number]')].map((el) => el.textContent),
      displays: document.querySelectorAll('[data-invoice-display="description"]').length,
    }));
    report.checks.noCheckboxes =
      chromeCheck.checkboxes === 0 &&
      !chromeCheck.selectCount &&
      !chromeCheck.duplicateSelected;
    report.checks.lineNumbers = chromeCheck.lineNumbers.includes('1');
    step('chrome', JSON.stringify(chromeCheck));

    await page.evaluate((id) => {
      const select = document.querySelector('[data-invoice-field="customerId"]');
      if (select) {
        select.value = id;
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }
      const title = document.querySelector('[data-invoice-field="title"]');
      if (title) {
        title.value = 'Natural Text Select Proof';
        title.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }, customerId);

    while ((await page.$$('[data-invoice-line]')).length < 4) {
      await page.evaluate(() => document.querySelector('[data-add-line]')?.click());
      await sleep(80);
    }

    // Populate via edit mode (click display → type is covered separately).
    await page.evaluate(() => {
      document.querySelectorAll('[data-invoice-line]').forEach((row, index) => {
        const cell = row.querySelector('[data-editable-cell="description"]');
        const input = cell?.querySelector('[data-invoice-field="description"]');
        const display = cell?.querySelector('[data-invoice-display="description"]');
        const qty = row.querySelector('[data-invoice-field="quantity"]');
        const price = row.querySelector('[data-invoice-field="unitPrice"]');
        if (cell && input && display) {
          cell.classList.add('is-editing');
          input.hidden = false;
          input.value = `Labour Hire ${String(index + 6).padStart(2, '0')}-07-26`;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          display.textContent = input.value;
          input.hidden = true;
          cell.classList.remove('is-editing');
        }
        if (qty) {
          const qCell = qty.closest('[data-editable-cell]');
          qCell?.classList.add('is-editing');
          qty.hidden = false;
          qty.value = '1';
          qty.dispatchEvent(new Event('input', { bubbles: true }));
          qCell?.querySelector('[data-invoice-display]') &&
            (qCell.querySelector('[data-invoice-display]').textContent = '1');
          qty.hidden = true;
          qCell?.classList.remove('is-editing');
        }
        if (price) {
          const pCell = price.closest('[data-editable-cell]');
          pCell?.classList.add('is-editing');
          price.hidden = false;
          price.value = '350';
          price.dispatchEvent(new Event('input', { bubbles: true }));
          pCell?.querySelector('[data-invoice-display]') &&
            (pCell.querySelector('[data-invoice-display]').textContent = '350');
          price.hidden = true;
          pCell?.classList.remove('is-editing');
        }
      });
    });
    await sleep(150);

    // Native selection across description display spans + cleaned copy output.
    const copied = await page.evaluate(async () => {
      const mod = await import('/assets/invoice-line-clipboard.js');
      const spans = [...document.querySelectorAll('[data-invoice-display="description"]')];
      const selection = window.getSelection();
      selection.removeAllRanges();
      const range = document.createRange();
      range.setStart(spans[0].firstChild || spans[0], 0);
      range.setEnd(
        spans[spans.length - 1].firstChild || spans[spans.length - 1],
        (spans[spans.length - 1].textContent || '').length,
      );
      selection.addRange(range);
      const form = document.querySelector('#invoice-editor-form');
      const cleaned = mod.serializeNaturalSelection(selection, form);
      let clipboard = '';
      const onCopy = (event) => {
        clipboard = event.clipboardData?.getData('text/plain') || '';
      };
      form.addEventListener('copy', onCopy);
      document.execCommand('copy');
      form.removeEventListener('copy', onCopy);
      return {
        cleaned,
        clipboard,
        spanCount: spans.length,
        noButtons: cleaned && !/[⧉↑↓×]/.test(cleaned),
      };
    });
    const sourceText = copied.clipboard || copied.cleaned || '';
    report.checks.dragSelectCopy =
      copied.spanCount === 4 &&
      copied.noButtons &&
      sourceText ===
        [
          'Labour Hire 06-07-26',
          'Labour Hire 07-07-26',
          'Labour Hire 08-07-26',
          'Labour Hire 09-07-26',
        ].join('\n');
    report.copySample = sourceText;
    step('drag_select_copy', JSON.stringify({ ...copied, ok: report.checks.dragSelectCopy }));

    // Spreadsheet paste still creates rows.
    await page.evaluate(() => {
      window.getSelection()?.removeAllRanges();
      const form = document.querySelector('#invoice-editor-form');
      const dt = new DataTransfer();
      dt.setData(
        'text/plain',
        'Description\tQty\tUnit Price\tGST\nSheet A\t1\t350.00\t10%\nSheet B\t1\t350.00\t10%',
      );
      form.dispatchEvent(
        new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }),
      );
    });
    await sleep(200);
    const afterSheet = await page.evaluate(() => {
      const descs = [
        ...document.querySelectorAll('[data-invoice-display="description"]'),
      ].map((el) => el.textContent);
      return {
        rows: document.querySelectorAll('[data-invoice-line]').length,
        descs,
        hasSheetA: descs.includes('Sheet A'),
        hasSheetB: descs.includes('Sheet B'),
        totals: [...document.querySelectorAll('[data-line-total]')].map((el) => el.textContent),
        numbers: [...document.querySelectorAll('[data-line-number]')].map((el) => el.textContent),
      };
    });
    report.checks.spreadsheetPaste =
      afterSheet.rows === 6 &&
      afterSheet.hasSheetA &&
      afterSheet.hasSheetB &&
      afterSheet.totals.filter((t) => String(t).includes('385')).length === 6 &&
      afterSheet.numbers.join(',') === '1,2,3,4,5,6';
    step('spreadsheet_paste', JSON.stringify(afterSheet));

    // Click-to-edit still works on a display cell.
    await page.evaluate(() => {
      const display = document.querySelector('[data-invoice-display="description"]');
      display?.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, clientX: 10, clientY: 10, button: 0 }),
      );
      display?.dispatchEvent(
        new PointerEvent('pointerup', { bubbles: true, clientX: 10, clientY: 10, button: 0 }),
      );
    });
    await sleep(100);
    report.checks.clickToEdit = await page.evaluate(() => {
      const cell = document.querySelector('[data-editable-cell="description"]');
      const input = cell?.querySelector('[data-invoice-field="description"]');
      return Boolean(cell?.classList.contains('is-editing') && input && !input.hidden);
    });
    step('click_to_edit', String(report.checks.clickToEdit));

    report.ok = Object.values(report.checks).every(Boolean);
    await page.screenshot({ path: join(OUT, 'natural-text-select-browser.png'), fullPage: true });
  } catch (error) {
    report.errors.push(String(error?.stack || error));
    try {
      await page.screenshot({ path: join(OUT, 'natural-text-select-error.png'), fullPage: true });
    } catch {
      /* ignore */
    }
  } finally {
    writeFileSync(join(OUT, 'NATURAL_TEXT_SELECT_VERDICT.json'), JSON.stringify(report, null, 2));
    await browser.close();
    await app.close();
  }
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
}

main();
