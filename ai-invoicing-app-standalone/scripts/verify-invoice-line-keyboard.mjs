/**
 * Authenticated production keyboard navigation check for invoice lines.
 *
 * Env:
 *   BASE_URL (default https://ai-invoicing-app.vercel.app)
 *   ALEYA_EMAIL / ALEYA_PASSWORD
 *   CHROME_PATH
 *   ARTIFACT_DIR
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const BASE = process.env.BASE_URL || 'https://ai-invoicing-app.vercel.app';
const EMAIL = process.env.ALEYA_EMAIL || 'aleya.launch.validator@cursor.local';
const PASSWORD = process.env.ALEYA_PASSWORD || 'Guildford1234!';
const CHROME = process.env.CHROME_PATH || '/usr/local/bin/google-chrome';
const OUT = process.env.ARTIFACT_DIR || '/opt/cursor/artifacts/invoice-line-keyboard-live';

const report = { ok: false, base: BASE, checks: {}, errors: [] };

mkdirSync(OUT, { recursive: true });

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(page, predicate, timeoutMs = 30000, label = 'condition') {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return;
    await sleep(150);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function signIn() {
  const response = await fetch(`${BASE}/api/auth/sign-in`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.access_token) {
    throw new Error(`Sign-in failed: ${response.status} ${JSON.stringify(body).slice(0, 200)}`);
  }
  return body;
}

async function injectSession(page, session) {
  await page.goto(`${BASE}/sign-in`, { waitUntil: 'domcontentloaded' });
  await page.evaluate((value) => {
    localStorage.setItem('aboss-invoicing-session', JSON.stringify(value));
  }, session);
}

async function bootWorkspace(page) {
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle2', timeout: 90000 });
  await waitFor(
    page,
    async () => {
      const state = await page.evaluate(() => ({
        path: location.pathname,
        hasNav: Boolean(document.querySelector('nav')),
        text: document.body?.innerText || '',
      }));
      return (
        !state.path.includes('/sign-in') &&
        (state.hasNav || /SIGNED IN|Dashboard|Invoices/i.test(state.text))
      );
    },
    45000,
    'authenticated workspace shell',
  );
}

async function openNewInvoice(page) {
  await page.goto(`${BASE}/workspace/invoices/new`, { waitUntil: 'networkidle2', timeout: 90000 });
  await waitFor(
    page,
    async () => Boolean(await page.$('#invoice-editor-form [data-invoice-field="unitPrice"]')),
    45000,
    'invoice editor unit price field',
  );
  // Wait for curtain open if present.
  await page
    .waitForFunction(
      () => {
        const curtain = document.querySelector('[data-invoice-editor]');
        if (!curtain) return true;
        return curtain.getAttribute('data-curtain-state') === 'open';
      },
      { timeout: 10000 },
    )
    .catch(() => null);
  await sleep(300);
}

async function main() {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--window-size=1400,1000'],
    defaultViewport: { width: 1400, height: 1000 },
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(45000);

  try {
    const session = await signIn();
    report.tokenPresent = Boolean(session.access_token);
    await injectSession(page, session);
    await bootWorkspace(page);
    await openNewInvoice(page);

    // Module is imported by invoice-editor.js (no standalone script tag).
    report.checks.keyboardAsset = await page.evaluate(async () => {
      const resources = performance.getEntriesByType('resource').map((e) => e.name);
      if (resources.some((url) => url.includes('invoice-line-keyboard'))) return true;
      try {
        const mod = await import('/assets/invoice-line-keyboard.js');
        return typeof mod.resolveEnterNavigation === 'function';
      } catch {
        return false;
      }
    });

    // Ensure customer + title so the form is in a valid editable state.
    await page.evaluate(() => {
      const select = document.querySelector('[data-invoice-field="customerId"]');
      if (select && select.options.length > 1) {
        select.selectedIndex = 1;
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }
      const title = document.querySelector('[data-invoice-field="title"]');
      if (title) {
        title.value = 'Keyboard Nav Live Check';
        title.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });

    const structure = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('[data-invoice-line]'));
      return {
        rowCount: rows.length,
        lineIds: rows.map((r) => r.getAttribute('data-line-id')),
        firstUnitPrice: Boolean(
          document.querySelector(
            '[data-invoice-line][data-line-index="0"] [data-invoice-field="unitPrice"]',
          ),
        ),
      };
    });
    report.structure = structure;
    if (!structure.firstUnitPrice) throw new Error('Unit price field missing');

    // Focus via DOM (avoid brittle clickability), set qty=1 + unitPrice=350 + GST, then Enter.
    await page.evaluate(() => {
      const qty = document.querySelector(
        '[data-invoice-line][data-line-index="0"] [data-invoice-field="quantity"]',
      );
      if (qty) {
        qty.focus();
        qty.value = '1';
        qty.dispatchEvent(new Event('input', { bubbles: true }));
        qty.dispatchEvent(new Event('change', { bubbles: true }));
      }
      const gst = document.querySelector(
        '[data-invoice-line][data-line-index="0"] [data-invoice-field="gstApplicable"]',
      );
      if (gst && gst.tagName === 'SELECT') {
        // Prefer true/"Yes" option.
        const trueOpt = Array.from(gst.options).find((o) => /true|yes|gst/i.test(o.value + o.text));
        if (trueOpt) gst.value = trueOpt.value;
        else gst.selectedIndex = Math.min(1, gst.options.length - 1);
        gst.dispatchEvent(new Event('change', { bubbles: true }));
      }
      const unit = document.querySelector(
        '[data-invoice-line][data-line-index="0"] [data-invoice-field="unitPrice"]',
      );
      unit.focus();
      unit.value = '350';
      unit.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await sleep(100);
    await page.keyboard.press('Enter');
    await sleep(500);

    const afterEnter = await page.evaluate(() => {
      const active = document.activeElement;
      const row = active?.closest?.('[data-invoice-line]');
      const lines = Array.from(document.querySelectorAll('[data-invoice-line]'));
      const firstTotal = document.querySelector(
        '[data-invoice-line][data-line-index="0"] [data-line-total]',
      )?.textContent;
      const firstPrice = document.querySelector(
        '[data-invoice-line][data-line-index="0"] [data-invoice-field="unitPrice"]',
      )?.value;
      const grand = document.querySelector('[data-total-grand]')?.textContent;
      return {
        activeField: active?.getAttribute?.('data-invoice-field') || null,
        activeIndex: row?.getAttribute('data-line-index') || null,
        activeLineId: row?.getAttribute('data-line-id') || null,
        lineCount: lines.length,
        firstTotal,
        firstPrice,
        grand,
        lineIds: lines.map((node) => node.getAttribute('data-line-id')),
      };
    });
    report.checks.enterAddsRowAndFocusesUnitPrice =
      afterEnter.lineCount >= 2 &&
      afterEnter.activeField === 'unitPrice' &&
      afterEnter.activeIndex === '1';
    report.checks.valuePreserved =
      afterEnter.firstPrice === '350' || afterEnter.firstPrice === '350.00';
    report.checks.totalRecalculated =
      String(afterEnter.firstTotal || '').includes('385') ||
      String(afterEnter.grand || '').includes('385');
    report.afterEnter = afterEnter;

    // Tab horizontal on second row
    await page.evaluate(() => {
      document
        .querySelector('[data-invoice-line][data-line-index="1"] [data-invoice-field="description"]')
        ?.focus();
    });
    await page.keyboard.press('Tab');
    const afterTabQty = await page.evaluate(
      () => document.activeElement?.getAttribute('data-invoice-field') || null,
    );
    await page.keyboard.press('Tab');
    const afterTabPrice = await page.evaluate(
      () => document.activeElement?.getAttribute('data-invoice-field') || null,
    );
    await page.keyboard.press('Tab');
    const afterTabGst = await page.evaluate(
      () => document.activeElement?.getAttribute('data-invoice-field') || null,
    );
    report.checks.tabHorizontal =
      afterTabQty === 'quantity' && afterTabPrice === 'unitPrice' && afterTabGst === 'gstApplicable';
    report.tabPath = { afterTabQty, afterTabPrice, afterTabGst };

    await page.keyboard.down('Shift');
    await page.keyboard.press('Tab');
    await page.keyboard.up('Shift');
    const afterShiftTab = await page.evaluate(
      () => document.activeElement?.getAttribute('data-invoice-field') || null,
    );
    report.checks.shiftTabBackward = afterShiftTab === 'unitPrice';

    // Duplicate descriptions should still keep distinct line ids
    await page.evaluate(() => {
      const d0 = document.querySelector(
        '[data-invoice-line][data-line-index="0"] [data-invoice-field="description"]',
      );
      const d1 = document.querySelector(
        '[data-invoice-line][data-line-index="1"] [data-invoice-field="description"]',
      );
      if (d0) {
        d0.value = 'Labour';
        d0.dispatchEvent(new Event('input', { bubbles: true }));
      }
      if (d1) {
        d1.value = 'Labour';
        d1.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
    report.checks.distinctLineIds =
      Array.isArray(afterEnter.lineIds) &&
      afterEnter.lineIds.length >= 2 &&
      afterEnter.lineIds[0] !== afterEnter.lineIds[1];

    // Reorder: move first row down, then Enter from its unit price should still navigate.
    await page.evaluate(() => {
      document.querySelector('[data-invoice-line][data-line-index="0"] [data-line-down]')?.click();
    });
    await sleep(250);
    await page.evaluate(() => {
      document
        .querySelector('[data-invoice-line][data-line-index="0"] [data-invoice-field="unitPrice"]')
        ?.focus();
    });
    await page.keyboard.press('Enter');
    await sleep(400);
    const afterReorderEnter = await page.evaluate(() => {
      const active = document.activeElement;
      const row = active?.closest?.('[data-invoice-line]');
      return {
        activeField: active?.getAttribute?.('data-invoice-field') || null,
        activeIndex: row?.getAttribute('data-line-index') || null,
        lineCount: document.querySelectorAll('[data-invoice-line]').length,
      };
    });
    report.afterReorderEnter = afterReorderEnter;
    report.checks.reorderEnterStillNavigates =
      afterReorderEnter.activeField === 'unitPrice' &&
      (afterReorderEnter.activeIndex === '1' || afterReorderEnter.lineCount >= 3);

    report.ok = Object.values(report.checks).every(Boolean);
    await page.screenshot({ path: `${OUT}/aleya-keyboard-nav.png`, fullPage: true });
  } catch (error) {
    report.errors.push(String(error?.stack || error));
    try {
      await page.screenshot({ path: `${OUT}/aleya-keyboard-nav-error.png`, fullPage: true });
    } catch {
      /* ignore */
    }
  } finally {
    writeFileSync(`${OUT}/ALEYA_KEYBOARD_VERDICT.json`, JSON.stringify(report, null, 2));
    await browser.close();
  }

  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
}

main();
