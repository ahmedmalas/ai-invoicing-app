/**
 * Browser regression for issue #65:
 * - Description text selection / copy / paste
 * - Invoice title editing, autosave, reopen, PDF
 * - Drag-handle-only reorder (description drag must not reorder)
 */
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import zlib from 'node:zlib';
import Database from 'better-sqlite3';
import puppeteer from 'puppeteer-core';

function extractPdfText(pdf) {
  const source = pdf.toString('latin1');
  const streams = [...source.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)];
  const parts = [];
  for (const match of streams) {
    const raw = Buffer.from(match[1] ?? '', 'latin1');
    let decoded = '';
    try {
      decoded = zlib.inflateSync(raw).toString('latin1');
    } catch {
      decoded = raw.toString('latin1');
    }
    for (const tj of decoded.matchAll(/\[(.*?)\]\s*TJ/gs)) {
      const body = tj[1] ?? '';
      let run = '';
      for (const token of body.matchAll(/<([0-9a-fA-F]+)>|\(([^)\\]*(?:\\.[^)\\]*)*)\)/g)) {
        if (token[1]) {
          for (let i = 0; i + 1 < token[1].length; i += 2) {
            run += String.fromCharCode(Number.parseInt(token[1].slice(i, i + 2), 16));
          }
        } else if (token[2] !== undefined) {
          run += token[2].replace(/\\([nrt\\()])/g, (_, ch) => {
            if (ch === 'n') return '\n';
            if (ch === 'r') return '\r';
            if (ch === 't') return '\t';
            return ch;
          });
        }
      }
      if (run) parts.push(run);
    }
  }
  return parts.join(' ');
}

const AUTH_BYPASS_USER_ID = '00000000-0000-0000-0000-000000000001';
const PORT = Number(process.env.VERIFY_PORT || 4188);
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = process.env.CHROME_PATH || '/usr/local/bin/google-chrome';
const report = {
  previewOrLocalUrl: BASE,
  invoiceId: null,
  steps: [],
  checks: {},
  ok: false,
};

