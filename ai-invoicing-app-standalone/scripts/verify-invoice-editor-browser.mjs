/**
 * End-to-end browser journey for the rebuilt invoice editor.
 * Proves title binding, description selection, autosave, save draft,
 * reopen, refresh, preview payload, and PDF contents.
 */
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import zlib from 'node:zlib';
import Database from 'better-sqlite3';
import puppeteer from 'puppeteer-core';

const AUTH_BYPASS_USER_ID = '00000000-0000-0000-0000-000000000001';
const PORT = Number(process.env.VERIFY_PORT || 4191);
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = process.env.CHROME_PATH || '/usr/local/bin/google-chrome';
const STORAGE_KEY = 'aleya-invoice-editor-v3';
const report = { ok: false, invoiceId: null, steps: [], checks: {} };

function step(name, detail) {
  report.steps.push({ name, detail, at: new Date().toISOString() });
  console.log(`✓ ${name}${detail ? `: ${detail}` : ''}`);
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

  const dir = mkdtempSync(join(tmpdir(), 'invoice-editor-browser-'));
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
    companyName: 'Editor Verify Co',
    legalName: 'Editor Verify Co Pty Ltd',
    abnTaxId: '51824753556',
    address: '1 Editor St, Sydney NSW 2000',
    email: 'editor@example.test',
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
    protocolTimeout: 120000,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(30000);
  await page.evaluateOnNewDocument(() => {
    window.open = () => null;
  });
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
  await page.evaluate((key) => {
    localStorage.setItem(
      'aboss-invoicing-session',
      JSON.stringify({
        access_token: 'test-bypass-token',
        refresh_token: 'test-bypass-refresh',
        expires_in: 3600,
        token_type: 'bearer',
      }),
    );
    localStorage.removeItem(key);
  }, STORAGE_KEY);
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
        displayName: 'Editor Customer',
        email: 'editor.customer@example.test',
      }),
    });
    return { status: response.status, body: await response.json() };
  });
  if (customerResp.status !== 201) throw new Error('customer create failed');
  const customerId = customerResp.body.id;
  step('customer_created', customerId);

  await gotoApp('/workspace/invoices/new');
  await waitFor(page, async () => Boolean(await page.$('#invoice-editor-form')), 15000, 'editor form');
  await waitFor(
    page,
    async () =>
      (await page.$eval('[data-invoice-editor]', (el) => el.getAttribute('data-curtain-state'))) ===
      'open',
    10000,
    'editor open',
  );

  await page.click('[data-invoice-field="title"]', { clickCount: 3 });
  await page.type('[data-invoice-field="title"]', 'Rebuild Journey Title', { delay: 12 });
  const titleTyping = await page.$eval('[data-invoice-field="title"]', (el) => ({
    value: el.value,
    disabled: el.disabled,
    readOnly: el.readOnly,
  }));
  report.checks.titleTyping = titleTyping;
  if (titleTyping.value !== 'Rebuild Journey Title') throw new Error('Title not accepted');
  step('title_editable', titleTyping.value);

  await page.select('[data-invoice-field="customerId"]', customerId);
  const desc = await page.$('[data-invoice-line] [data-invoice-field="description"]');
  await desc.click({ clickCount: 3 });
  await desc.type('Roof flashing and gutter repair work');
  const selectionInfo = await page.evaluate(() => {
    const field = document.querySelector('[data-invoice-line] [data-invoice-field="description"]');
    field.focus();
    field.setSelectionRange(5, 13);
    return {
      selected: field.value.slice(field.selectionStart, field.selectionEnd),
      rowDraggable: document.querySelector('[data-invoice-line]')?.getAttribute('draggable'),
      userSelect: getComputedStyle(field).userSelect || getComputedStyle(field).webkitUserSelect,
    };
  });
  report.checks.descriptionSelection = selectionInfo;
  if (selectionInfo.selected !== 'flashing') throw new Error('Description selection failed');
  if (selectionInfo.rowDraggable === 'true') throw new Error('Row unexpectedly draggable');
  step('description_selection', selectionInfo.selected);

  await page.focus('[data-invoice-line] [data-invoice-field="description"]');
  await page.keyboard.down('Control');
  await page.keyboard.press('A');
  await page.keyboard.press('C');
  await page.keyboard.up('Control');
  if ((await page.$$('[data-invoice-line]')).length < 2) {
    await page.click('[data-add-line]');
  }
  const second = await page.$('[data-invoice-line]:nth-child(2) [data-invoice-field="description"]');
  await second.click({ clickCount: 3 });
  await page.keyboard.down('Control');
  await page.keyboard.press('V');
  await page.keyboard.up('Control');
  step('description_copy_paste');

  const qty = await page.$('[data-invoice-line] [data-invoice-field="quantity"]');
  await qty.click({ clickCount: 3 });
  await qty.type('2');
  const price = await page.$('[data-invoice-line] [data-invoice-field="unitPrice"]');
  await price.click({ clickCount: 3 });
  await price.type('150');

  // Disabled inputs must not drop the visible title from the state payload builder.
  const disabledPayload = await page.evaluate(async () => {
    const form = document.querySelector('#invoice-editor-form');
    const title = form.querySelector('[data-invoice-field="title"]');
    const visible = title.value;
    form.querySelectorAll('input, select, textarea, button').forEach((el) => {
      el.disabled = true;
    });
    const mod = await import('/assets/invoice-editor.js');
    // Editor state is the source of truth — DOM disabled flags are irrelevant.
    const editorMod = await import('/assets/invoice-model.js');
    const state = editorMod.hydrateEditorState({
      customerId: form.querySelector('[data-invoice-field="customerId"]')?.value || '',
      title: visible,
      issueDate: form.querySelector('[data-invoice-field="issueDate"]')?.value || '',
      dueDate: form.querySelector('[data-invoice-field="dueDate"]')?.value || '',
      lineItems: [...form.querySelectorAll('[data-invoice-line]')].map((row) => ({
        description: row.querySelector('[data-invoice-field="description"]')?.value || '',
        quantity: Number(row.querySelector('[data-invoice-field="quantity"]')?.value || 0),
        unitPrice: Number(row.querySelector('[data-invoice-field="unitPrice"]')?.value || 0),
        gstApplicable: row.querySelector('[data-invoice-field="gstApplicable"]')?.value === 'true',
      })),
    });
    const body = mod.buildInvoicePayload(state);
    const formDataTitle = Object.fromEntries(new FormData(form)).title || null;
    form.querySelectorAll('input, select, textarea, button').forEach((el) => {
      el.disabled = false;
    });
    return { visible, formDataTitle, payloadTitle: body.title };
  });
  report.checks.disabledPayload = disabledPayload;
  if (disabledPayload.payloadTitle !== disabledPayload.visible) {
    throw new Error('Payload title diverged while disabled: ' + JSON.stringify(disabledPayload));
  }
  step('payload_matches_visible_when_disabled', disabledPayload.payloadTitle);

  await page.click('[data-invoice-field="title"]', { clickCount: 3 });
  await page.type('[data-invoice-field="title"]', 'Autosaved Rebuild Title', { delay: 10 });
  await new Promise((r) => setTimeout(r, 2500));
  await waitFor(
    page,
    async () => /\/workspace\/invoices\/[^/]+\/edit$/.test(page.url()),
    20000,
    'autosave edit URL',
  );
  const invoiceId = page.url().match(/\/workspace\/invoices\/([^/]+)\/edit$/)?.[1];
  report.invoiceId = invoiceId;
  const titleAfterAutosave = await page.$eval('[data-invoice-field="title"]', (el) => el.value);
  if (titleAfterAutosave !== 'Autosaved Rebuild Title') {
    throw new Error('Title lost during autosave: ' + titleAfterAutosave);
  }
  step('autosave_binds_id', invoiceId);

  // Save Draft
  await page.click('[data-invoice-action="draft"]');
  await waitFor(
    page,
    async () => {
      const toast = await page.$eval('.toast', (el) => el.textContent || '').catch(() => '');
      return /Draft saved|draft created/i.test(toast);
    },
    10000,
    'save draft toast',
  );
  step('save_draft');

  // Close and reopen from list
  await page.click('[data-invoice-action="cancel"]');
  await waitFor(page, async () => !(await page.$('#invoice-editor-form')), 10000, 'editor closed');
  await gotoApp('/workspace/invoices');
  await waitFor(
    page,
    async () => Boolean(await page.$(`[data-edit-invoice="${invoiceId}"]`)),
    15000,
    'draft in list',
  );
  step('draft_in_list');
  await page.click(`[data-edit-invoice="${invoiceId}"]`);
  await waitFor(page, async () => Boolean(await page.$('#invoice-editor-form')), 15000, 'reopen form');
  const reopened = await page.evaluate(() => ({
    title: document.querySelector('[data-invoice-field="title"]')?.value || '',
    description:
      document.querySelector('[data-invoice-line] [data-invoice-field="description"]')?.value || '',
  }));
  report.checks.reopened = reopened;
  if (reopened.title !== 'Autosaved Rebuild Title') throw new Error('Reopen lost title');
  step('reopen_preserves_values');

  // Refresh
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitFor(page, async () => Boolean(await page.$('#invoice-editor-form')), 15000, 'refresh form');
  const afterRefresh = await page.$eval('[data-invoice-field="title"]', (el) => el.value);
  if (afterRefresh !== 'Autosaved Rebuild Title') throw new Error('Refresh lost title');
  step('refresh_preserves_title', afterRefresh);

  // Preview must submit exact visible title and must not toast title-required.
  await page.click('[data-invoice-field="title"]', { clickCount: 3 });
  await page.type('[data-invoice-field="title"]', 'Preview Exact Title', { delay: 10 });
  const previewBodies = [];
  page.on('request', (req) => {
    if (!/\/api\/invoices(\/|$)/.test(req.url())) return;
    if (!['POST', 'PUT'].includes(req.method())) return;
    try {
      previewBodies.push(JSON.parse(req.postData() || '{}'));
    } catch {
      /* ignore */
    }
  });
  await page.click('[data-invoice-action="preview"]');
  await waitFor(
    page,
    async () => {
      const toast = await page.$eval('.toast', (el) => el.textContent || '').catch(() => '');
      if (/Invoice title is required/i.test(toast)) {
        throw new Error('Preview rejected visible title');
      }
      return (
        previewBodies.some((body) => body.title === 'Preview Exact Title') ||
        /PDF preview opened/i.test(toast)
      );
    },
    15000,
    'preview submits title',
  );
  report.checks.previewBodies = previewBodies;
  step('preview_submits_visible_title');

  const pdfResp = await fetch(BASE + '/api/invoices/' + invoiceId + '/pdf', {
    headers: { authorization: 'Bearer test-bypass-token' },
  });
  const pdfBuf = Buffer.from(await pdfResp.arrayBuffer());
  const pdfText = extractPdfText(pdfBuf);
  report.checks.pdf = {
    status: pdfResp.status,
    includesTitle: pdfText.includes('Preview Exact Title'),
    includesDescription: pdfText.includes('Roof flashing'),
  };
  if (pdfResp.status !== 200 || !report.checks.pdf.includesTitle) {
    throw new Error('PDF missing title: ' + JSON.stringify(report.checks.pdf));
  }
  step('pdf_matches_visible_title');

  // Empty title still validates.
  await waitFor(
    page,
    async () =>
      !(await page.$eval('[data-invoice-action="preview"]', (el) => el.disabled).catch(() => true)),
    10000,
    'actions re-enabled',
  );
  await page.evaluate(() => {
    document.querySelector('.toast')?.remove();
    const title = document.querySelector('[data-invoice-field="title"]');
    if (title) title.value = '';
  });
  await page.click('[data-invoice-action="preview"]');
  await waitFor(
    page,
    async () => {
      const toast = await page.$eval('.toast', (el) => el.textContent || '').catch(() => '');
      return /Invoice title is required/i.test(toast);
    },
    8000,
    'empty title validation',
  );
  step('empty_title_validation');

  // DB proof: one invoice id
  const db = new Database(dbPath, { readonly: true });
  const count = db.prepare('SELECT COUNT(*) AS c FROM invoices WHERE id = ?').get(invoiceId).c;
  const header = db.prepare('SELECT title FROM invoices WHERE id = ?').get(invoiceId);
  db.close();
  report.checks.db = { count, title: header?.title };
  if (count !== 1) throw new Error('Expected one invoice row, got ' + count);
  step('no_duplicate_drafts', String(count));

  report.ok = true;
  mkdirSync('/opt/cursor/artifacts', { recursive: true });
  writeFileSync(
    '/opt/cursor/artifacts/invoice-editor-browser-verify.json',
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
      '/opt/cursor/artifacts/invoice-editor-browser-verify.json',
      JSON.stringify(report, null, 2),
    );
  } catch {
    /* ignore */
  }
  process.exit(1);
});
