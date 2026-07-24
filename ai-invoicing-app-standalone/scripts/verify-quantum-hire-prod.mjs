/**
 * Live production verification for Quantum Hire template workflow.
 * Usage: node scripts/verify-quantum-hire-prod.mjs
 */
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import puppeteer from 'puppeteer-core';

const BASE = process.env.ALEYA_PROD_URL || 'https://ai-invoicing-app.vercel.app';
const EMAIL = process.env.ALEYA_TEST_EMAIL || 'aleya.launch.validator@cursor.local';
const PASSWORD = process.env.ALEYA_TEST_PASSWORD || 'Guildford1234!';
const OUT = process.env.ALEYA_EVIDENCE_DIR || '/opt/cursor/artifacts/quantum-hire-prod-verify';
const SESSION_KEY = 'aboss-invoicing-session';

mkdirSync(OUT, { recursive: true });

function chromePath() {
  for (const candidate of [
    process.env.CHROME_PATH,
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
  ]) {
    if (candidate) {
      try {
        readFileSync(candidate);
        return candidate;
      } catch {
        /* continue */
      }
    }
  }
  throw new Error('Chrome/Chromium not found');
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
      return { status: response.status, body, contentType: response.headers.get('content-type') };
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
    const bytes = Array.from(new Uint8Array(buf));
    return {
      status: response.status,
      contentType: response.headers.get('content-type'),
      bytes,
    };
  }, path);
}