function step(name, detail) {
  report.steps.push({ name, detail, at: new Date().toISOString() });
  console.log(`✓ ${name}${detail ? `: ${detail}` : ''}`);
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

async function waitFor(page, predicate, timeoutMs = 15000, label = 'condition') {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function main() {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_ANON_KEY;
  delete process.env.SUPABASE_PUBLISHABLE_KEY;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  process.env.NODE_ENV = 'test';
  process.env.AI_BUSINESS_OS_TEST_AUTH_BYPASS = '1';
  process.env.ENABLE_BROWSER_APP = '1';

  const dir = mkdtempSync(join(tmpdir(), 'invoice-selection-browser-'));
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
    companyName: 'Selection Verify Co',
    legalName: 'Selection Verify Co Pty Ltd',
    abnTaxId: '51824753556',
    address: '1 Selection St, Sydney NSW 2000',
    email: 'selection@example.test',
    phone: '0400000001',
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
    headless: true,
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

  const gotoApp = async (path) => {
    await page.goto(BASE + path, { waitUntil: 'domcontentloaded' });
    await new Promise((r) => setTimeout(r, 350));
  };

  await gotoApp('/sign-in');
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
    // Avoid stale draft recovery fighting with this verification run.
    localStorage.removeItem('aleya-invoice-workspace-draft-v1');
  });
  await gotoApp('/dashboard');
  await waitFor(page, async () => !(await page.url()).includes('/sign-in'), 20000, 'auth');
  step('signed_in');

  const customerResp = await page.evaluate(async () => {
    const response = await fetch('/api/customers', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer test-bypass-token',
      },
      body: JSON.stringify({
        displayName: 'Selection Customer',
        email: 'selection.customer@example.test',
      }),
    });
    return { status: response.status, body: await response.json() };
  });
  if (customerResp.status !== 201) throw new Error('customer create failed');
  const customerId = customerResp.body.id;
  step('customer_created', customerId);

  await gotoApp('/workspace/invoices/new');
  await waitFor(page, async () => Boolean(await page.$('#invoice-workspace-form')), 15000, 'form');
  await waitFor(
    page,
    async () =>
      (await page.$eval('[data-invoice-curtain]', (el) => el.getAttribute('data-curtain-state'))) ===
      'open',
    10000,
    'curtain open',
  );

  // Title must be editable and keep caret during totals/autosave scheduling.
  await page.click('input[name="title"]', { clickCount: 3 });
  await page.type('input[name="title"]', 'Header Name Alpha', { delay: 15 });
  const titleTyping = await page.evaluate(() => {
    const field = document.querySelector('input[name="title"]');
    return {
      value: field?.value || '',
      readOnly: Boolean(field?.readOnly),
      disabled: Boolean(field?.disabled),
      selectionStart: field?.selectionStart,
      active: document.activeElement === field,
    };
  });
  report.checks.titleTyping = titleTyping;
  if (titleTyping.readOnly || titleTyping.disabled) throw new Error('Title field is not writable');
  if (titleTyping.value !== 'Header Name Alpha') throw new Error('Title value not accepted');
  if (!titleTyping.active) throw new Error('Title lost focus while typing');
  step('title_editable', titleTyping.value);

  await page.select('[data-customer-select], select[name="customerId"]', customerId);
  await page.focus('input[name="title"]');
  await page.keyboard.down('Control');
  await page.keyboard.press('A');
  await page.keyboard.up('Control');
  await page.keyboard.type('Site Visit Title');
  step('title_changed', 'Site Visit Title');

  const desc = await page.$('[data-invoice-line] input[name="description"]');
  if (!desc) throw new Error('Missing description input');
  await desc.click({ clickCount: 3 });
  await desc.type('Roof flashing and gutter repair work');

  // Drag-select a substring in description.
  const selectionInfo = await page.evaluate(async () => {
    const field = document.querySelector('[data-invoice-line] input[name="description"]');
    field.focus();
    field.setSelectionRange(5, 13); // "flashing"
    const selected = field.value.slice(field.selectionStart, field.selectionEnd);
    // Keep selection across a totals refresh + snapshot write.
    field.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 50));
    return {
      selected,
      selectionStart: field.selectionStart,
      selectionEnd: field.selectionEnd,
      active: document.activeElement === field,
      rowDraggable: document.querySelector('[data-invoice-line]')?.getAttribute('draggable'),
      userSelect: getComputedStyle(field).userSelect || getComputedStyle(field).webkitUserSelect,
    };
  });
  report.checks.descriptionSelection = selectionInfo;
  if (selectionInfo.selected !== 'flashing') {
    throw new Error('Expected selected substring "flashing", got ' + selectionInfo.selected);
  }
  if (selectionInfo.rowDraggable === 'true') {
    throw new Error('Line row should not be draggable while editing description');
  }
  step('description_substring_selected', selectionInfo.selected);

  // Ctrl/Cmd+A selects all description text.
  await page.focus('[data-invoice-line] input[name="description"]');
  await page.keyboard.down('Control');
  await page.keyboard.press('A');
  await page.keyboard.up('Control');
  const selectAll = await page.evaluate(() => {
    const field = document.querySelector('[data-invoice-line] input[name="description"]');
    return {
      start: field.selectionStart,
      end: field.selectionEnd,
      length: field.value.length,
    };
  });
  report.checks.selectAll = selectAll;
  if (selectAll.start !== 0 || selectAll.end !== selectAll.length) {
    throw new Error('Ctrl+A did not select all description text');
  }
  step('description_select_all');

  // Copy/paste between two description fields.
  if ((await page.$$('[data-invoice-line]')).length < 2) {
    await page.click('[data-add-invoice-line]');
  }
  await page.focus('[data-invoice-line] input[name="description"]');
  await page.keyboard.down('Control');
  await page.keyboard.press('A');
  await page.keyboard.press('C');
  await page.keyboard.up('Control');
  const secondDesc = await page.$('[data-invoice-line]:nth-child(2) input[name="description"]');
  await secondDesc.click({ clickCount: 3 });
  await page.keyboard.down('Control');
  await page.keyboard.press('V');
  await page.keyboard.up('Control');
  const pasted = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('[data-invoice-line] input[name="description"]')];
    return rows.map((row) => row.value);
  });
  report.checks.paste = pasted;
  if (pasted[1] !== pasted[0]) throw new Error('Paste into second description failed: ' + JSON.stringify(pasted));
  step('description_copy_paste', pasted[1]);

  // Starting a drag inside description must not arm row dragging.
  const dragFromDescription = await page.evaluate(() => {
    const row = document.querySelector('[data-invoice-line]');
    const field = row.querySelector('input[name="description"]');
    field.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    return row.getAttribute('draggable');
  });
  report.checks.dragFromDescription = dragFromDescription;
  if (dragFromDescription === 'true') {
    throw new Error('Description pointerdown armed row dragging');
  }
  step('description_does_not_arm_drag');

  // Dedicated handle still arms drag.
  const dragFromHandle = await page.evaluate(() => {
    const row = document.querySelector('[data-invoice-line]');
    const handle = row.querySelector('[data-line-drag]');
    handle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    return row.getAttribute('draggable');
  });
  report.checks.dragFromHandle = dragFromHandle;
  if (dragFromHandle !== 'true') throw new Error('Drag handle did not arm row dragging');
  step('handle_arms_drag');

  // Fill qty/price and wait for autosave; title must survive.
  const firstRow = await page.$('[data-invoice-line]');
  const qty = await firstRow.$('input[name="quantity"]');
  await qty.click({ clickCount: 3 });
  await qty.type('2');
  const price = await firstRow.$('input[name="unitPrice"]');
  await price.click({ clickCount: 3 });
  await price.type('150');

  await page.focus('input[name="title"]');
  await page.keyboard.down('Control');
  await page.keyboard.press('A');
  await page.keyboard.up('Control');
  await page.keyboard.type('Persisted Header Title');

  await new Promise((r) => setTimeout(r, 2500));
  await waitFor(
    page,
    async () => /\/workspace\/invoices\/[^/]+\/edit$/.test(page.url()),
    20000,
    'autosave edit URL',
  );
  const invoiceId = page.url().match(/\/workspace\/invoices\/([^/]+)\/edit$/)?.[1];
  report.invoiceId = invoiceId;
  const titleAfterAutosave = await page.$eval('input[name="title"]', (el) => el.value);
  report.checks.titleAfterAutosave = titleAfterAutosave;
  if (titleAfterAutosave !== 'Persisted Header Title') {
    throw new Error('Title lost during autosave: ' + titleAfterAutosave);
  }
  step('title_survives_autosave', titleAfterAutosave);

  // PDF endpoint contains the title (decode PDFKit TJ runs).
  const pdfResp = await fetch(BASE + '/api/invoices/' + invoiceId + '/pdf', {
    headers: { authorization: 'Bearer test-bypass-token' },
  });
  const pdfBuf = Buffer.from(await pdfResp.arrayBuffer());
  const pdfText = extractPdfText(pdfBuf);
  report.checks.pdf = {
    status: pdfResp.status,
    contentType: pdfResp.headers.get('content-type'),
    includesTitle: pdfText.includes('Persisted Header Title'),
    byteLength: pdfBuf.byteLength,
    sample: pdfText.slice(0, 240),
  };
  if (pdfResp.status !== 200 || !pdfText.includes('Persisted Header Title')) {
    throw new Error('PDF missing title: ' + JSON.stringify(report.checks.pdf));
  }
  step('pdf_contains_title');

  // Refresh / reopen existing invoice.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitFor(page, async () => Boolean(await page.$('#invoice-workspace-form')), 15000, 'reopen form');
  const reopened = await page.evaluate(() => ({
    title: document.querySelector('input[name="title"]')?.value || '',
    description:
      document.querySelector('[data-invoice-line] input[name="description"]')?.value || '',
    rowDraggable: document.querySelector('[data-invoice-line]')?.getAttribute('draggable'),
  }));
  report.checks.reopened = reopened;
  if (reopened.title !== 'Persisted Header Title') {
    throw new Error('Title missing after reopen: ' + reopened.title);
  }
  if (!reopened.description.includes('Roof flashing')) {
    throw new Error('Description missing after reopen: ' + reopened.description);
  }
  if (reopened.rowDraggable === 'true') {
    throw new Error('Reopened row unexpectedly draggable');
  }
  step('reopen_preserves_title_and_description');

  // Empty title validation message.
  await page.focus('input[name="title"]');
  await page.keyboard.down('Control');
  await page.keyboard.press('A');
  await page.keyboard.up('Control');
  await page.keyboard.press('Backspace');
  await page.click('[data-invoice-action="preview"]');
  await waitFor(
    page,
    async () => {
      const toast = await page.$eval('.toast', (el) => el.textContent || '').catch(() => '');
      return /Invoice title is required/i.test(toast);
    },
    8000,
    'title validation toast',
  );
  step('empty_title_field_error');

  report.ok = true;
  mkdirSync('/opt/cursor/artifacts', { recursive: true });
  writeFileSync(
    '/opt/cursor/artifacts/invoice-selection-browser-verify.json',
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify({ ok: true, invoiceId, checks: report.checks }, null, 2));

  await browser.close();
  await app.close();
}

main().catch(async (error) => {
  console.error(error);
  report.ok = false;
  report.error = String(error?.stack || error);
  try {
    mkdirSync('/opt/cursor/artifacts', { recursive: true });
    writeFileSync(
      '/opt/cursor/artifacts/invoice-selection-browser-verify.json',
      JSON.stringify(report, null, 2),
    );
  } catch {
    /* ignore */
  }
  process.exit(1);
});
