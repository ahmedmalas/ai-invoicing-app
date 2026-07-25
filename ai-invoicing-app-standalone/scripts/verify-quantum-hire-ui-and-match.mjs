/**
 * Production checks:
 * 1) Quantum Hire editor uses the dedicated .qh-page shell (not .invoice-sheet)
 * 2) Export a Cart N Tip #107–matched invoice and pixel-diff vs reference
 */
import { mkdirSync, writeFileSync, readFileSync, copyFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import puppeteer from 'puppeteer-core';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const BASE = process.env.ALEYA_PROD_URL || 'https://ai-invoicing-app.vercel.app';
const EMAIL = process.env.ALEYA_TEST_EMAIL || 'aleya.launch.validator@cursor.local';
const PASSWORD = process.env.ALEYA_TEST_PASSWORD || 'Guildford1234!';
const OUT = process.env.ALEYA_EVIDENCE_DIR || '/opt/cursor/artifacts/quantum-hire-dedicated-ui/prod-match';
const REF =
  [
    join(ROOT, 'fixtures/reference-invoices/Cart_N_Tip_107.pdf'),
    join(ROOT, 'tests/fixtures/reference-invoices/Cart_N_Tip_107.pdf'),
  ].find((p) => existsSync(p)) || null;

mkdirSync(OUT, { recursive: true });

function chromePath() {
  for (const candidate of [
    process.env.CHROME_PATH,
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
  ]) {
    if (!candidate) continue;
    try {
      readFileSync(candidate);
      return candidate;
    } catch {
      /* continue */
    }
  }
  throw new Error('Chrome/Chromium not found');
}

async function signIn() {
  const response = await fetch(`${BASE}/api/auth/sign-in`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.access_token) {
    throw new Error(`Sign-in failed: ${response.status}`);
  }
  return body;
}

async function api(page, path, options = {}) {
  return page.evaluate(
    async (path, options) => {
      const session = JSON.parse(localStorage.getItem('aboss-invoicing-session') || 'null');
      const headers = {
        'content-type': 'application/json',
        ...(options.headers || {}),
      };
      if (session?.access_token) headers.authorization = `Bearer ${session.access_token}`;
      const response = await fetch(path, { ...options, headers });
      const text = await response.text();
      let body = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = text;
      }
      return { status: response.status, body };
    },
    path,
    options,
  );
}

async function apiBinary(page, path) {
  return page.evaluate(async (path) => {
    const session = JSON.parse(localStorage.getItem('aboss-invoicing-session') || 'null');
    const response = await fetch(path, {
      headers: { authorization: `Bearer ${session.access_token}` },
    });
    const buf = await response.arrayBuffer();
    return {
      status: response.status,
      contentType: response.headers.get('content-type'),
      bytes: Array.from(new Uint8Array(buf)),
    };
  }, path);
}

