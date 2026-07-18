import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { z } from 'zod';

import { buildApp } from '../../src/app.js';
import {
  defaultInvoiceTemplateDesign,
  invoiceTemplateDesignSchema,
} from '../../src/domain/templates/invoice-template-design.js';

async function buildDocx(text: string): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
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

const analyzeResponseSchema = z.object({
  analysis: z.object({
    design: invoiceTemplateDesignSchema,
    detectedElements: z.array(z.string()),
    strippedTransactionalFields: z.array(z.string()),
    confidence: z.number(),
    extractedTextPreview: z.string(),
  }),
  original: z.object({
    filename: z.string(),
    mimeType: z.string(),
    contentBase64: z.string(),
    sizeBytes: z.number(),
  }),
});

const templateSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  isDefault: z.boolean(),
  design: invoiceTemplateDesignSchema,
  originalFilename: z.string().nullable(),
  source: z.enum(['imported', 'manual', 'duplicated']),
});

describe('invoice template import API', () => {
  it('analyses, approves, lists, duplicates and deletes templates', async () => {
    const app = await buildApp({
      dbPath: ':memory:',
      authBypassForTesting: true,
      serveFrontend: false,
      requestBodyLimit: 5_242_880,
    });

    const bytes = await buildDocx(
      'Cedar Scaffold TAX INVOICE ABN: 98 765 432 109 Email: hello@cedar.test Address: 9 Pine Rd Melbourne VIC 3000 Payment details BSB 033-000 Invoice Number: INV-9 Bill To: Someone Else $99.00',
    );

    const analyze = await app.inject({
      method: 'POST',
      url: '/api/invoice-templates/analyze',
      payload: {
        filename: 'cedar.docx',
        mimeType:
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        contentBase64: bytes.toString('base64'),
      },
    });
    expect(analyze.statusCode).toBe(200);
    const analyzed = analyzeResponseSchema.parse(analyze.json());
    expect(analyzed.analysis.design.businessDefaults.abnTaxId).toBeTruthy();
    expect(analyzed.original.contentBase64).toBeTruthy();

    const approve = await app.inject({
      method: 'POST',
      url: '/api/invoice-templates/approve',
      payload: {
        name: 'Cedar default',
        design: analyzed.analysis.design,
        isDefault: true,
        applyBusinessDefaults: true,
        originalFilename: analyzed.original.filename,
        originalMimeType: analyzed.original.mimeType,
        originalFileBase64: analyzed.original.contentBase64,
        source: 'imported',
      },
    });
    expect(approve.statusCode).toBe(201);
    const template = templateSchema.parse(approve.json());
    expect(template.isDefault).toBe(true);
    expect(template.originalFilename).toBe('cedar.docx');

    const profile = await app.inject({ method: 'GET', url: '/api/business-profile' });
    expect(profile.statusCode).toBe(200);
    expect(z.object({ companyName: z.string() }).parse(profile.json()).companyName).toBeTruthy();

    const list = await app.inject({ method: 'GET', url: '/api/invoice-templates' });
    expect(list.statusCode).toBe(200);
    expect(z.object({ count: z.number() }).parse(list.json()).count).toBe(1);

    const preview = await app.inject({
      method: 'POST',
      url: '/api/invoice-templates/preview-pdf',
      payload: { design: defaultInvoiceTemplateDesign(template.design) },
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.headers['content-type']).toContain('application/pdf');

    const duplicate = await app.inject({
      method: 'POST',
      url: `/api/invoice-templates/${template.id}/duplicate`,
      payload: { name: 'Cedar copy' },
    });
    expect(duplicate.statusCode).toBe(201);
    const duplicated = templateSchema.parse(duplicate.json());
    expect(duplicated.name).toBe('Cedar copy');
    expect(duplicated.isDefault).toBe(false);

    const rename = await app.inject({
      method: 'PATCH',
      url: `/api/invoice-templates/${duplicated.id}`,
      payload: { name: 'Cedar renamed' },
    });
    expect(rename.statusCode).toBe(200);
    expect(templateSchema.parse(rename.json()).name).toBe('Cedar renamed');

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/invoice-templates/${duplicated.id}`,
    });
    expect(del.statusCode).toBe(204);

    const original = await app.inject({
      method: 'GET',
      url: `/api/invoice-templates/${template.id}/original`,
    });
    expect(original.statusCode).toBe(200);
    expect(String(original.headers['content-type'])).toContain('officedocument');

    await app.close();
  });
});
