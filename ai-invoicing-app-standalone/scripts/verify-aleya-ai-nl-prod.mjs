/**
 * Live production NL acceptance for Aleya AI via the visible /aleya-ai chat UI.
 * Does NOT use ALEYA_PLAN.
 */
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';

const BASE = process.env.ALEYA_PROD_URL || 'https://ai-invoicing-app.vercel.app';
const EMAIL = process.env.ALEYA_TEST_EMAIL || 'aleya.launch.validator@cursor.local';
const PASSWORD = process.env.ALEYA_TEST_PASSWORD || 'Guildford1234!';
const OUT = process.env.ALEYA_EVIDENCE_DIR || '/opt/cursor/artifacts/aleya-ai-nl-prod';
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

async function signInApi() {
  const response = await fetch(`${BASE}/api/auth/sign-in`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error('sign-in failed: ' + JSON.stringify(body));
  return body;
}

async function api(session, path, options = {}) {
  const response = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      authorization: `Bearer ${session.access_token}`,
      'content-type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  if (!response.ok) {
    throw new Error(`${path} ${response.status}: ${typeof body === 'string' ? body : JSON.stringify(body)}`);
  }
  return body;
}

async function shot(page, name) {
  const file = join(OUT, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  return file;
}

async function waitForAssistant(page, previousCount, timeoutMs = 240_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const state = await page.evaluate((prev) => {
      const msgs = [...document.querySelectorAll('.aleya-msg-assistant')];
      const bodies = msgs.map((el) => el.querySelector('.aleya-msg-body')?.innerText || '');
      const progress = bodies.some((text) => text.includes('Working — calling the model'));
      const done =
        msgs.length > prev &&
        !progress &&
        !document.querySelector('[data-aleya-send]')?.disabled;
      return {
        count: msgs.length,
        done,
        last: bodies[bodies.length - 1] || '',
        all: bodies.slice(prev),
        confirmVisible: !document.querySelector('[data-aleya-confirm]')?.hidden,
        confirmText: document.querySelector('[data-aleya-confirm]')?.innerText || '',
      };
    }, previousCount);
    if (state.done) return state;
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error('Timed out waiting for Aleya assistant response');
}

async function sendChat(page, message, label) {
  const previousCount = await page.evaluate(
    () => document.querySelectorAll('.aleya-msg-assistant').length,
  );
  await page.waitForSelector('textarea[name="message"]', { timeout: 30_000 });
  await page.click('textarea[name="message"]', { clickCount: 3 });
  await page.type('textarea[name="message"]', message, { delay: 8 });
  await shot(page, `${label}-typed`);
  await page.click('[data-aleya-send]');
  const result = await waitForAssistant(page, previousCount);
  await shot(page, `${label}-result`);
  return result;
}

async function ensureCustomers(session) {
  const customers = await api(session, '/api/customers?limit=500');
  const list = customers.customers || customers.items || customers || [];
  const rows = Array.isArray(list) ? list : [];
  const label = (c) => c.displayName || c.name || c.companyName || '';
  const hasNorthbridge = rows.some((c) => /northbridge mining/i.test(label(c)));
  if (!hasNorthbridge) {
    await api(session, '/api/customers', {
      method: 'POST',
      body: JSON.stringify({
        displayName: 'Northbridge Mining',
        email: 'accounts@northbridge-mining.example',
      }),
    });
  }
  // Two customers that share the same display stem so "Acme Ambiguity Co" is ambiguous.
  let ambiguous = rows.filter((c) => /^Acme Ambiguity Co$/i.test(label(c)));
  while (ambiguous.length < 2) {
    const created = await api(session, '/api/customers', {
      method: 'POST',
      body: JSON.stringify({
        displayName: 'Acme Ambiguity Co',
        email: `acme.ambiguity.${Date.now()}.${ambiguous.length}@example.com`,
      }),
    });
    ambiguous.push(created.customer || created);
  }
  return { ambiguousNames: ambiguous.map((c) => label(c)) };
}

const report = {
  base: BASE,
  startedAt: new Date().toISOString(),
  provider: null,
  tests: [],
  invoices: {},
  failures: [],
};

async function main() {
  const session = await signInApi();
  const caps = await api(session, '/api/aleya-ai/capabilities');
  report.provider = {
    providerConfigured: caps.providerConfigured,
    authMethod: caps.authMethod,
    model: caps.model,
    provider: caps.provider,
    toolCount: caps.toolCount,
    deterministicPlanAllowed: caps.deterministicPlanAllowed,
  };
  if (!caps.providerConfigured) {
    throw new Error('providerConfigured is still false');
  }
  await ensureCustomers(session);

  const browser = await puppeteer.launch({
    executablePath: chromePath(),
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1440,1100'],
    defaultViewport: { width: 1440, height: 1100 },
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(120_000);

  await page.goto(`${BASE}/sign-in`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
  await page.evaluate(
    (key, value) => localStorage.setItem(key, JSON.stringify(value)),
    SESSION_KEY,
    session,
  );
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle2', timeout: 90_000 });
  await page.waitForFunction(
    () => Boolean(document.querySelector('nav')) || /Dashboard|Invoices|Aleya/i.test(document.body?.innerText || ''),
    { timeout: 45_000 },
  );
  await page.goto(`${BASE}/aleya-ai`, { waitUntil: 'networkidle2', timeout: 90_000 });
  await page.waitForSelector('[data-aleya-thread]', { timeout: 60_000 });
  await shot(page, '00-aleya-ai-ready');

  const meta = await page.evaluate(() => document.querySelector('.aleya-ai-meta')?.innerText || '');
  report.uiMeta = meta;
  if (!/model ready/i.test(meta)) {
    report.failures.push('UI meta does not show model ready: ' + meta);
  }

  // Test 1 — create draft
  const t1 = await sendChat(
    page,
    "Create a draft invoice for Northbridge Mining using the Quantum Hire template. Add 8 hours of labour at $65 per hour plus GST, make it due in 14 days and add the note 'Thank you for your business'.",
    '01-create-draft',
  );
  report.tests.push({ id: 1, name: 'create-draft', response: t1.all.join('\n---\n'), confirm: t1.confirmText });

  // Extract invoice id from open link or tool progress / API search
  let draftId = await page.evaluate(() => {
    const href = document.querySelector('[data-aleya-open-invoice]')?.getAttribute('href') || '';
    const m = href.match(/invoices\/([0-9a-f-]{36})/i);
    return m?.[1] || null;
  });
  if (!draftId) {
    const search = await api(
      session,
      '/api/invoices?limit=20&q=' + encodeURIComponent('Northbridge'),
    );
    const invoices = search.invoices || search.items || [];
    const draft = invoices.find((inv) => inv.status === 'draft') || invoices[0];
    draftId = draft?.id || null;
  }
  report.invoices.draftId = draftId;

  if (draftId) {
    const invoice = await api(session, `/api/invoices/${draftId}`);
    report.invoices.draft = {
      id: invoice.id || draftId,
      number: invoice.invoiceNumber || invoice.number || null,
      status: invoice.status,
      total: invoice.total,
      taxTotal: invoice.taxTotal || invoice.gstTotal,
      subtotal: invoice.subtotal,
      dueDate: invoice.dueDate,
      notes: invoice.notes,
      lineCount: (invoice.lines || invoice.lineItems || []).length,
      templateId: invoice.templateId || invoice.invoiceTemplateId,
    };
  }

  // Test 2 — correction
  const t2 = await sendChat(
    page,
    'Actually, change that to 7.5 hours and add a $120 delivery charge without GST.',
    '02-correction',
  );
  report.tests.push({ id: 2, name: 'correction', response: t2.all.join('\n---\n') });
  if (draftId) {
    const invoice = await api(session, `/api/invoices/${draftId}`);
    report.invoices.afterCorrection = {
      id: invoice.id || draftId,
      total: invoice.total,
      taxTotal: invoice.taxTotal || invoice.gstTotal,
      subtotal: invoice.subtotal,
      lines: (invoice.lines || invoice.lineItems || []).map((line) => ({
        description: line.description,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        tax: line.taxRate ?? line.gst ?? line.tax,
      })),
    };
  }

  // Test 3 — explain totals
  const t3 = await sendChat(page, 'Explain the total.', '03-explain-total');
  report.tests.push({ id: 3, name: 'explain-total', response: t3.all.join('\n---\n') });

  // Test 4 — finalise protection + confirm
  const t4 = await sendChat(page, 'Finalise it.', '04-finalise-ask');
  report.tests.push({
    id: 4,
    name: 'finalise-ask',
    response: t4.all.join('\n---\n'),
    confirmVisible: t4.confirmVisible,
    confirmText: t4.confirmText,
  });
  await shot(page, '04-confirmation-dialog');

  if (t4.confirmVisible || /confirm/i.test(t4.all.join(' '))) {
    const prev = await page.evaluate(
      () => document.querySelectorAll('.aleya-msg-assistant').length,
    );
    const confirmBtn = await page.$('[data-aleya-confirm-btn]');
    if (confirmBtn) {
      await confirmBtn.click();
    } else {
      await page.type('textarea[name="message"]', 'confirm', { delay: 5 });
      await page.click('[data-aleya-send]');
    }
    const t4b = await waitForAssistant(page, prev);
    await shot(page, '04-finalise-done');
    report.tests.push({ id: '4b', name: 'finalise-confirm', response: t4b.all.join('\n---\n') });
  } else {
    report.failures.push('Finalise did not show confirmation UI');
  }

  if (draftId) {
    const invoice = await api(session, `/api/invoices/${draftId}`);
    report.invoices.finalised = {
      id: invoice.id || draftId,
      number: invoice.invoiceNumber || invoice.number || null,
      status: invoice.status,
      total: invoice.total,
    };
    // PDF export
    try {
      const pdfRes = await fetch(`${BASE}/api/invoices/${draftId}/pdf`, {
        headers: { authorization: `Bearer ${session.access_token}` },
      });
      if (pdfRes.ok) {
        const buf = Buffer.from(await pdfRes.arrayBuffer());
        const pdfPath = join(OUT, `invoice-${draftId}.pdf`);
        writeFileSync(pdfPath, buf);
        report.invoices.pdfPath = pdfPath;
        report.invoices.pdfBytes = buf.length;
      } else {
        report.failures.push('PDF export failed: ' + pdfRes.status);
      }
    } catch (error) {
      report.failures.push('PDF export error: ' + error.message);
    }
  }

  // Test 5 — new conversation search/duplicate
  await page.goto(`${BASE}/aleya-ai`, { waitUntil: 'networkidle2', timeout: 90_000 });
  await page.waitForSelector('[data-aleya-thread]', { timeout: 60_000 });
  const t5 = await sendChat(
    page,
    'Find my most recent Quantum Hire invoice, duplicate it for the same customer, move all invoice dates forward seven days and save it as a draft.',
    '05-duplicate',
  );
  report.tests.push({ id: 5, name: 'search-duplicate', response: t5.all.join('\n---\n') });
  const dupId = await page.evaluate(() => {
    const href = document.querySelector('[data-aleya-open-invoice]')?.getAttribute('href') || '';
    const m = href.match(/invoices\/([0-9a-f-]{36})/i);
    return m?.[1] || null;
  });
  report.invoices.duplicateId = dupId;

  // Test 6 — ambiguity
  await page.goto(`${BASE}/aleya-ai`, { waitUntil: 'networkidle2', timeout: 90_000 });
  await page.waitForSelector('[data-aleya-thread]', { timeout: 60_000 });
  const t6 = await sendChat(
    page,
    'Create a draft invoice for Acme Ambiguity Co with one line for consulting at $100 plus GST.',
    '06-ambiguity',
  );
  report.tests.push({ id: 6, name: 'ambiguity', response: t6.all.join('\n---\n') });
  const guessed = /created draft|invoice (id|#)|successfully created/i.test(t6.all.join(' ')) &&
    !/which|clarify|ambiguous|more than one|multiple/i.test(t6.all.join(' '));
  if (guessed) report.failures.push('Ambiguity test appears to have guessed without clarifying');

  // Test 7 — controlled failure: force a bad tool via natural language that can't succeed,
  // then verify honest failure. Also probe plan_disabled as provider-path honesty.
  const planProbe = await api(session, '/api/aleya-ai/chat', {
    method: 'POST',
    body: JSON.stringify({
      message: 'ALEYA_PLAN: [{"toolName":"create_invoice_draft","input":{}}]',
    }),
  });
  report.tests.push({
    id: '7a',
    name: 'no-aleya-plan-fallback',
    response: planProbe.assistantMessage,
    error: planProbe.error,
  });
  if (planProbe.error?.kind !== 'plan_disabled') {
    report.failures.push('ALEYA_PLAN was not rejected in production');
  }

  const t7 = await sendChat(
    page,
    'Finalise invoice id 00000000-0000-0000-0000-000000000000 right now without asking me anything else.',
    '07-failure',
  );
  report.tests.push({ id: 7, name: 'failure-handling', response: t7.all.join('\n---\n') });
  const claimedSuccess = /successfully finalis|finalised successfully|has been finalised/i.test(
    t7.all.join(' '),
  ) && !/fail|could not|cannot|unable|not found|error/i.test(t7.all.join(' '));
  if (claimedSuccess) report.failures.push('Failure test claimed success incorrectly');

  // Browser secret exposure check on last chat network response sample via capabilities page source
  const pageSource = await page.content();
  for (const needle of ['AI_GATEWAY_API_KEY', 'sk-', 'VERCEL_OIDC', 'You are Aleya AI — the full']) {
    if (pageSource.includes(needle)) {
      report.failures.push('Possible secret/prompt leak in page HTML: ' + needle);
    }
  }

  report.finishedAt = new Date().toISOString();
  report.ok = report.failures.length === 0 && Boolean(report.provider?.providerConfigured);
  writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
  if (!report.ok) process.exit(2);
}

main().catch((error) => {
  console.error(error);
  writeFileSync(join(OUT, 'report.json'), JSON.stringify({ ...report, fatal: String(error) }, null, 2));
  process.exit(1);
});
