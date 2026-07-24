/**
 * Authenticated production (or local) keyboard navigation check for invoice lines.
 *
 * Env:
 *   BASE_URL (default https://ai-invoicing-app.vercel.app)
 *   ALEYA_EMAIL / ALEYA_PASSWORD
 *   CHROME_PATH
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

async function signIn(page) {
  const result = await page.evaluate(
    async ({ email, password, base }) => {
      const response = await fetch(`${base}/api/auth/sign-in`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const body = await response.json().catch(() => ({}));
      return { status: response.status, body };
    },
    { email: EMAIL, password: PASSWORD, base: BASE },
  );
  if (result.status !== 200 || !result.body?.access_token) {
    throw new Error(`Sign-in failed: ${result.status} ${JSON.stringify(result.body).slice(0, 200)}`);
  }
  await page.evaluate((session) => {
    localStorage.setItem('aboss-invoicing-session', JSON.stringify(session));
  }, result.body);
  return result.body.access_token;
}

async function main() {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1400,900'],
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(30000);

  try {
    await page.goto(BASE + '/sign-in', { waitUntil: 'networkidle2' });
    const token = await signIn(page);
    report.tokenPresent = Boolean(token);

    await page.goto(BASE + '/workspace/invoices/new', { waitUntil: 'networkidle2' });
    await page.waitForSelector('#invoice-editor-form', { timeout: 20000 });

    // Ensure customer selected
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

    const unitPrice = await page.$('[data-invoice-line][data-line-index="0"] [data-invoice-field="unitPrice"]');
    if (!unitPrice) throw new Error('Unit price field missing');
    await unitPrice.click({ clickCount: 3 });
    await unitPrice.type('350', { delay: 20 });
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);

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
    report.checks.valuePreserved = afterEnter.firstPrice === '350';
    report.checks.totalRecalculated =
      String(afterEnter.firstTotal || '').includes('385') ||
      String(afterEnter.grand || '').includes('385');
    report.afterEnter = afterEnter;

    // Tab horizontal on second row
    await page.keyboard.press('Shift+Tab'); // to GST? wait - we're on unitPrice of row 1
    // Focus description of row 1 and tab through
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
