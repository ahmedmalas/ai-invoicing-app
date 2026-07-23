/**
 * Production-style browser verification for PR #60 invoice persistence.
 * Starts a local auth-bypass server, drives Chrome through the SPA, and
 * proves DB commits / no duplicates via better-sqlite3.
 */
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import puppeteer from 'puppeteer-core';

const AUTH_BYPASS_USER_ID = '00000000-0000-0000-0000-000000000001';
const PORT = Number(process.env.VERIFY_PORT || 4177);
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = process.env.CHROME_PATH || '/usr/local/bin/google-chrome';
const report = {
  previewOrLocalUrl: BASE,
  invoiceId: null,
  recoveryInvoiceId: null,
  finalisedInvoiceId: null,
  dbProof: null,
  duplicateCheck: null,
  steps: [],
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

function dbSnapshot(dbPath, invoiceId) {
  const db = new Database(dbPath, { readonly: true });
  try {
    const header = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId);
    const lines = db
      .prepare(
        'SELECT description, quantity, unit_price, gst_applicable FROM invoice_line_items WHERE invoice_id = ? ORDER BY rowid ASC',
      )
      .all(invoiceId);
    const titleCount = db
      .prepare('SELECT COUNT(*) AS count FROM invoices WHERE title = ?')
      .get(header?.title ?? '');
    const idCount = db.prepare('SELECT COUNT(*) AS count FROM invoices WHERE id = ?').get(invoiceId);
    return { header, lines, titleCount: titleCount.count, idCount: idCount.count };
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
  // Do not point at real Supabase — fake bearer must fall through to auth bypass.
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_ANON_KEY;
  delete process.env.SUPABASE_PUBLISHABLE_KEY;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  process.env.NODE_ENV = 'test';
  process.env.AI_BUSINESS_OS_TEST_AUTH_BYPASS = '1';
  process.env.ENABLE_BROWSER_APP = '1';

  const dir = mkdtempSync(join(tmpdir(), 'invoice-persist-browser-'));
  const dbPath = join(dir, 'verify.sqlite');
  process.env.DB_PATH = dbPath;
  process.env.PORT = String(PORT);
  process.env.PUBLIC_APP_URL = BASE;
  process.env.CORS_ORIGIN = BASE;

  const { buildApp } = await import('../dist/src/app.js').catch(async () => {
    // Prefer built app; fall back to tsx-compiled source via dynamic import of ts through vitest path.
    return import('../src/app.ts');
  });

  // Touch DB schema then seed actor.
  const bootstrap = await buildApp({
    dbPath,
    authBypassForTesting: true,
    serveFrontend: true,
    nodeEnv: 'test',
    supabaseUrl: undefined,
    supabaseAnonKey: undefined,
  });
  await bootstrap.db.upsertBusinessProfile({
    companyName: 'Persistence Verify Co',
    legalName: 'Persistence Verify Co Pty Ltd',
    abnTaxId: '51824753556',
    address: '1 Verification St, Sydney NSW 2000',
    email: 'verify@example.test',
    phone: '0400000000',
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
  // Hard refresh with a dirty invoice form triggers beforeunload — accept like a user would.
  page.on('dialog', async (dialog) => {
    try {
      await dialog.accept();
    } catch {
      /* dialog may already be handled */
    }
  });

  // Seed SPA session before first navigation.
  const gotoApp = async (path) => {
    await page.goto(BASE + path, { waitUntil: 'domcontentloaded' });
    await new Promise((r) => setTimeout(r, 400));
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
  });
  await gotoApp('/dashboard');
  await waitFor(
    page,
    async () => !(await page.url()).includes('/sign-in'),
    20000,
    'authenticated dashboard',
  );
  step('signed_in_via_auth_bypass');

  // Ensure a customer exists via API (faster / deterministic).
  const customerResp = await page.evaluate(async () => {
    const response = await fetch('/api/customers', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer test-bypass-token',
      },
      body: JSON.stringify({
        displayName: 'Browser Persist Customer',
        email: 'browser.persist@example.test',
      }),
    });
    return { status: response.status, body: await response.json() };
  });
  if (customerResp.status !== 201) throw new Error('Failed to create customer: ' + JSON.stringify(customerResp));
  const customerId = customerResp.body.id;
  step('customer_created', customerId);

  // 1) Open new invoice workspace
  await gotoApp('/workspace/invoices/new');
  await waitFor(page, async () => Boolean(await page.$('#invoice-editor-form')), 15000, 'invoice form');

  // Fill customer, title, three lines
  await page.select('[data-invoice-field="customerId"]', customerId);
  await page.click('[data-invoice-field="title"]', { clickCount: 3 });
  await page.type('[data-invoice-field="title"]', 'Browser P0 Persistence Draft');

  async function setLine(index, description, qty, price, gst = true) {
    const rows = await page.$$('[data-invoice-line]');
    while (rows.length <= index) {
      await page.click('[data-add-line]');
      await new Promise((r) => setTimeout(r, 100));
      rows.push(...(await page.$$('[data-invoice-line]')).slice(rows.length));
    }
    const row = (await page.$$('[data-invoice-line]'))[index];
    const desc = await row.$('[data-invoice-field="description"]');
    await desc.click({ clickCount: 3 });
    await desc.type(description);
    const quantity = await row.$('[data-invoice-field="quantity"]');
    await quantity.click({ clickCount: 3 });
    await quantity.type(String(qty));
    const unitPrice = await row.$('[data-invoice-field="unitPrice"]');
    await unitPrice.click({ clickCount: 3 });
    await unitPrice.type(String(price));
    const gstSelect = await row.$('[data-invoice-field="gstApplicable"]');
    if (gstSelect) await gstSelect.select(gst ? 'true' : 'false');
  }

  // Ensure we have add-line control; workspace may start with 1 blank line.
  const addSelector = (await page.$('[data-add-line]'))
    ? '[data-add-line]'
    : '[data-add-line]';
  // Fill first three lines (add extras as needed)
  await setLine(0, 'Labour', 2, 100, true);
  if ((await page.$$('[data-invoice-line]')).length < 2) await page.click(addSelector);
  await setLine(1, 'Parts', 1, 50, false);
  if ((await page.$$('[data-invoice-line]')).length < 3) await page.click(addSelector);
  await setLine(2, 'Travel', 3, 20, true);
  step('draft_form_filled', '3 line items');

  // 2) Wait >1.2s for autosave; URL should become /edit/:id
  await new Promise((r) => setTimeout(r, 2500));
  await waitFor(
    page,
    async () => /\/workspace\/invoices\/[^/]+\/edit$/.test(page.url()),
    20000,
    'autosave URL rewrite to /edit/:id',
  );
  const editUrl = page.url();
  const invoiceId = editUrl.match(/\/workspace\/invoices\/([^/]+)\/edit$/)?.[1];
  if (!invoiceId) throw new Error('No invoice id in URL: ' + editUrl);
  report.invoiceId = invoiceId;
  step('autosave_url_changed', editUrl);

  let snap = dbSnapshot(dbPath, invoiceId);
  if (!snap.header) throw new Error('Invoice missing from DB after autosave');
  if (snap.lines.length !== 3) throw new Error('Expected 3 committed lines, got ' + snap.lines.length);
  if (snap.titleCount !== 1) throw new Error('Duplicate invoices for title: ' + snap.titleCount);
  report.dbProof = {
    afterAutosave: {
      id: snap.header.id,
      title: snap.header.title,
      status: snap.header.status,
      lineCount: snap.lines.length,
      lines: snap.lines,
    },
  };
  step('db_committed_after_autosave', `${snap.lines.length} lines, titleCount=${snap.titleCount}`);

  // 3) Hard refresh
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitFor(page, async () => Boolean(await page.$('#invoice-editor-form')), 15000, 'form after refresh');
  const afterRefresh = await page.evaluate(() => {
    const form = document.querySelector('#invoice-editor-form');
    return {
      url: location.pathname,
      recordId: form?.dataset.recordId || null,
      customerId: form?.querySelector('[name="customerId"]')?.value || '',
      title: form?.querySelector('[name="title"]')?.value || '',
      lines: [...(form?.querySelectorAll('[data-invoice-line]') || [])].map((row) => ({
        description: row.querySelector('[name="description"]')?.value || '',
        quantity: row.querySelector('[name="quantity"]')?.value || '',
        unitPrice: row.querySelector('[name="unitPrice"]')?.value || '',
        gstApplicable: row.querySelector('[name="gstApplicable"]')?.value || '',
      })),
      subtotal: form?.querySelector('[data-total-subtotal]')?.textContent || '',
      gst: form?.querySelector('[data-total-gst]')?.textContent || '',
      total: form?.querySelector('[data-total-grand]')?.textContent || '',
    };
  });
  if (afterRefresh.recordId !== invoiceId) throw new Error('recordId lost after refresh');
  if (afterRefresh.title !== 'Browser P0 Persistence Draft') throw new Error('title lost after refresh');
  if (afterRefresh.customerId !== customerId) throw new Error('customer lost after refresh');
  if (afterRefresh.lines.length !== 3) throw new Error('lines lost after refresh: ' + afterRefresh.lines.length);
  if (afterRefresh.lines[0].description !== 'Labour') throw new Error('line 0 wrong after refresh');
  step('hard_refresh_preserved_state', JSON.stringify(afterRefresh.lines.map((l) => l.description)));

  // 4) Edit: change, add, remove; refresh again
  await setLine(0, 'Labour updated', 4, 110, true);
  await page.click(addSelector);
  await setLine(3, 'Callout', 1, 75, false);
  // Remove Parts (index 1)
  const removeButtons = await page.$$('[data-remove-line]');
  if (removeButtons[1]) await removeButtons[1].click();
  await new Promise((r) => setTimeout(r, 2000));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitFor(page, async () => Boolean(await page.$('#invoice-editor-form')), 15000, 'form after edit refresh');
  const afterEdit = await page.evaluate(() => {
    const form = document.querySelector('#invoice-editor-form');
    return [...(form?.querySelectorAll('[data-invoice-line]') || [])].map((row) => ({
      description: row.querySelector('[name="description"]')?.value || '',
      quantity: Number(row.querySelector('[name="quantity"]')?.value || 0),
      unitPrice: Number(row.querySelector('[name="unitPrice"]')?.value || 0),
    }));
  });
  const descriptions = afterEdit.map((l) => l.description);
  if (!descriptions.includes('Labour updated') || !descriptions.includes('Callout')) {
    throw new Error('Edited state not reloaded: ' + JSON.stringify(descriptions));
  }
  if (descriptions.includes('Parts')) throw new Error('Removed line still present after refresh');
  snap = dbSnapshot(dbPath, invoiceId);
  if (snap.titleCount !== 1) throw new Error('Duplicate created during edit autosave');
  step('edit_refresh_from_api', descriptions.join(', '));

  // 5) Recovery before autosave on a new invoice
  await page.evaluate(() => localStorage.removeItem('aleya-invoice-editor-v3'));
  await gotoApp('/workspace/invoices/new');
  await waitFor(page, async () => Boolean(await page.$('#invoice-editor-form')), 15000, 'new form');
  await page.select('[data-invoice-field="customerId"]', customerId);
  await page.click('[data-invoice-field="title"]', { clickCount: 3 });
  await page.type('[data-invoice-field="title"]', 'Pre-autosave recovery draft');
  await setLine(0, 'Unsaved line A', 1, 10, true);
  // Lock autosave and write localStorage snapshot so refresh stays pre-API.
  await page.evaluate(() => {
    const form = document.querySelector('#invoice-editor-form');
    if (form) form.dataset.autosaveLocked = 'true';
    form?.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await new Promise((r) => setTimeout(r, 150));
  const snapshotBeforeRefresh = await page.evaluate(() =>
    localStorage.getItem('aleya-invoice-editor-v3'),
  );
  if (!snapshotBeforeRefresh || !snapshotBeforeRefresh.includes('Pre-autosave recovery draft')) {
    throw new Error('localStorage snapshot missing before refresh');
  }
  // Confirm no server draft exists yet for this title.
  const preApiCount = await page.evaluate(async () => {
    const response = await fetch('/api/invoices?limit=100', {
      headers: { authorization: 'Bearer test-bypass-token' },
    });
    const body = await response.json();
    return (body.invoices || []).filter((row) => row.title === 'Pre-autosave recovery draft').length;
  });
  if (preApiCount !== 0) throw new Error('API save already happened before recovery refresh');

  // Hard refresh before API save — must restore from localStorage on /new.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitFor(page, async () => Boolean(await page.$('#invoice-editor-form')), 15000, 'recovery form');
  const recovered = await page.evaluate(() => {
    const form = document.querySelector('#invoice-editor-form');
    return {
      url: location.pathname,
      title: form?.querySelector('[name="title"]')?.value || '',
      line: form?.querySelector('[data-invoice-line] [name="description"]')?.value || '',
      snapshot: localStorage.getItem('aleya-invoice-editor-v3'),
    };
  });
  if (recovered.url !== '/workspace/invoices/new') {
    throw new Error('Expected to remain on /new before API save, got ' + recovered.url);
  }
  if (recovered.title !== 'Pre-autosave recovery draft') {
    throw new Error('localStorage did not restore unsaved title: ' + recovered.title);
  }
  if (recovered.line !== 'Unsaved line A') {
    throw new Error('localStorage did not restore unsaved line');
  }
  step('localStorage_recovery_before_autosave');

  // Unlock autosave and allow it to persist successfully.
  await page.evaluate(() => {
    const form = document.querySelector('#invoice-editor-form');
    if (form) form.dataset.autosaveLocked = 'false';
    form?.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.select('[data-invoice-field="customerId"]', customerId);
  await setLine(0, 'Unsaved line A', 1, 10, true);
  await new Promise((r) => setTimeout(r, 2500));
  await waitFor(
    page,
    async () => /\/workspace\/invoices\/[^/]+\/edit$/.test(page.url()),
    20000,
    'recovery draft autosave',
  );
  report.recoveryInvoiceId = page.url().match(/\/workspace\/invoices\/([^/]+)\/edit$/)?.[1];
  const afterSaveSnapshot = await page.evaluate(() =>
    localStorage.getItem('aleya-invoice-editor-v3'),
  );
  // Snapshot may still exist with recordId, or be cleared after Save Draft path — either way must not override DB.
  const recoveryGet = await page.evaluate(async (id) => {
    const response = await fetch('/api/invoices/' + id, {
      headers: { authorization: 'Bearer test-bypass-token' },
    });
    return response.json();
  }, report.recoveryInvoiceId);
  if (recoveryGet.title !== 'Pre-autosave recovery draft') {
    throw new Error('Recovery draft not in DB');
  }
  if (afterSaveSnapshot) {
    const parsed = JSON.parse(afterSaveSnapshot);
    if (parsed.recordId && parsed.recordId !== report.recoveryInvoiceId) {
      throw new Error('Stale localStorage overrides a different DB record');
    }
  }
  step('recovery_saved_and_snapshot_safe', report.recoveryInvoiceId);

  // 6/7) Browser restart + logout/login simulation: clear storage, reopen draft from DB
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
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
  });
  await gotoApp(`/workspace/invoices/${invoiceId}/edit`);
  await waitFor(page, async () => Boolean(await page.$('#invoice-editor-form')), 15000, 'reopen after login');
  const afterLogin = await page.evaluate(() => {
    const form = document.querySelector('#invoice-editor-form');
    return {
      title: form?.querySelector('[name="title"]')?.value || '',
      lines: [...(form?.querySelectorAll('[data-invoice-line]') || [])].map(
        (row) => row.querySelector('[name="description"]')?.value || '',
      ),
    };
  });
  if (afterLogin.title !== 'Browser P0 Persistence Draft') {
    throw new Error('Draft not loaded from DB after login');
  }
  if (!afterLogin.lines.includes('Labour updated')) {
    throw new Error('Committed lines missing after login: ' + afterLogin.lines.join(','));
  }
  step('browser_restart_logout_login_reload', afterLogin.lines.join(', '));

  // 8) Finalise (Issue) — same id, no duplicate
  const finalise = await page.evaluate(async (id) => {
    // Save current workspace first (manual Save path)
    const form = document.querySelector('#invoice-editor-form');
    const saveBtn = form?.querySelector('[data-invoice-action="save"]');
    if (saveBtn) saveBtn.click();
    await new Promise((r) => setTimeout(r, 1500));
    const response = await fetch('/api/invoices/' + id + '/finalise', {
      method: 'POST',
      headers: { authorization: 'Bearer test-bypass-token' },
    });
    return { status: response.status, body: await response.json() };
  }, invoiceId);
  if (finalise.status !== 200) throw new Error('Finalise failed: ' + JSON.stringify(finalise));
  if (finalise.body.id !== invoiceId) throw new Error('Finalise returned different id');
  if (finalise.body.status !== 'Finalised') throw new Error('Not finalised');
  report.finalisedInvoiceId = invoiceId;

  await gotoApp(`/workspace/invoices/${invoiceId}/edit`);
  // Final invoices are locked from edit — should redirect/toast; reopen via API proof
  const finalGet = await page.evaluate(async (id) => {
    const response = await fetch('/api/invoices/' + id, {
      headers: { authorization: 'Bearer test-bypass-token' },
    });
    return response.json();
  }, invoiceId);
  if (finalGet.status !== 'Finalised') throw new Error('Final status lost');
  if (!Array.isArray(finalGet.lineItems) || finalGet.lineItems.length < 2) {
    throw new Error('Final line items missing');
  }

  snap = dbSnapshot(dbPath, invoiceId);
  report.dbProof.afterFinalise = {
    id: snap.header.id,
    status: snap.header.status,
    invoice_number: snap.header.invoice_number,
    lineCount: snap.lines.length,
    lines: snap.lines,
  };
  report.duplicateCheck = {
    titleCount: snap.titleCount,
    idCount: snap.idCount,
  };
  if (snap.titleCount !== 1 || snap.idCount !== 1) {
    throw new Error('Duplicate invoice detected after finalise');
  }
  step('finalise_no_duplicate', snap.header.invoice_number);

  report.ok = true;
  await browser.close();
  await app.close();
  mkdirSync('/opt/cursor/artifacts', { recursive: true });
  writeFileSync(
    '/opt/cursor/artifacts/invoice-persistence-browser-verify.json',
    JSON.stringify(report, null, 2),
  );
  console.log('\nVERIFICATION_OK');
  console.log(JSON.stringify(report, null, 2));
  rmSync(dir, { recursive: true, force: true });
}

main().catch(async (error) => {
  console.error('\nVERIFICATION_FAILED', error);
  report.ok = false;
  report.error = String(error?.stack || error);
  try {
    mkdirSync('/opt/cursor/artifacts', { recursive: true });
    writeFileSync(
      '/opt/cursor/artifacts/invoice-persistence-browser-verify.json',
      JSON.stringify(report, null, 2),
    );
  } catch {
    /* ignore */
  }
  process.exit(1);
});