async function main() {
  if (!REF) throw new Error('Reference PDF missing');
  const browser = await puppeteer.launch({
    executablePath: chromePath(),
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--window-size=1440,1100'],
    defaultViewport: { width: 1440, height: 1100 },
  });
  const page = await browser.newPage();
  const report = { base: BASE, ok: false, steps: [] };

  try {
    const session = await signIn();
    await page.goto(`${BASE}/sign-in`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
    await page.evaluate((value) => {
      localStorage.setItem('aboss-invoicing-session', JSON.stringify(value));
    }, session);
    await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle2', timeout: 90_000 });

    const identity = await page.evaluate(async () => (await fetch('/assets/build-identity.js')).text());
    writeFileSync(join(OUT, 'build-identity.js.txt'), identity);
    report.identitySnippet = identity.slice(0, 280);

    const logo = await page.evaluate(async () => {
      const r = await fetch('/assets/quantum-hire-logo.png');
      return { status: r.status, type: r.headers.get('content-type'), bytes: (await r.arrayBuffer()).byteLength };
    });
    report.steps.push({ step: 'brand-logo-asset', ...logo });
    if (logo.status !== 200 || logo.bytes < 1000) throw new Error('quantum-hire logo asset missing');

    let listed = await api(page, '/api/invoice-templates');
    let template = (listed.body?.templates || []).find(
      (t) => t.design?.layout?.layoutPreset === 'quantum-hire',
    );
    if (!template) {
      const installed = await api(page, '/api/invoice-templates/install-reference', {
        method: 'POST',
        body: JSON.stringify({ force: false }),
      });
      report.steps.push({ step: 'install-reference', status: installed.status });
      listed = await api(page, '/api/invoice-templates');
      template = (listed.body?.templates || []).find(
        (t) => t.design?.layout?.layoutPreset === 'quantum-hire',
      );
    }
    if (!template) throw new Error('quantum-hire template missing');
    await api(page, `/api/invoice-templates/${template.id}/default`, { method: 'POST' });

    const customerName = `Cart and Tip Pty Ltd`;
    const customers = await api(page, '/api/customers');
    let customer =
      (customers.body?.customers || []).find((c) => c.displayName === customerName) || null;
    if (!customer) {
      const createdCustomer = await api(page, '/api/customers', {
        method: 'POST',
        body: JSON.stringify({
          displayName: customerName,
          email: null,
          phone: null,
          address: null,
        }),
      });
      if (createdCustomer.status !== 201) throw new Error('customer create failed');
      customer = createdCustomer.body;
    }

    const lineItems = [
      { description: '29/06/2026 Labour Hire - Day Shift', quantity: 1, unitPrice: 350, gstApplicable: true },
      { description: '30/06/2026 Labour Hire - Day Shift', quantity: 1, unitPrice: 350, gstApplicable: true },
      { description: '01/07/2026 Labour Hire - Day Shift', quantity: 1, unitPrice: 350, gstApplicable: true },
      { description: '02/07/2026 Labour Hire - Day Shift', quantity: 1, unitPrice: 350, gstApplicable: true },
      { description: '03/07/2026 Labour Hire - Day Shift', quantity: 1, unitPrice: 350, gstApplicable: true },
      { description: '03/07/2026 Labour Hire - Night Shift', quantity: 1, unitPrice: 350, gstApplicable: true },
    ];

    const created = await api(page, '/api/invoices', {
      method: 'POST',
      body: JSON.stringify({
        customerId: customer.id,
        title: 'Cart N Tip recreation verify',
        issueDate: '2026-07-06',
        dueDate: '2026-07-13',
        paymentTerms: '7 Days',
        notes:
          'Payment is required within 7 days from the invoice date.\nThank you for your business.',
        templateId: template.id,
        lineItems,
      }),
    });
    if (created.status !== 201) throw new Error('invoice create failed: ' + JSON.stringify(created.body));
    const invoiceId = created.body.id;
    report.steps.push({ step: 'create-match-invoice', id: invoiceId });

    await page.goto(`${BASE}/workspace/invoices/${invoiceId}/edit`, {
      waitUntil: 'networkidle2',
      timeout: 90_000,
    });
    await page.waitForSelector('[data-invoice-editor]', { timeout: 45_000 });
    const ui = await page.evaluate(() => {
      const root = document.querySelector('[data-invoice-editor]');
      const form = document.querySelector('#invoice-editor-form');
      return {
        layoutPreset: root?.getAttribute('data-layout-preset') || form?.getAttribute('data-layout-preset') || null,
        hasQhPage: Boolean(document.querySelector('.qh-page')),
        hasQhTable: Boolean(document.querySelector('.qh-lines-table')),
        hasInvoiceSheet: Boolean(document.querySelector('.invoice-sheet')),
        titleText: document.querySelector('.qh-title')?.textContent?.trim() || null,
        tableHeaders: Array.from(document.querySelectorAll('.qh-lines-table thead th')).map((th) =>
          th.textContent.trim(),
        ),
      };
    });
    report.steps.push({ step: 'editor-shell', ...ui });
    await page.screenshot({ path: join(OUT, '01-editor-quantum-hire-shell.png'), fullPage: true });
    if (ui.layoutPreset !== 'quantum-hire') throw new Error('editor layoutPreset is not quantum-hire');
    if (!ui.hasQhPage || !ui.hasQhTable) throw new Error('dedicated QH shell missing');
    if (ui.hasInvoiceSheet) throw new Error('standard Aleya .invoice-sheet still present');
    if (ui.titleText !== 'TAX INVOICE') throw new Error('TAX INVOICE heading missing in shell');

    const finalised = await api(page, `/api/invoices/${invoiceId}/finalise`, { method: 'POST' });
    if (finalised.status >= 400) throw new Error('finalise failed');
    report.steps.push({
      step: 'finalise',
      invoiceNumber: finalised.body?.invoiceNumber,
      totals: finalised.body?.totals,
    });

    const pdf = await apiBinary(page, `/api/invoices/${invoiceId}/pdf`);
    if (pdf.status !== 200) throw new Error('pdf failed');
    const prodPdf = join(OUT, 'production-cart-n-tip-match.pdf');
    writeFileSync(prodPdf, Buffer.from(pdf.bytes));
    copyFileSync(REF, join(OUT, 'original-reference.pdf'));
    execFileSync('pdftoppm', ['-png', '-r', '150', '-f', '1', '-l', '1', REF, join(OUT, 'original')], {
      stdio: 'pipe',
    });
    execFileSync(
      'pdftoppm',
      ['-png', '-r', '150', '-f', '1', '-l', '1', prodPdf, join(OUT, 'recreated')],
      { stdio: 'pipe' },
    );

    const diffPy = join(OUT, '_diff.py');
    writeFileSync(
      diffPy,
      `
from PIL import Image, ImageChops, ImageEnhance, ImageOps
import json, os
out = ${JSON.stringify(OUT)}
a = Image.open(os.path.join(out, 'original-1.png')).convert('RGB')
b = Image.open(os.path.join(out, 'recreated-1.png')).convert('RGB')
if a.size != b.size:
    b = b.resize(a.size, Image.Resampling.LANCZOS)
diff = ImageChops.difference(a, b)
gray = ImageOps.grayscale(diff)
changed = sum(1 for p in gray.getdata() if p > 18)
total = a.size[0] * a.size[1]
stats = {"width": a.size[0], "height": a.size[1], "changedPixels": changed, "changedPercent": round(100*changed/total, 3)}
open(os.path.join(out, 'diff-stats.json'), 'w').write(json.dumps(stats))
amp = ImageEnhance.Brightness(diff).enhance(6)
amp.save(os.path.join(out, 'diff-amplified.png'))
overlay = Image.blend(a, amp.convert('RGB'), 0.55)
overlay.save(os.path.join(out, 'diff-overlay.png'))
side = Image.new('RGB', (a.size[0]*2+20, a.size[1]), (240,240,240))
side.paste(a, (0,0)); side.paste(b, (a.size[0]+20,0))
side.save(os.path.join(out, 'side-by-side.png'))
print(json.dumps(stats))
`,
    );
    const stats = JSON.parse(execFileSync('python3', [diffPy], { encoding: 'utf8' }).trim());
    report.diff = stats;
    report.ok = true;
    report.invoice = {
      id: invoiceId,
      number: finalised.body?.invoiceNumber,
      totals: finalised.body?.totals,
    };
  } catch (error) {
    report.ok = false;
    report.error = String(error?.stack || error);
    try {
      await page.screenshot({ path: join(OUT, '99-failure.png'), fullPage: true });
    } catch {
      /* ignore */
    }
  } finally {
    writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2));
    await browser.close();
  }

  if (!report.ok) {
    console.error(JSON.stringify(report, null, 2));
    process.exit(1);
  }
  console.log(JSON.stringify(report, null, 2));
}

main();
