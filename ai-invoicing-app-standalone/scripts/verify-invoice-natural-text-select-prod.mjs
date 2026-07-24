/**
 * Authenticated Aleya production proof: no checkboxes, natural description
 * copy with line breaks, line numbers retained, spreadsheet TSV paste.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';

const BASE = process.env.BASE_URL || 'https://ai-invoicing-app.vercel.app';
const EMAIL = process.env.ALEYA_EMAIL || 'aleya.launch.validator@cursor.local';
const PASSWORD = process.env.ALEYA_PASSWORD || 'Guildford1234!';
const CHROME = process.env.CHROME_PATH || '/usr/local/bin/google-chrome';
const OUT = process.env.ARTIFACT_DIR || '/opt/cursor/artifacts/invoice-natural-text-select-live';

const report = {
  ok: false,
  base: BASE,
  deploymentId: process.env.DEPLOYMENT_ID || null,
  commitSha: process.env.COMMIT_SHA || null,
  checks: {},
  errors: [],
  steps: [],
};

mkdirSync(OUT, { recursive: true });

function step(name, detail) {
  report.steps.push({ name, detail, at: new Date().toISOString() });
  console.log(`✓ ${name}${detail ? `: ${detail}` : ''}`);
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
async function waitFor(page, predicate, timeoutMs = 45000, label = 'condition') {
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

async function main() {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--window-size=1400,1000',
    ],
    defaultViewport: { width: 1400, height: 1000 },
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(45000);
  page.on('dialog', async (d) => {
    try {
      await d.accept();
    } catch {
      /* ignore */
    }
  });

  try {
    const session = await signIn();
    report.tokenPresent = Boolean(session.access_token);
    step('signed_in', EMAIL);

    await page.goto(`${BASE}/sign-in`, { waitUntil: 'domcontentloaded' });
    await page.evaluate((value) => {
      localStorage.setItem('aboss-invoicing-session', JSON.stringify(value));
    }, session);
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
      'workspace',
    );
    step('workspace_ready');

    await page.goto(`${BASE}/workspace/invoices/new`, {
      waitUntil: 'networkidle2',
      timeout: 90000,
    });
    await waitFor(
      page,
      async () => Boolean(await page.$('[data-invoice-display="description"]')),
      45000,
      'description display',
    );
    step('editor_open');

    const chromeCheck = await page.evaluate(() => ({
      checkboxes: document.querySelectorAll('[data-line-select], [data-select-all-lines]').length,
      selectCount: Boolean(document.querySelector('[data-selection-count]')),
      duplicateSelected: Boolean(document.querySelector('[data-duplicate-selected]')),
      lineNumbers: [...document.querySelectorAll('[data-line-number]')].map((el) => el.textContent),
      displays: document.querySelectorAll('[data-invoice-display="description"]').length,
    }));
    report.checks.noCheckboxes =
      chromeCheck.checkboxes === 0 && !chromeCheck.selectCount && !chromeCheck.duplicateSelected;
    report.checks.lineNumbers = chromeCheck.lineNumbers.includes('1');
    step('chrome', JSON.stringify(chromeCheck));
    await page.screenshot({ path: join(OUT, '01-no-checkboxes.png'), fullPage: true });

    await page.evaluate(() => {
      const select = document.querySelector('[data-invoice-field="customerId"]');
      if (select && select.options.length > 1) {
        select.selectedIndex = 1;
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }
      const title = document.querySelector('[data-invoice-field="title"]');
      if (title) {
        title.value = 'Natural Text Select Prod Proof';
        title.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });

    while ((await page.$$('[data-invoice-line]')).length < 4) {
      await page.evaluate(() => document.querySelector('[data-add-line]')?.click());
      await sleep(120);
    }

    await page.evaluate(() => {
      document.querySelectorAll('[data-invoice-line]').forEach((row, index) => {
        const descCell = row.querySelector('[data-editable-cell="description"]');
        const desc = descCell?.querySelector('[data-invoice-field="description"]');
        const descDisplay = descCell?.querySelector('[data-invoice-display="description"]');
        const qtyCell = row.querySelector('[data-editable-cell="quantity"]');
        const qty = qtyCell?.querySelector('[data-invoice-field="quantity"]');
        const priceCell = row.querySelector('[data-editable-cell="unitPrice"]');
        const price = priceCell?.querySelector('[data-invoice-field="unitPrice"]');
        const gst = row.querySelector('[data-invoice-field="gstApplicable"]');
        if (desc && descDisplay && descCell) {
          descCell.classList.add('is-editing');
          desc.hidden = false;
          desc.value = `Labour Hire ${String(index + 6).padStart(2, '0')}-07-26`;
          desc.dispatchEvent(new Event('input', { bubbles: true }));
          descDisplay.textContent = desc.value;
          desc.hidden = true;
          descCell.classList.remove('is-editing');
        }
        if (qty && qtyCell) {
          qtyCell.classList.add('is-editing');
          qty.hidden = false;
          qty.value = '1';
          qty.dispatchEvent(new Event('input', { bubbles: true }));
          qtyCell.querySelector('[data-invoice-display]').textContent = '1';
          qty.hidden = true;
          qtyCell.classList.remove('is-editing');
        }
        if (price && priceCell) {
          priceCell.classList.add('is-editing');
          price.hidden = false;
          price.value = '350';
          price.dispatchEvent(new Event('input', { bubbles: true }));
          priceCell.querySelector('[data-invoice-display]').textContent = '350';
          price.hidden = true;
          priceCell.classList.remove('is-editing');
        }
        if (gst && gst.tagName === 'SELECT') {
          const trueOpt = Array.from(gst.options).find((o) =>
            /true|yes|gst/i.test(`${o.value} ${o.text}`),
          );
          if (trueOpt) gst.value = trueOpt.value;
          gst.dispatchEvent(new Event('change', { bubbles: true }));
        }
      });
    });
    await sleep(200);

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
      return { cleaned, clipboard, spanCount: spans.length };
    });
    const sourceText = copied.clipboard || copied.cleaned || '';
    report.checks.dragSelectCopy =
      copied.spanCount === 4 &&
      sourceText ===
        [
          'Labour Hire 06-07-26',
          'Labour Hire 07-07-26',
          'Labour Hire 08-07-26',
          'Labour Hire 09-07-26',
        ].join('\n');
    report.copySample = sourceText;
    step('drag_select_copy', JSON.stringify({ ...copied, ok: report.checks.dragSelectCopy }));
    await page.screenshot({ path: join(OUT, '02-natural-description-copy.png'), fullPage: true });

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
    await sleep(300);
    const afterSheet = await page.evaluate(() => ({
      rows: document.querySelectorAll('[data-invoice-line]').length,
      descs: [...document.querySelectorAll('[data-invoice-display="description"]')].map(
        (el) => el.textContent,
      ),
      totals: [...document.querySelectorAll('[data-line-total]')].map((el) => el.textContent),
      numbers: [...document.querySelectorAll('[data-line-number]')].map((el) => el.textContent),
    }));
    report.checks.spreadsheetPaste =
      afterSheet.rows === 6 &&
      afterSheet.descs.includes('Sheet A') &&
      afterSheet.descs.includes('Sheet B') &&
      afterSheet.totals.filter((t) => String(t).includes('385')).length === 6;
    step('spreadsheet_paste', JSON.stringify(afterSheet));
    await page.screenshot({ path: join(OUT, '03-after-spreadsheet-paste.png'), fullPage: true });

    report.ok = Object.values(report.checks).every(Boolean);
  } catch (error) {
    report.errors.push(String(error?.stack || error));
    try {
      await page.screenshot({ path: join(OUT, 'natural-text-select-prod-error.png'), fullPage: true });
    } catch {
      /* ignore */
    }
  } finally {
    writeFileSync(join(OUT, 'ALEYA_PROD_NATURAL_SELECT_VERDICT.json'), JSON.stringify(report, null, 2));
    await browser.close();
  }
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
}

main();
