import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { buildApp } from '../../src/app.js';
import { receiptOcrSchema } from '../../src/domain/attachments/types.js';

const attachmentSchema = z.object({
  id: z.string().uuid(),
  parentEntityType: z.string(),
  parentEntityId: z.string(),
  filename: z.string(),
  category: z.string(),
  deletedAt: z.string().nullable(),
  version: z.number(),
  jobPhotoStage: z.string().nullable().optional(),
  receiptOcr: receiptOcrSchema.nullable().optional(),
});

const listSchema = z.object({
  count: z.number(),
  attachments: z.array(attachmentSchema),
});

describe('attachments and expenses API', () => {
  it('uploads receipts, lists library, soft-deletes and restores', async () => {
    const app = await buildApp({
      dbPath: ':memory:',
      authBypassForTesting: true,
      serveFrontend: false,
      requestBodyLimit: 5_242_880,
    });

    const expense = await app.inject({
      method: 'POST',
      url: '/api/expenses',
      payload: {
        title: 'Site consumables',
        merchant: 'Bunnings',
        expenseDate: '2026-03-12',
        total: 110,
        gst: 10,
      },
    });
    expect(expense.statusCode).toBe(201);
    const expenseId = z.object({ id: z.string().uuid() }).parse(expense.json()).id;

    const contentBase64 = Buffer.from(
      'Merchant: Bunnings Warehouse\nDate: 12/03/2026\nTotal: $110.00\nGST: $10.00\nInvoice No: INV-9001\n',
    ).toString('base64');

    const upload = await app.inject({
      method: 'POST',
      url: '/api/attachments',
      payload: {
        parentEntityType: 'expense',
        parentEntityId: expenseId,
        filename: 'receipt.txt',
        mimeType: 'text/plain',
        contentBase64,
        category: 'receipt',
        tags: ['site', 'consumables'],
        runReceiptOcr: true,
        caption: 'Hardware receipt',
      },
    });
    expect(upload.statusCode).toBe(201);
    const attachment = attachmentSchema.parse(upload.json());
    expect(attachment.category).toBe('receipt');
    expect(attachment.receiptOcr?.total).toBe(110);

    const library = await app.inject({
      method: 'GET',
      url: `/api/attachments?parentEntityType=expense&parentEntityId=${expenseId}`,
    });
    expect(library.statusCode).toBe(200);
    expect(listSchema.parse(library.json()).count).toBe(1);

    const content = await app.inject({
      method: 'GET',
      url: `/api/attachments/${attachment.id}/content`,
    });
    expect(content.statusCode).toBe(200);
    expect(content.body).toContain('Bunnings');

    const softDelete = await app.inject({
      method: 'DELETE',
      url: `/api/attachments/${attachment.id}`,
    });
    expect(softDelete.statusCode).toBe(204);

    const recycle = await app.inject({
      method: 'GET',
      url: '/api/attachments?deletedOnly=1',
    });
    expect(listSchema.parse(recycle.json()).count).toBe(1);

    const restore = await app.inject({
      method: 'POST',
      url: `/api/attachments/${attachment.id}/restore`,
      payload: {},
    });
    expect(restore.statusCode).toBe(200);
    expect(attachmentSchema.parse(restore.json()).deletedAt).toBeNull();

    const customer = await app.inject({
      method: 'POST',
      url: '/api/customers',
      payload: { displayName: 'Photo Customer' },
    });
    const customerId = z.object({ id: z.string().uuid() }).parse(customer.json()).id;

    const job = await app.inject({
      method: 'POST',
      url: '/api/jobs',
      payload: {
        title: 'Scaffold install',
        customerId,
        status: 'In Progress',
        priority: 'Normal',
      },
    });
    expect(job.statusCode).toBe(201);
    const jobId = z.object({ id: z.string().uuid() }).parse(job.json()).id;

    const photo = await app.inject({
      method: 'POST',
      url: '/api/attachments',
      payload: {
        parentEntityType: 'job',
        parentEntityId: jobId,
        filename: 'before.jpg',
        mimeType: 'image/jpeg',
        contentBase64: Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64'),
        category: 'job_photo',
        jobPhotoStage: 'before',
        caption: 'Site before works',
        gpsLatitude: -33.86,
        gpsLongitude: 151.2,
        capturedAt: new Date().toISOString(),
      },
    });
    expect(photo.statusCode).toBe(201);
    expect(attachmentSchema.parse(photo.json()).jobPhotoStage).toBe('before');

    const jobPhotos = await app.inject({
      method: 'GET',
      url: `/api/entities/job/${jobId}/attachments?category=job_photo`,
    });
    expect(jobPhotos.statusCode).toBe(200);
    expect(listSchema.parse(jobPhotos.json()).count).toBe(1);

    const storage = await app.inject({ method: 'GET', url: '/api/attachments/storage' });
    expect(storage.statusCode).toBe(200);
    expect(
      z.object({ activeCount: z.number() }).parse(storage.json()).activeCount,
    ).toBeGreaterThanOrEqual(2);

    await app.close();
  });
});
