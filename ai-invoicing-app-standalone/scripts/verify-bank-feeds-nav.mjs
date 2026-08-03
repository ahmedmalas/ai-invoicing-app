/**
 * Local browser proof: Settings → Bank Feeds tab + sidebar Banking → /workspace/banking.
 */
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import puppeteer from 'puppeteer-core';

const AUTH_BYPASS_USER_ID = '00000000-0000-0000-0000-000000000001';
const PORT = Number(process.env.VERIFY_PORT || 4215);
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = process.env.CHROME_PATH || '/usr/local/bin/google-chrome';
const OUT = process.env.ARTIFACT_DIR || '/opt/cursor/artifacts/bank-feeds-retired';
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
  const dir = mkdtempSync(join(tmpdir(), 'bank-feeds-nav-'));
  const dbPath = join(dir, 'verify.sqlite');
  process.env.DB_PATH = dbPath;
  process.env.PORT = String(PORT);
  process.env.PUBLIC_APP_URL = BASE;
  process.env.CORS_ORIGIN = BASE;

  const { buildApp } = await import('../src/app.ts');
  const bootstrap = await buildApp({
    dbPath,
    authBypassForTesting: true,
    serveFrontend: true,
    nodeEnv: 'test',
    supabaseUrl: undefined,
    supabaseAnonKey: undefined,
  });
  await bootstrap.db.upsertBusinessProfile({
    companyName: 'Bank Feeds Nav Co',
    legalName: 'Bank Feeds Nav Co Pty Ltd',
    abnTaxId: '51824753556',
    address: '1 Feed St, Sydney NSW 2000',
    email: 'feeds@example.test',
    phone: '0400000099',
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
    defaultViewport: { width: 1440, height: 1100 },
  });
  const page = await browser.newPage();

  try {
    await page.goto(BASE + '/sign-in', { waitUntil: 'networkidle0' });
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
    await page.goto(BASE + '/dashboard', { waitUntil: 'networkidle0' });
    await waitFor(page, async () => !(await page.url()).includes('/sign-in'), 20000, 'dashboard');
    await waitFor(
      page,
      async () => (await page.$$('.sidebar-nav .nav-item')).length >= 10,
      20000,
      'sidebar nav items',
    );

    const navLabels = await page.$$eval('.sidebar-nav .nav-item span:last-child', (nodes) =>
      nodes.map((n) => n.textContent?.trim() || ''),
    );
    report.checks.banking_nav_present = navLabels.includes('Banking');
    if (!report.checks.banking_nav_present) {
      throw new Error('Banking missing from sidebar: ' + JSON.stringify(navLabels));
    }
    step('banking_nav_present', navLabels.join(' | '));
    report.checks.banking_nav_href = Boolean(
      await page.$('a.nav-item[href="/workspace/banking"]'),
    );
    await page.screenshot({ path: join(OUT, 'sidebar-banking-nav.png'), fullPage: false });

    // Prefer in-app navigation: full reloads of ?tab=bank-feeds are flaky under Chromium
    // dynamic module loading in headless CI.
    await page.evaluate(() => {
      history.pushState({}, '', '/settings?tab=bank-feeds');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await sleep(300);
    await waitFor(
      page,
      async () => Boolean(await page.$('[data-settings-tab="bank-feeds"].active')),
      15000,
      'active Bank Feeds tab',
    );
    await waitFor(
      page,
      async () => Boolean(await page.$('[data-settings-bank-feeds]')),
      20000,
      'bank feeds panel',
    );
    const settingsTabs = await page.$$eval('[data-settings-tab]', (nodes) =>
      nodes.map((n) => ({
        tab: n.getAttribute('data-settings-tab'),
        label: n.textContent?.trim(),
        active: n.classList.contains('active'),
      })),
    );
    report.checks.settings_bank_feeds_tab = settingsTabs.some(
      (t) => t.tab === 'bank-feeds' && t.active,
    );
    const panelText = await page.$eval('[data-settings-bank-feeds]', (el) => el.textContent || '');
    report.checks.bank_feeds_panel = /Bank feeds are not connected yet/i.test(panelText);
    report.checks.bank_feeds_placeholder_action =
      /Connect bank account/i.test(panelText) &&
      Boolean(await page.$('button[disabled]'));
    report.checks.bank_feeds_no_basiq_flow = !/AuthLink|Basiq/i.test(panelText);
    step('settings_bank_feeds', panelText.slice(0, 220).replace(/\s+/g, ' '));
    await page.screenshot({ path: join(OUT, 'settings-tabs.png'), fullPage: false });
    await page.screenshot({ path: join(OUT, 'settings-bank-feeds.png'), fullPage: true });

    await page.evaluate(() => {
      history.pushState({}, '', '/workspace/banking');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await sleep(300);
    await waitFor(
      page,
      async () => Boolean(await page.$('.banking-page h1, .banking-placeholder')),
      20000,
      'banking content',
    );
    const bankingHeading = await page.$eval('h1', (el) => el.textContent?.trim() || '');
    report.checks.banking_page =
      bankingHeading === 'Bank Feeds' || bankingHeading === 'Banking';
    report.checks.banking_placeholder = Boolean(await page.$('.banking-placeholder'));
    step('banking_page', bankingHeading);
    await page.screenshot({ path: join(OUT, 'workspace-banking.png'), fullPage: true });

    report.ok = Object.values(report.checks).every(Boolean);
    if (!report.ok) throw new Error('One or more checks failed: ' + JSON.stringify(report.checks));
    step('all_checks_passed');
  } catch (error) {
    report.errors.push(String(error?.stack || error));
    try {
      await page.screenshot({ path: join(OUT, 'failure.png'), fullPage: true });
    } catch {
      /* ignore */
    }
    throw error;
  } finally {
    writeFileSync(join(OUT, 'nav-verify-report.json'), JSON.stringify(report, null, 2));
    await browser.close();
    await app.close();
  }
}

main()
  .then(() => {
    console.log('BANK_FEEDS_NAV_VERIFY_OK');
    process.exit(0);
  })
  .catch((error) => {
    console.error('BANK_FEEDS_NAV_VERIFY_FAILED', error);
    process.exit(1);
  });
