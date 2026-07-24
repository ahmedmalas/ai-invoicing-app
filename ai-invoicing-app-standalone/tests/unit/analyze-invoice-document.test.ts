import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  analyzeInvoiceDocument,
  extractTextFromPdf,
} from '../../src/domain/templates/analyze-invoice-document.js';

const samplePdfPath = join(
  process.env.HOME || '/home/ubuntu',
  '.cursor/projects/workspace/uploads/Cart_N_Tip__107_e19b.pdf',
);

describe('analyzeInvoiceDocument', () => {
  it('recreates Cart N Tip style layout as editable design fields', async () => {
    let bytes: Buffer;
    try {
      bytes = readFileSync(samplePdfPath);
    } catch {
      // Sample upload may be absent in CI clones — skip rather than fail the suite.
      return;
    }

    const text = await extractTextFromPdf(bytes);
    expect(text).toMatch(/TAX INVOICE/i);
    expect(text).toMatch(/Quantum Hire/i);

    const result = await analyzeInvoiceDocument({
      filename: 'Cart_N_Tip_107.pdf',
      mimeType: 'application/pdf',
      bytes,
    });

    expect(result.confidence).toBeGreaterThan(0.7);
    expect(result.design.documentTitle).toBe('TAX INVOICE');
    expect(result.design.layout.headerStyle).toBe('split-bill-from');
    expect(result.design.layout.tableColumns.find((c) => c.id === 'date')?.visible).toBe(true);
    expect(result.design.layout.tableColumns.find((c) => c.id === 'unitPrice')?.label).toBe('Rate');
    expect(result.design.layout.tableColumns.find((c) => c.id === 'gst')?.visible).toBe(false);
    expect(result.design.businessDefaults.companyName).toMatch(/Quantum Hire/i);
    expect(result.design.businessDefaults.email).toBe('info@quantumhireservices.com.au');
    expect(result.design.bankDetails?.bsb).toBe('012347');
    expect(result.design.bankDetails?.accountNumber).toBe('814027296');
    expect(result.sampleLines.length).toBeGreaterThan(0);
    expect(result.design.analysisNotes.join(' ')).toMatch(/editable/i);
  });

  it('accepts image imports with manual-edit limitations', async () => {
    // Minimal 1x1 PNG
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
    const result = await analyzeInvoiceDocument({
      filename: 'scan.png',
      mimeType: 'image/png',
      bytes: png,
    });
    expect(result.design.version).toBe(1);
    expect(result.limitations.some((item) => /OCR/i.test(item))).toBe(true);
    expect(result.detectedElements).toContain('uploaded image');
  });
});
