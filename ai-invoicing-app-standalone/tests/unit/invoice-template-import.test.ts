import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';

import { analyzeInvoiceDocument } from '../../src/domain/templates/analyze-invoice-document.js';
import { defaultInvoiceTemplateDesign } from '../../src/domain/templates/invoice-template-design.js';
import { generateTemplatePreviewPdfBuffer } from '../../src/domain/templates/template-pdf.js';

async function buildDocx(text: string): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
  );
  zip.folder('word')?.file(
    'document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body>
</w:document>`,
  );
  return zip.generateAsync({ type: 'nodebuffer' });
}

describe('invoice template import analysis', () => {
  it('extracts reusable business design from a Word invoice and strips transactional fields', async () => {
    const bytes = await buildDocx(
      'Harbour Hire Co TAX INVOICE Invoice Number: INV-1001 Issue Date: 01/01/2026 Bill To: Acme Pty Ltd ABN: 12 345 678 901 Email: accounts@harbourhire.test Phone: 02 9000 1111 Payment details BSB 062-000 Account 123456 Notes thank you $250.00 Paid',
    );
    const result = await analyzeInvoiceDocument({
      filename: 'harbour-invoice.docx',
      mimeType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      bytes,
    });

    expect(result.design.businessDefaults.companyName).toBeTruthy();
    expect(String(result.design.businessDefaults.abnTaxId || '')).toMatch(/12/);
    expect(String(result.design.businessDefaults.email || '')).toContain('@');
    expect(result.strippedTransactionalFields.length).toBeGreaterThan(0);
    expect(result.detectedElements).toEqual(
      expect.arrayContaining(['invoice title', 'payment details', 'ABN']),
    );
    expect(JSON.stringify(result.design)).not.toMatch(/INV-1001/);
    expect(JSON.stringify(result.design)).not.toMatch(/Acme Pty Ltd/);
  });

  it('accepts PNG uploads as logo-bearing design imports', async () => {
    // Minimal 1x1 PNG
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
    const result = await analyzeInvoiceDocument({
      filename: 'brand-invoice.png',
      mimeType: 'image/png',
      bytes: png,
    });
    expect(result.design.businessDefaults.logoDataUrl).toMatch(/^data:image\/png;base64,/);
    expect(result.detectedElements).toContain('logo');
  });

  it('renders a preview PDF from an imported design', async () => {
    const design = defaultInvoiceTemplateDesign({
      documentTitle: 'TAX INVOICE',
      businessDefaults: {
        companyName: 'Harbour Hire Co',
        legalName: 'Harbour Hire Co',
        abnTaxId: '12 345 678 901',
        address: '1 Quay St, Sydney NSW 2000',
        email: 'accounts@harbourhire.test',
        phone: '02 9000 1111',
        website: 'https://harbourhire.test',
        logoDataUrl: null,
      },
      paymentDetails: 'BSB 062-000 Account 123456',
    });
    const pdf = await generateTemplatePreviewPdfBuffer({ design });
    expect(pdf.subarray(0, 4).toString('utf8')).toBe('%PDF');
    expect(pdf.length).toBeGreaterThan(500);
  });
});
