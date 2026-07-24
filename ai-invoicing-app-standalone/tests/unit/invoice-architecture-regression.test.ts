import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.join(process.cwd());
const publicDir = path.join(root, 'public');
const invoicePublicFiles = [
  'invoice-editor.js',
  'invoice-line-keyboard.js',
  'invoice-model.js',
  'invoice-api.js',
  'invoice-number.js',
  'invoice-totals.js',
];

function read(file: string) {
  return fs.readFileSync(path.join(publicDir, file), 'utf8');
}

describe('invoice architecture regression', () => {
  it('forbids FormData construction inside invoice modules', () => {
    for (const file of invoicePublicFiles) {
      const source = read(file);
      expect(source, file).not.toMatch(/new FormData\s*\(/);
    }
    const app = read('app.js');
    // app.js may use FormData for non-invoice forms; invoice editor form must never.
    expect(app).toMatch(/Invoice editor owns its own payload builder — never FormData/);
    expect(app).toMatch(/form\.id === 'invoice-editor-form' \? \{\}/);
  });

  it('keeps a single canonical payload builder export', () => {
    const model = read('invoice-model.js');
    const matches = model.match(/export function buildInvoicePayload/g) || [];
    expect(matches).toHaveLength(1);
    const editor = read('invoice-editor.js');
    expect(editor).toContain("from './invoice-model.js'");
    expect(editor).toContain('buildInvoicePayload(state)');
    expect(editor).not.toMatch(/function buildPayloadFromForm/);
    expect(editor).not.toMatch(/export function buildPayloadFromForm/);
  });

  it('does not ship deleted legacy invoice scripts', () => {
    for (const legacy of [
      'invoice-workspace.js',
      'invoice-curtain.js',
      'invoice-draft-persistence.js',
    ]) {
      expect(fs.existsSync(path.join(publicDir, legacy))).toBe(false);
    }
    const app = read('app.js');
    expect(app).not.toMatch(/invoice-workspace\.js/);
    expect(app).not.toMatch(/invoice-curtain\.js/);
    expect(app).not.toMatch(/invoice-draft-persistence\.js/);
    const frontend = fs.readFileSync(path.join(root, 'src/routes/frontend.ts'), 'utf8');
    // Legacy filenames may appear only as DELETED_LEGACY_ASSETS → 410 Gone handlers.
    expect(frontend).toContain('DELETED_LEGACY_ASSETS');
    expect(frontend).toContain("code(410)");
    expect(frontend).toContain('LEGACY_INVOICE_ASSET_REMOVED');
    expect(frontend).toContain('invoice-model.js');
    expect(frontend).toContain('invoice-api.js');
    expect(frontend).toContain('invoice-line-keyboard.js');
    expect(frontend).toContain('invoice-editor.js');
    expect(frontend).toContain('build-identity.js');
    // Must not serve deleted files as live tracedAssets.
    expect(frontend).not.toMatch(/'invoice-workspace\.js': new URL/);
    expect(frontend).not.toMatch(/'invoice-curtain\.js': new URL/);
    expect(frontend).not.toMatch(/'invoice-draft-persistence\.js': new URL/);
    const tracedBlock = frontend.slice(
      frontend.indexOf('const tracedAssets'),
      frontend.indexOf('const DELETED_LEGACY_ASSETS'),
    );
    expect(tracedBlock).not.toContain('invoice-workspace');
    expect(tracedBlock).not.toContain('invoice-curtain');
    expect(tracedBlock).not.toContain('invoice-draft-persistence');
  });

  it('exposes a non-secret runtime build marker for invoice pathway verification', () => {
    const identity = fs.readFileSync(path.join(root, 'src/build-identity.ts'), 'utf8');
    expect(identity).toContain("INVOICE_UI_VERSION = 'canonical-v3'");
    expect(identity).toContain('createBuildIdentity');
    expect(identity).toContain('canonical-state-payload-api');
    const health = fs.readFileSync(path.join(root, 'src/routes/health.ts'), 'utf8');
    expect(health).toContain('/health/build');
    expect(health).toContain('createBuildIdentity');
  });

  it('keeps a single invoice editor entry point', () => {
    const editors = fs
      .readdirSync(publicDir)
      .filter((name) => name.endsWith('.js') && /invoice-.*editor|invoice-workspace|invoice-curtain/.test(name));
    expect(editors).toEqual(['invoice-editor.js']);
    const app = read('app.js');
    const editorImports = app.match(/from ['"]\.\/invoice-[^'"]+['"]/g) || [];
    expect(editorImports.filter((line) => /invoice-editor/.test(line))).toHaveLength(1);
    expect(editorImports.some((line) => /invoice-workspace|invoice-curtain/.test(line))).toBe(false);
  });

  it('does not branch invoice implementations by deployment host', () => {
    for (const file of [...invoicePublicFiles, 'app.js']) {
      const source = read(file);
      expect(source, file).not.toMatch(/vercel\.app/);
      expect(source, file).not.toMatch(/window\.location\.hostname/);
      expect(source, file).not.toMatch(/INVOICE_.*PATH/);
      expect(source, file).not.toMatch(/USE_LEGACY_INVOICE/);
    }
  });

  it('forbids button handlers serializing invoice fields from the DOM for network payloads', () => {
    const editor = read('invoice-editor.js');
    // Persist / preview must go through state → buildInvoicePayload / api client.
    expect(editor).toContain('apiClient.saveDraft(state)');
    expect(editor).toContain('apiClient.ensurePersistedForPdf(state');
    expect(editor).toContain('commitPendingInput()');
    expect(editor).not.toMatch(/Object\.fromEntries\(\s*new FormData/);
    expect(editor).not.toMatch(/new URLSearchParams\(\s*new FormData/);
    // Totals must not scrape forms for payloads.
    expect(read('invoice-totals.js')).not.toContain('readLineItemsFromForm');
  });

  it('exposes one invoice API client for create/read/update/preview/finalise/delete', () => {
    const api = read('invoice-api.js');
    expect(api).toContain('export function createInvoiceApiClient');
    for (const name of [
      'createDraft',
      'updateDraft',
      'saveDraft',
      'readInvoice',
      'deleteDraft',
      'finaliseInvoice',
      'previewPdf',
      'downloadPdf',
    ]) {
      expect(api).toContain(name);
    }
    expect(api).toContain('toCreateDraftBody');
    expect(api).toContain('toUpdateDraftBody');
    expect(api).toContain('buildInvoicePayload');
  });
});
