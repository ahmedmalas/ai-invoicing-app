import puppeteer from 'puppeteer-core';
import { writeFileSync, mkdirSync } from 'node:fs';

const OUT = '/opt/cursor/artifacts/invoice-live-proof';
mkdirSync(OUT, { recursive: true });
const CHROME = '/usr/local/bin/google-chrome';
const PROD = 'https://ai-invoicing-app.vercel.app';

const appJs = await fetch(`${PROD}/assets/app.js`).then((r) => r.text());
const workspaceJs = await fetch(`${PROD}/assets/invoice-workspace.js`).then(async (r) => ({
  status: r.status,
  bytes: (await r.text()).length,
}));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox'],
});
const page = await browser.newPage();
await page.goto(`${PROD}/workspace/invoices/new`, { waitUntil: 'networkidle2' });

const scripts = await page.evaluate(() =>
  [...document.querySelectorAll('script')].map((s) => s.src).filter(Boolean),
);
const assetHits = await page.evaluate(async () => {
  const paths = [
    '/assets/invoice-workspace.js',
    '/assets/invoice-curtain.js',
    '/assets/invoice-draft-persistence.js',
    '/assets/invoice-editor.js',
    '/assets/invoice-model.js',
    '/assets/invoice-api.js',
  ];
  const out = {};
  for (const p of paths) {
    const r = await fetch(p);
    out[p] = { status: r.status };
  }
  return out;
});

const formDataRepro = await page.evaluate(() => {
  document.body.innerHTML =
    '<form id="invoice-workspace-form">' +
    '<input name="title" value="Live Failure Title Proof" />' +
    '<input name="customerId" value="cust-1" />' +
    '<textarea name="notes">n</textarea>' +
    '<button type="button" id="preview">Preview PDF</button>' +
    '<div id="toast"></div></form>';

  function collectInvoiceWorkspacePayload(form) {
    return Object.fromEntries(new FormData(form));
  }

  const form = document.querySelector('#invoice-workspace-form');
  const before = {
    titleValue: form.title.value,
    formDataTitle: Object.fromEntries(new FormData(form)).title || null,
  };
  for (const el of form.querySelectorAll('input, textarea, select, button')) el.disabled = true;
  const afterDisable = {
    titleDisabled: form.title.disabled,
    formDataTitle: Object.fromEntries(new FormData(form)).title || null,
    formDataKeys: [...new FormData(form).keys()],
  };
  const payload = collectInvoiceWorkspacePayload(form);
  const error = !payload.title ? 'Invoice title is required.' : null;
  document.querySelector('#toast').textContent = error || 'ok';
  return {
    before,
    afterDisable,
    payload,
    error,
    initiator:
      'public/app.js collectInvoiceWorkspacePayload → Object.fromEntries(new FormData(form))',
  };
});

await page.screenshot({ path: `${OUT}/prod-formdata-title-failure.png`, fullPage: true });

const lines = appJs.split('\n');
const report = {
  at: new Date().toISOString(),
  url: `${PROD}/workspace/invoices/new`,
  deploymentId: 'dpl_HKhPD7Mi6yCQRUEGSjPzo6fNPFCn',
  commitSha: '5a54b038d4db5aad160dbdf9f756392a644edf29',
  scriptsLoadedOnShell: scripts,
  assetHits,
  appJsProof: {
    importsWorkspace: /from '\.\/invoice-workspace\.js'/.test(appJs),
    collectFunctionLine: lines.findIndex((l) => l.includes('async function collectInvoiceWorkspacePayload')) + 1,
    formDataLine: lines.findIndex((l) => l.includes('Object.fromEntries(new FormData(form))')) + 1,
  },
  workspaceJs,
  formDataRepro,
};
writeFileSync(`${OUT}/production-formdata-repro.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await browser.close();
