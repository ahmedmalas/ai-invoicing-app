/**
 * Authenticated Aleya production proof: multi-row select, duplicate, spreadsheet
 * paste, save/reopen, PDF.
 *
 * Env:
 *   BASE_URL (default https://ai-invoicing-app.vercel.app)
 *   ALEYA_EMAIL / ALEYA_PASSWORD
 *   CHROME_PATH
 *   ARTIFACT_DIR
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import zlib from 'node:zlib';
import puppeteer from 'puppeteer-core';

const BASE = process.env.BASE_URL || 'https://ai-invoicing-app.vercel.app';
const EMAIL = process.env.ALEYA_EMAIL || 'aleya.launch.validator@cursor.local';
const PASSWORD = process.env.ALEYA_PASSWORD || 'Guildford1234!';
const CHROME = process.env.CHROME_PATH || '/usr/local/bin/google-chrome';
const OUT = process.env.ARTIFACT_DIR || '/opt/cursor/artifacts/invoice-multirow-clipboard-live';

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
    async () => Boolean(await page.$('[data-line-select]')),
    45000,
    'invoice line select checkbox',
  );
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
    await injectSession(page, session);
    await bootWorkspace(page);
    step('workspace_ready');
    await openNewInvoice(page);
    step('editor_open');

    report.checks.clipboardAsset = await page.evaluate(async () => {
      const resources = performance.getEntriesByType('resource').map((e) => e.name);
      if (resources.some((url) => url.includes('invoice-line-clipboard'))) return true;
      try {
        const mod = await import('/assets/invoice-line-clipboard.js');
        return typeof mod.cloneLinesForClipboard === 'function';
      } catch {
        return false;
      }
    });

    await page.evaluate(() => {
      const select = document.querySelector('[data-invoice-field="customerId"]');
      if (select && select.options.length > 1) {
        select.selectedIndex = 1;
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }
      const title = document.querySelector('[data-invoice-field="title"]');
      if (title) {
        title.value = 'Multirow Clipboard Prod Proof';
        title.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });

    while ((await page.$$('[data-invoice-line]')).length < 3) {
      await page.evaluate(() => document.querySelector('[data-add-line]')?.click());
      await sleep(100);
    }

    await page.evaluate(() => {
      document.querySelectorAll('[data-invoice-line]').forEach((row, index) => {
        const desc = row.querySelector('[data-invoice-field="description"]');
        const qty = row.querySelector('[data-invoice-field="quantity"]');
        const price = row.querySelector('[data-invoice-field="unitPrice"]');
        const gst = row.querySelector('[data-invoice-field="gstApplicable"]');
        if (desc) {
          desc.value = `Labour Hire ${String(index + 8).padStart(2, '0')}-07-26`;
          desc.dispatchEvent(new Event('input', { bubbles: true }));
        }
        if (qty) {
          qty.value = '1';
          qty.dispatchEvent(new Event('input', { bubbles: true }));
          qty.dispatchEvent(new Event('change', { bubbles: true }));
        }
        if (price) {
          price.value = '350';
          price.dispatchEvent(new Event('input', { bubbles: true }));
          price.dispatchEvent(new Event('change', { bubbles: true }));
        }
        if (gst && gst.tagName === 'SELECT') {
          const trueOpt = Array.from(gst.options).find((o) =>
            /true|yes|gst/i.test(`${o.value} ${o.text}`),
          );
          if (trueOpt) gst.value = trueOpt.value;
          else gst.selectedIndex = Math.min(1, gst.options.length - 1);
          gst.dispatchEvent(new Event('change', { bubbles: true }));
        }
      });
    });
    await sleep(200);

    await page.evaluate(() => {
      const boxes = [...document.querySelectorAll('[data-line-select]')];
      boxes[0].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      boxes[2].dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true, shiftKey: true }),
      );
    });
    await sleep(150);
    let sel = await page.evaluate(() => ({
      count: document.querySelector('[data-selection-count]')?.textContent,
      selected: [...document.querySelectorAll('[data-invoice-line].is-selected')].length,
      labels: [...document.querySelectorAll('[data-line-number]')].map((el) => el.textContent),
    }));
    report.checks.shiftSelect = sel.selected === 3 && /3 lines selected/.test(sel.count || '');
    step('shift_select', JSON.stringify(sel));
    await page.screenshot({ path: join(OUT, '01-shift-select.png'), fullPage: true });

    // Clear via Escape, then header select-all (toggle clears when already all-selected).
    await page.keyboard.press('Escape');
    await sleep(100);
    await page.evaluate(() => {
      const header =
        document.querySelector('[data-select-all-lines]') ||
        document.querySelector('[data-line-select-all]');
      header?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    await sleep(100);
    const allSel = await page.evaluate(() => ({
      selected: [...document.querySelectorAll('[data-invoice-line].is-selected')].length,
      count: document.querySelector('[data-selection-count]')?.textContent,
      headerPresent: Boolean(
        document.querySelector('[data-select-all-lines], [data-line-select-all]'),
      ),
    }));
    report.checks.selectAll = allSel.selected === 3 && /3 lines selected/.test(allSel.count || '');
    step('select_all', JSON.stringify(allSel));

    await page.evaluate(() => {
      const btn =
        document.querySelector('[data-duplicate-selected]') ||
        [...document.querySelectorAll('button')].find((b) =>
          /duplicate selected/i.test(b.textContent || ''),
        );
      btn?.click();
    });
    await sleep(300);
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
    await page.screenshot({ path: join(OUT, '02-duplicate-selected.png'), fullPage: true });

    // Focus last row then spreadsheet-paste two more lines below it.
    await page.evaluate(() => {
      const rows = [...document.querySelectorAll('[data-invoice-line]')];
      const last = rows[rows.length - 1];
      last?.querySelector('[data-invoice-field="description"]')?.focus();
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
        grand: document.querySelector('[data-total-grand]')?.textContent,
      };
    });
    report.checks.spreadsheetPaste =
      afterSheet.rows === 8 &&
      afterSheet.hasSheetA &&
      afterSheet.hasSheetB &&
      afterSheet.totals.filter((t) => String(t).includes('385')).length === 8;
    report.afterSheet = afterSheet;
    step('spreadsheet_paste', JSON.stringify(afterSheet));
    await page.screenshot({ path: join(OUT, '03-spreadsheet-paste.png'), fullPage: true });

    await page.keyboard.press('Escape');
    await sleep(100);
    report.checks.escapeClears = await page.evaluate(
      () => document.querySelectorAll('[data-invoice-line].is-selected').length === 0,
    );
    step('escape', String(report.checks.escapeClears));

    // Trigger save if autosave is slow: click save when present.
    await page.evaluate(() => {
      const save =
        document.querySelector('[data-save-invoice]') ||
        document.querySelector('button[type="submit"]') ||
        [...document.querySelectorAll('button')].find((b) => /save/i.test(b.textContent || ''));
      save?.click();
    });
    await sleep(2000);
    await waitFor(
      page,
      async () => /\/workspace\/invoices\/[^/]+\/edit$/.test(page.url()),
      60000,
      'edit url after save',
    );
    const invoiceId = page.url().match(/\/workspace\/invoices\/([^/]+)\/edit$/)?.[1];
    report.invoiceId = invoiceId;
    step('saved', invoiceId);

    await page.reload({ waitUntil: 'networkidle2', timeout: 90000 });
    await waitFor(page, async () => Boolean(await page.$('#invoice-editor-form')), 45000, 'reopen');
    const reopened = await page.evaluate(() => ({
      rows: document.querySelectorAll('[data-invoice-line]').length,
      prices: [...document.querySelectorAll('[data-invoice-field="unitPrice"]')].map((el) => el.value),
      numbers: [...document.querySelectorAll('[data-line-number]')].map((el) => el.textContent),
      totals: [...document.querySelectorAll('[data-line-total]')].map((el) => el.textContent),
      descs: [
        ...document.querySelectorAll('[data-invoice-line] [data-invoice-field="description"]'),
      ].map((el) => el.value),
    }));
    report.checks.reopened =
      reopened.rows === 8 &&
      reopened.prices.filter((p) => p === '350' || p === '350.00').length === 8 &&
      reopened.numbers.join(',') === '1,2,3,4,5,6,7,8' &&
      reopened.descs.includes('Sheet A') &&
      reopened.descs.includes('Sheet B');
    report.reopened = reopened;
    step('reopened', JSON.stringify(reopened));
    await page.screenshot({ path: join(OUT, '04-reopened.png'), fullPage: true });

    const token = session.access_token;
    const pdfResp = await page.evaluate(
      async (id, auth) => {
        const response = await fetch('/api/invoices/' + id + '/pdf', {
          headers: { authorization: 'Bearer ' + auth },
        });
        const buf = new Uint8Array(await response.arrayBuffer());
        return { status: response.status, bytes: Array.from(buf) };
      },
      invoiceId,
      token,
    );
    const pdfBuffer = Buffer.from(pdfResp.bytes);
    writeFileSync(join(OUT, 'multirow-clipboard-prod.pdf'), pdfBuffer);
    const pdfText = extractPdfText(pdfBuffer);
    report.checks.pdf =
      pdfResp.status === 200 &&
      /Sheet A/.test(pdfText) &&
      /Sheet B/.test(pdfText) &&
      /Labour Hire 08-07-26/.test(pdfText) &&
      (/8 line items/.test(pdfText) || (pdfText.match(/Labour Hire|Sheet /g) || []).length >= 8);
    report.pdfSnippet = pdfText.slice(0, 700);
    step('pdf', `status=${pdfResp.status}`);

    report.ok = Object.values(report.checks).every(Boolean);
    await page.screenshot({ path: join(OUT, '05-final.png'), fullPage: true });
  } catch (error) {
    report.errors.push(String(error?.stack || error));
    try {
      await page.screenshot({ path: join(OUT, 'multirow-clipboard-prod-error.png'), fullPage: true });
    } catch {
      /* ignore */
    }
  } finally {
    writeFileSync(join(OUT, 'ALEYA_PROD_MULTIROW_VERDICT.json'), JSON.stringify(report, null, 2));
    await browser.close();
  }
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
}

main();