async function main() {
  const browser = await puppeteer.launch({
    executablePath: chromePath(),
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1440,1100'],
    defaultViewport: { width: 1440, height: 1100 },
  });
  const page = await browser.newPage();
  const report = { base: BASE, steps: [] };

  try {
    await page.goto(`${BASE}/sign-in`, { waitUntil: 'networkidle2', timeout: 90_000 });
    await page.waitForSelector('input[name="email"], input[type="email"]', { timeout: 30_000 });
    await page.type('input[name="email"], input[type="email"]', EMAIL, { delay: 10 });
    await page.type('input[name="password"], input[type="password"]', PASSWORD, { delay: 10 });
    await Promise.all([
      page.click('button[type="submit"]'),
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60_000 }).catch(() => null),
    ]);
    await page.waitForFunction(() => localStorage.getItem('aboss-invoicing-session'), {
      timeout: 45_000,
    });
    report.steps.push({ step: 'sign-in', ok: true });

    // Build identity
    const identity = await page.evaluate(async () => {
      const res = await fetch('/assets/build-identity.js');
      return res.text();
    });
    report.identity = identity.slice(0, 400);
    writeFileSync(join(OUT, 'build-identity.js.txt'), identity);

    // Public exposure checks from browser origin
    for (const path of [
      '/fixtures/reference-invoices/Cart_N_Tip_107.pdf',
      '/tests/fixtures/reference-invoices/Cart_N_Tip_107.pdf',
      '/src/assets/branding/quantum-hire-logo.png',
    ]) {
      const res = await page.evaluate(async (path) => {
        const r = await fetch(path);
        const ct = r.headers.get('content-type') || '';
        const buf = await r.arrayBuffer();
        return { status: r.status, contentType: ct, bytes: buf.byteLength };
      }, path);
      report.steps.push({ step: 'public-exposure', path, ...res });
    }

    // Install / list templates
    const installed = await api(page, '/api/invoice-templates/install-reference', {
      method: 'POST',
      body: JSON.stringify({ force: true }),
    });
    report.steps.push({ step: 'install-reference', status: installed.status, body: installed.body });
    if (installed.status >= 400) throw new Error('install-reference failed');

    const listed = await api(page, '/api/invoice-templates');
    report.steps.push({
      step: 'list-templates',
      status: listed.status,
      names: (listed.body?.templates || []).map((t) => ({
        name: t.name,
        isDefault: t.isDefault,
        preset: t.design?.layout?.layoutPreset,
      })),
    });
    const template =
      (listed.body?.templates || []).find((t) => t.isDefault) ||
      (listed.body?.templates || [])[0];
    if (!template) throw new Error('No template available');
    if (template.design?.layout?.layoutPreset !== 'quantum-hire') {
      throw new Error('Default template is not quantum-hire');
    }

    // Ensure default
    await api(page, `/api/invoice-templates/${template.id}/default`, { method: 'POST' });

    // Create distinct customer
    const customerName = `Westbrook Civil Pty Ltd ${Date.now().toString().slice(-6)}`;
    const customer = await api(page, '/api/customers', {
      method: 'POST',
      body: JSON.stringify({
        displayName: customerName,
        email: 'accounts@westbrook-civil.example',
        phone: '0298765432',
        address: '88 Harbour Street, Sydney NSW 2000',
      }),
    });
    report.steps.push({ step: 'create-customer', status: customer.status, name: customerName });
    if (customer.status !== 201) throw new Error('customer create failed');
    const customerId = customer.body.id;

    const lines = [
      {
        description: '14/07/2026 Site induction and safety brief for night crew mobilisation',
        quantity: 1,
        unitPrice: 180,
        gstApplicable: true,
      },
      {
        description: '15/07/2026 Labour Hire - Day Shift',
        quantity: 2.5,
        unitPrice: 95.5,
        gstApplicable: true,
      },
      {
        description: '16/07/2026 Labour Hire - Night Shift with extended overtime coverage across multiple work zones',
        quantity: 3,
        unitPrice: 120,
        gstApplicable: true,
      },
      {
        description: '17/07/2026 Equipment coordination support',
        quantity: 1,
        unitPrice: 240,
        gstApplicable: false,
      },
      {
        description: '18/07/2026 Labour Hire - Day Shift',
        quantity: 1.25,
        unitPrice: 95.5,
        gstApplicable: true,
      },
      {
        description: '19/07/2026 Labour Hire - Day Shift',
        quantity: 1,
        unitPrice: 95.5,
        gstApplicable: true,
      },
      {
        description: '20/07/2026 Labour Hire - Night Shift',
        quantity: 1,
        unitPrice: 120,
        gstApplicable: true,
      },
      {
        description: '21/07/2026 Labour Hire - Day Shift',
        quantity: 4,
        unitPrice: 95.5,
        gstApplicable: true,
      },
      {
        description: '22/07/2026 Weekend callout attendance',
        quantity: 0.5,
        unitPrice: 260,
        gstApplicable: true,
      },
      {
        description: '23/07/2026 Labour Hire - Day Shift',
        quantity: 1,
        unitPrice: 95.5,
        gstApplicable: true,
      },
      {
        description: '24/07/2026 Project close-out admin and timesheet reconciliation',
        quantity: 2,
        unitPrice: 75,
        gstApplicable: true,
      },
    ];

    const created = await api(page, '/api/invoices', {
      method: 'POST',
      body: JSON.stringify({
        customerId,
        title: 'Westbrook Civil labour hire — Jul 2026',
        issueDate: '2026-07-24',
        dueDate: '2026-07-31',
        paymentTerms: '7 Days',
        notes:
          'Payment is required within 7 days from the invoice date.\nThank you for your business.',
        templateId: template.id,
        lineItems: lines,
      }),
    });
    report.steps.push({ step: 'create-invoice', status: created.status, id: created.body?.id });
    if (created.status !== 201) throw new Error('invoice create failed: ' + JSON.stringify(created.body));
    const invoiceId = created.body.id;

    // Open editor UI for screenshot
    await page.goto(`${BASE}/workspace/invoices/${invoiceId}/edit`, {
      waitUntil: 'networkidle2',
      timeout: 90_000,
    });
    await page.waitForSelector('[data-invoice-editor], #invoice-editor-form', { timeout: 45_000 });
    await page.screenshot({ path: join(OUT, '01-editor-live.png'), fullPage: true });
    report.steps.push({ step: 'editor-screenshot', ok: true });

    // Templates page screenshot
    await page.goto(`${BASE}/templates`, { waitUntil: 'networkidle2', timeout: 60_000 });
    await page.waitForSelector('.page-hero, .data-table, .panel', { timeout: 30_000 });
    await page.screenshot({ path: join(OUT, '02-templates-page.png'), fullPage: true });

    // Finalise
    const finalised = await api(page, `/api/invoices/${invoiceId}/finalise`, { method: 'POST' });
    report.steps.push({
      step: 'finalise',
      status: finalised.status,
      invoiceNumber: finalised.body?.invoiceNumber,
      totals: finalised.body?.totals,
    });
    if (finalised.status >= 400) throw new Error('finalise failed: ' + JSON.stringify(finalised.body));
    if (!finalised.body?.invoiceNumber) throw new Error('No invoice number assigned');

    // PDF export
    const pdf = await apiBinary(page, `/api/invoices/${invoiceId}/pdf`);
    report.steps.push({
      step: 'pdf-export',
      status: pdf.status,
      contentType: pdf.contentType,
      bytes: pdf.bytes.length,
    });
    if (pdf.status !== 200) throw new Error('pdf export failed');
    const pdfPath = join(OUT, '03-exported-invoice.pdf');
    writeFileSync(pdfPath, Buffer.from(pdf.bytes));
    try {
      execFileSync('pdftoppm', ['-png', '-r', '140', pdfPath, join(OUT, '04-exported-pdf')], {
        stdio: 'pipe',
      });
    } catch (error) {
      report.steps.push({ step: 'pdf-render', ok: false, error: String(error) });
    }

    // Existing invoices still listable
    const invoices = await api(page, '/api/invoices?limit=20');
    report.steps.push({
      step: 'list-invoices',
      status: invoices.status,
      count: invoices.body?.invoices?.length,
    });

    // Confirm Cart and Tip customer values did not leak into this invoice PDF text via pypdf
    const text = execFileSync('pdftotext', [pdfPath, '-'], { encoding: 'utf8' });
    writeFileSync(join(OUT, '05-exported-pdf.txt'), text);
    const leaks = [];
    if (/Cart and Tip/i.test(text)) leaks.push('Cart and Tip');
    if (/#107\b/.test(text)) leaks.push('#107');
    if (!text.includes(customerName.split(' ')[0])) leaks.push('missing-customer');
    if (!/TAX INVOICE/i.test(text)) leaks.push('missing-title');
    if (!/BILL TO/i.test(text)) leaks.push('missing-bill-to');
    if (!/PAYMENT DETAILS/i.test(text)) leaks.push('missing-payment');
    report.steps.push({ step: 'pdf-text-checks', leaks, invoiceNumber: finalised.body.invoiceNumber });
    if (leaks.length) throw new Error('PDF content checks failed: ' + leaks.join(', '));

    report.ok = true;
    report.invoice = {
      id: invoiceId,
      number: finalised.body.invoiceNumber,
      customer: customerName,
      title: 'Westbrook Civil labour hire — Jul 2026',
      lineCount: lines.length,
      totals: finalised.body.totals,
      templateId: template.id,
      templateName: template.name,
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
