import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { buildApp } from '../../src/app.js';

const idSchema = z.object({ id: z.string().uuid() });
const backupSchema = z.object({
  snapshot: z.object({
    version: z.number().int(),
    products: z.unknown(),
    derived: z.unknown(),
    entities: z.record(z.string(), z.array(z.record(z.string(), z.unknown()))),
  }),
});
const reportSummarySchema = z.object({
  accountsReceivable: z.object({
    totals: z.object({
      outstanding: z.number(),
    }),
  }),
  accountsPayable: z.object({
    totals: z.object({
      supplierBillOutstanding: z.number(),
    }),
  }),
});

function createTempDbPath(prefix: string): { dir: string; dbPath: string } {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  return { dir, dbPath: join(dir, 'app.db') };
}

function authHeaders(userId: string): Record<string, string> {
  return { 'x-actor-user-id': userId };
}

function expectPdfResponse(response: { statusCode: number; headers: Record<string, unknown>; body: string }): void {
  expect(response.statusCode).toBe(200);
  const contentType = response.headers['content-type'];
  expect(typeof contentType === 'string' ? contentType : '').toContain('application/pdf');
  expect(response.body.length).toBeGreaterThan(0);
}

function expectHtmlResponse(response: { statusCode: number; headers: Record<string, unknown>; body: string }): void {
  expect(response.statusCode).toBe(200);
  const contentType = response.headers['content-type'];
  expect(typeof contentType === 'string' ? contentType : '').toContain('text/html');
  expect(response.body.length).toBeGreaterThan(0);
}

describe('slice 48 final end-to-end acceptance validation', () => {
  it('runs clean-db production-style acceptance workflow across all major modules', async () => {
    const moduleStatus: Record<string, 'pass' | 'fail'> = {
      foundationHealth: 'fail',
      authAndDiagnostics: 'fail',
      businessProfileAndPreferences: 'fail',
      customers: 'fail',
      suppliers: 'fail',
      usersRolesTeams: 'fail',
      jobs: 'fail',
      invoices: 'fail',
      creditNotes: 'fail',
      customerPayments: 'fail',
      customerStatements: 'fail',
      procurementAndSupplierBills: 'fail',
      supplierPayments: 'fail',
      reportingSearchTimeline: 'fail',
      backupRestore: 'fail',
      rejectionNoMutation: 'fail',
    };

    const { dir, dbPath } = createTempDbPath('ai-business-os-slice48-acceptance-');
    const bootstrap = await buildApp({ dbPath, authBypassForTesting: true });

    let adminUserId = '';
    let memberUserId = '';
    let customerId = '';
    let supplierId = '';
    let invoiceId = '';
    let creditNoteId = '';
    let customerPaymentId = '';
    let purchaseOrderId = '';
    let supplierBillId = '';
    let supplierPaymentId = '';
    let teamId = '';
    let jobId = '';
    let extraRoleId = '';
    let extraUserId = '';
    let extraCustomerId = '';
    let extraSupplierId = '';
    try {
      const adminRoleId = idSchema.parse(
        (
          await bootstrap.inject({
            method: 'POST',
            url: '/roles',
            payload: { name: 'Slice48 Admin', canBeAssigned: true, canManageAssignments: true },
          })
        ).json(),
      ).id;
      const memberRoleId = idSchema.parse(
        (
          await bootstrap.inject({
            method: 'POST',
            url: '/roles',
            payload: { name: 'Slice48 Member', canBeAssigned: true, canManageAssignments: false },
          })
        ).json(),
      ).id;

      adminUserId = idSchema.parse(
        (
          await bootstrap.inject({
            method: 'POST',
            url: '/users',
            payload: { displayName: 'Slice48 Admin User', roleIds: [adminRoleId] },
          })
        ).json(),
      ).id;
      memberUserId = idSchema.parse(
        (
          await bootstrap.inject({
            method: 'POST',
            url: '/users',
            payload: { displayName: 'Slice48 Team Member', roleIds: [memberRoleId] },
          })
        ).json(),
      ).id;
    } finally {
      await bootstrap.close();
    }

    const app = await buildApp({ dbPath, authBypassForTesting: false });
    try {
      const health = await app.inject({ method: 'GET', url: '/health' });
      const healthLive = await app.inject({ method: 'GET', url: '/health/live' });
      const healthReady = await app.inject({ method: 'GET', url: '/health/ready' });
      expect(health.statusCode).toBe(200);
      expect(healthLive.statusCode).toBe(200);
      expect(healthReady.statusCode).toBe(200);
      moduleStatus.foundationHealth = 'pass';

      const diagnosticsDenied = await app.inject({ method: 'GET', url: '/health/diagnostics' });
      const diagnosticsAllowed = await app.inject({
        method: 'GET',
        url: '/health/diagnostics',
        headers: authHeaders(adminUserId),
      });
      expect(diagnosticsDenied.statusCode).toBe(401);
      expect(diagnosticsAllowed.statusCode).toBe(200);
      moduleStatus.authAndDiagnostics = 'pass';

      const profileCreate = await app.inject({
        method: 'POST',
        url: '/business-profile',
        headers: authHeaders(adminUserId),
        payload: {
          companyName: 'Slice48 Pty Ltd',
          legalName: 'Slice48 Pty Ltd',
          primaryColor: '#112233',
          secondaryColor: '#ddeeff',
          email: 'ops@slice48.test',
        },
      });
      expect(profileCreate.statusCode).toBe(200);
      const logoPlaceholder = await app.inject({
        method: 'POST',
        url: '/business-profile/logo-placeholder',
        headers: authHeaders(adminUserId),
        payload: { fileName: 'logo.svg' },
      });
      expect(logoPlaceholder.statusCode).toBe(200);
      const profileGet = await app.inject({
        method: 'GET',
        url: '/business-profile',
        headers: authHeaders(adminUserId),
      });
      expect(profileGet.statusCode).toBe(200);

      const brandingPref = await app.inject({
        method: 'POST',
        url: '/preferences/branding',
        headers: authHeaders(adminUserId),
        payload: { value: { template: 'default' } },
      });
      const invoicePref = await app.inject({
        method: 'POST',
        url: '/preferences/invoice',
        headers: authHeaders(adminUserId),
        payload: { value: { paymentTerms: '14 days' } },
      });
      const brandingGet = await app.inject({
        method: 'GET',
        url: '/preferences/branding',
        headers: authHeaders(adminUserId),
      });
      const invoiceGet = await app.inject({
        method: 'GET',
        url: '/preferences/invoice',
        headers: authHeaders(adminUserId),
      });
      expect(brandingPref.statusCode).toBe(201);
      expect(invoicePref.statusCode).toBe(201);
      expect(brandingGet.statusCode).toBe(200);
      expect(invoiceGet.statusCode).toBe(200);
      moduleStatus.businessProfileAndPreferences = 'pass';

      customerId = idSchema.parse(
        (
          await app.inject({
            method: 'POST',
            url: '/customers',
            headers: authHeaders(adminUserId),
            payload: { displayName: 'Slice48 Customer Primary', email: 'customer@slice48.test' },
          })
        ).json(),
      ).id;
      const customerUpdate = await app.inject({
        method: 'PUT',
        url: `/customers/${customerId}`,
        headers: authHeaders(adminUserId),
        payload: { displayName: 'Slice48 Customer Primary Updated', email: 'updated.customer@slice48.test' },
      });
      const customerGet = await app.inject({
        method: 'GET',
        url: `/customers/${customerId}`,
        headers: authHeaders(adminUserId),
      });
      expect(customerUpdate.statusCode).toBe(200);
      expect(customerGet.statusCode).toBe(200);

      extraCustomerId = idSchema.parse(
        (
          await app.inject({
            method: 'POST',
            url: '/customers',
            headers: authHeaders(adminUserId),
            payload: { displayName: 'Slice48 Customer Disposable' },
          })
        ).json(),
      ).id;
      expect(
        (
          await app.inject({
            method: 'DELETE',
            url: `/customers/${extraCustomerId}`,
            headers: authHeaders(adminUserId),
          })
        ).statusCode,
      ).toBe(204);
      moduleStatus.customers = 'pass';

      supplierId = idSchema.parse(
        (
          await app.inject({
            method: 'POST',
            url: '/suppliers',
            headers: authHeaders(adminUserId),
            payload: { displayName: 'Slice48 Supplier Primary', email: 'supplier@slice48.test' },
          })
        ).json(),
      ).id;
      const supplierGet = await app.inject({
        method: 'GET',
        url: `/suppliers/${supplierId}`,
        headers: authHeaders(adminUserId),
      });
      const suppliersList = await app.inject({
        method: 'GET',
        url: '/suppliers?limit=10&offset=0',
        headers: authHeaders(adminUserId),
      });
      expect(supplierGet.statusCode).toBe(200);
      expect(suppliersList.statusCode).toBe(200);

      extraSupplierId = idSchema.parse(
        (
          await app.inject({
            method: 'POST',
            url: '/suppliers',
            headers: authHeaders(adminUserId),
            payload: { displayName: 'Slice48 Supplier Disposable' },
          })
        ).json(),
      ).id;
      expect(
        (
          await app.inject({
            method: 'DELETE',
            url: `/suppliers/${extraSupplierId}`,
            headers: authHeaders(adminUserId),
          })
        ).statusCode,
      ).toBe(204);
      moduleStatus.suppliers = 'pass';

      extraRoleId = idSchema.parse(
        (
          await app.inject({
            method: 'POST',
            url: '/roles',
            headers: authHeaders(adminUserId),
            payload: { name: 'Slice48 Temporary Role', canBeAssigned: true, canManageAssignments: false },
          })
        ).json(),
      ).id;
      extraUserId = idSchema.parse(
        (
          await app.inject({
            method: 'POST',
            url: '/users',
            headers: authHeaders(adminUserId),
            payload: { displayName: 'Slice48 Temporary User', roleIds: [extraRoleId] },
          })
        ).json(),
      ).id;

      teamId = idSchema.parse(
        (
          await app.inject({
            method: 'POST',
            url: '/teams',
            headers: authHeaders(adminUserId),
            payload: { name: 'Slice48 Team' },
          })
        ).json(),
      ).id;
      expect(
        (
          await app.inject({
            method: 'POST',
            url: `/teams/${teamId}/members`,
            headers: authHeaders(adminUserId),
            payload: { userId: adminUserId, role: 'owner' },
          })
        ).statusCode,
      ).toBe(201);
      expect(
        (
          await app.inject({
            method: 'POST',
            url: `/teams/${teamId}/members`,
            headers: authHeaders(adminUserId),
            payload: { userId: memberUserId, role: 'member' },
          })
        ).statusCode,
      ).toBe(201);
      expect(
        (
          await app.inject({
            method: 'PATCH',
            url: `/teams/${teamId}/members/${memberUserId}/role`,
            headers: authHeaders(adminUserId),
            payload: { role: 'manager' },
          })
        ).statusCode,
      ).toBe(200);
      expect(
        (
          await app.inject({
            method: 'GET',
            url: `/teams/${teamId}/members?limit=10&offset=0`,
            headers: authHeaders(adminUserId),
          })
        ).statusCode,
      ).toBe(200);
      expect(
        (
          await app.inject({
            method: 'GET',
            url: '/roles?limit=20&offset=0',
            headers: authHeaders(adminUserId),
          })
        ).statusCode,
      ).toBe(200);
      expect(
        (
          await app.inject({
            method: 'GET',
            url: '/users?limit=20&offset=0',
            headers: authHeaders(adminUserId),
          })
        ).statusCode,
      ).toBe(200);
      expect(
        (
          await app.inject({
            method: 'GET',
            url: `/roles/${extraRoleId}`,
            headers: authHeaders(adminUserId),
          })
        ).statusCode,
      ).toBe(200);
      expect(
        (
          await app.inject({
            method: 'GET',
            url: `/users/${extraUserId}`,
            headers: authHeaders(adminUserId),
          })
        ).statusCode,
      ).toBe(200);
      moduleStatus.usersRolesTeams = 'pass';

      jobId = idSchema.parse(
        (
          await app.inject({
            method: 'POST',
            url: '/jobs',
            headers: authHeaders(adminUserId),
            payload: {
              title: 'Slice48 Job Primary',
              customerId,
              status: 'Scheduled',
              priority: 'Normal',
              assignedUserId: memberUserId,
              teamId,
              scheduledStart: '2026-07-10T08:00:00.000Z',
              scheduledEnd: '2026-07-10T09:00:00.000Z',
            },
          })
        ).json(),
      ).id;
      expect(
        (
          await app.inject({
            method: 'PUT',
            url: `/jobs/${jobId}`,
            headers: authHeaders(adminUserId),
            payload: {
              title: 'Slice48 Job Updated',
              status: 'In Progress',
              priority: 'High',
              assignedUserId: memberUserId,
              teamId,
            },
          })
        ).statusCode,
      ).toBe(200);
      expect(
        (
          await app.inject({
            method: 'GET',
            url: `/jobs/${jobId}`,
            headers: authHeaders(adminUserId),
          })
        ).statusCode,
      ).toBe(200);
      expect(
        (
          await app.inject({
            method: 'GET',
            url: '/jobs?limit=10&offset=0',
            headers: authHeaders(adminUserId),
          })
        ).statusCode,
      ).toBe(200);
      moduleStatus.jobs = 'pass';

      invoiceId = idSchema.parse(
        (
          await app.inject({
            method: 'POST',
            url: '/invoices',
            headers: authHeaders(adminUserId),
            payload: {
              customerId,
              title: 'Slice48 Invoice Primary',
              issueDate: '2026-07-10',
              dueDate: '2026-07-25',
              paymentTerms: '14 days',
              lineItems: [{ description: 'Consulting', quantity: 2, unitPrice: 100, gstApplicable: true }],
            },
          })
        ).json(),
      ).id;
      expect(
        (
          await app.inject({
            method: 'PUT',
            url: `/invoices/${invoiceId}`,
            headers: authHeaders(adminUserId),
            payload: {
              title: 'Slice48 Invoice Updated',
              issueDate: '2026-07-10',
              dueDate: '2026-07-25',
              paymentTerms: '14 days',
              paymentState: 'Draft',
              lineItems: [{ description: 'Consulting updated', quantity: 2, unitPrice: 100, gstApplicable: true }],
            },
          })
        ).statusCode,
      ).toBe(200);
      expect(
        (
          await app.inject({
            method: 'POST',
            url: `/invoices/${invoiceId}/finalise`,
            headers: authHeaders(adminUserId),
          })
        ).statusCode,
      ).toBe(200);
      expect(
        (
          await app.inject({
            method: 'POST',
            url: `/jobs/${jobId}/documents`,
            headers: authHeaders(adminUserId),
            payload: { documentId: invoiceId },
          })
        ).statusCode,
      ).toBe(201);
      expect(
        (
          await app.inject({
            method: 'GET',
            url: `/jobs/${jobId}/documents?limit=10&offset=0`,
            headers: authHeaders(adminUserId),
          })
        ).statusCode,
      ).toBe(200);
      const invoicePdf = await app.inject({
        method: 'GET',
        url: `/invoices/${invoiceId}/pdf`,
        headers: authHeaders(adminUserId),
      });
      expectPdfResponse(invoicePdf);
      moduleStatus.invoices = 'pass';

      creditNoteId = idSchema.parse(
        (
          await app.inject({
            method: 'POST',
            url: '/credit-notes',
            headers: authHeaders(adminUserId),
            payload: {
              linkedInvoiceId: invoiceId,
              customerId,
              issueDate: '2026-07-11',
              reason: 'Discount',
              type: 'Partial',
              totalCredit: 20,
              lineItems: [{ description: 'Discount adjustment', amount: 20 }],
            },
          })
        ).json(),
      ).id;
      expect(
        (
          await app.inject({
            method: 'GET',
            url: `/credit-notes/${creditNoteId}`,
            headers: authHeaders(adminUserId),
          })
        ).statusCode,
      ).toBe(200);
      expect(
        (
          await app.inject({
            method: 'GET',
            url: `/credit-notes?customerId=${customerId}&limit=10&offset=0`,
            headers: authHeaders(adminUserId),
          })
        ).statusCode,
      ).toBe(200);
      expect(
        (
          await app.inject({
            method: 'GET',
            url: `/credit-notes/customers/${customerId}?limit=10&offset=0`,
            headers: authHeaders(adminUserId),
          })
        ).statusCode,
      ).toBe(200);
      expect(
        (
          await app.inject({
            method: 'GET',
            url: `/credit-notes/invoices/${invoiceId}?limit=10&offset=0`,
            headers: authHeaders(adminUserId),
          })
        ).statusCode,
      ).toBe(200);
      const creditNoteHtml = await app.inject({
        method: 'GET',
        url: `/credit-notes/${creditNoteId}/html`,
        headers: authHeaders(adminUserId),
      });
      expectHtmlResponse(creditNoteHtml);
      const creditNotePdf = await app.inject({
        method: 'GET',
        url: `/credit-notes/${creditNoteId}/pdf`,
        headers: authHeaders(adminUserId),
      });
      expectPdfResponse(creditNotePdf);
      moduleStatus.creditNotes = 'pass';

      customerPaymentId = idSchema.parse(
        (
          await app.inject({
            method: 'POST',
            url: '/payments',
            headers: authHeaders(adminUserId),
            payload: {
              customerId,
              paymentDate: '2026-07-12',
              paymentMethod: 'Bank Transfer',
              reference: 'SL48-PAY-001',
              amount: 50,
              allocations: [{ invoiceId, amount: 50 }],
            },
          })
        ).json(),
      ).id;
      expect(
        (
          await app.inject({
            method: 'GET',
            url: `/payments/${customerPaymentId}`,
            headers: authHeaders(adminUserId),
          })
        ).statusCode,
      ).toBe(200);
      expect(
        (
          await app.inject({
            method: 'GET',
            url: `/payments?customerId=${customerId}&limit=10&offset=0`,
            headers: authHeaders(adminUserId),
          })
        ).statusCode,
      ).toBe(200);
      expect(
        (
          await app.inject({
            method: 'GET',
            url: `/payments/customers/${customerId}?limit=10&offset=0`,
            headers: authHeaders(adminUserId),
          })
        ).statusCode,
      ).toBe(200);
      expect(
        (
          await app.inject({
            method: 'GET',
            url: `/payments/invoices/${invoiceId}?limit=10&offset=0`,
            headers: authHeaders(adminUserId),
          })
        ).statusCode,
      ).toBe(200);
      const paymentHtml = await app.inject({
        method: 'GET',
        url: `/payments/${customerPaymentId}/html`,
        headers: authHeaders(adminUserId),
      });
      expectHtmlResponse(paymentHtml);
      const paymentPdf = await app.inject({
        method: 'GET',
        url: `/payments/${customerPaymentId}/pdf`,
        headers: authHeaders(adminUserId),
      });
      expectPdfResponse(paymentPdf);
      moduleStatus.customerPayments = 'pass';

      const statementJson = await app.inject({
        method: 'GET',
        url: `/statements/customers/${customerId}?from=2026-07-01&to=2026-07-31`,
        headers: authHeaders(adminUserId),
      });
      const statementHtml = await app.inject({
        method: 'GET',
        url: `/statements/customers/${customerId}/html?from=2026-07-01&to=2026-07-31`,
        headers: authHeaders(adminUserId),
      });
      const statementPdf = await app.inject({
        method: 'GET',
        url: `/statements/customers/${customerId}/pdf?from=2026-07-01&to=2026-07-31`,
        headers: authHeaders(adminUserId),
      });
      expect(statementJson.statusCode).toBe(200);
      expectHtmlResponse(statementHtml);
      expectPdfResponse(statementPdf);
      expect(statementHtml.headers['x-statement-source-signature']).toBe(statementPdf.headers['x-statement-source-signature']);
      moduleStatus.customerStatements = 'pass';

      purchaseOrderId = idSchema.parse(
        (
          await app.inject({
            method: 'POST',
            url: '/purchase-orders',
            headers: authHeaders(adminUserId),
            payload: {
              supplierId,
              issueDate: '2026-07-10',
              expectedDeliveryDate: '2026-07-20',
              supplierReference: 'SL48-PO-001',
              currency: 'AUD',
              lineItems: [{ description: 'Equipment', quantity: 2, unitPrice: 75, gstApplicable: true }],
            },
          })
        ).json(),
      ).id;
      expect(
        (
          await app.inject({
            method: 'PUT',
            url: `/purchase-orders/${purchaseOrderId}`,
            headers: authHeaders(adminUserId),
            payload: {
              issueDate: '2026-07-10',
              expectedDeliveryDate: '2026-07-21',
              supplierReference: 'SL48-PO-001-UPDATED',
              currency: 'AUD',
              lineItems: [{ description: 'Equipment updated', quantity: 2, unitPrice: 75, gstApplicable: true }],
            },
          })
        ).statusCode,
      ).toBe(200);
      expect(
        (
          await app.inject({
            method: 'POST',
            url: `/purchase-orders/${purchaseOrderId}/approve`,
            headers: authHeaders(adminUserId),
          })
        ).statusCode,
      ).toBe(200);
      supplierBillId = idSchema.parse(
        (
          await app.inject({
            method: 'POST',
            url: `/purchase-orders/${purchaseOrderId}/create-supplier-bill`,
            headers: authHeaders(adminUserId),
            payload: {},
          })
        ).json(),
      ).id;
      expect(
        (
          await app.inject({
            method: 'POST',
            url: `/supplier-bills/${supplierBillId}/finalise`,
            headers: authHeaders(adminUserId),
          })
        ).statusCode,
      ).toBe(200);
      expect(
        (
          await app.inject({
            method: 'GET',
            url: `/supplier-bills/${supplierBillId}`,
            headers: authHeaders(adminUserId),
          })
        ).statusCode,
      ).toBe(200);
      expect(
        (
          await app.inject({
            method: 'GET',
            url: `/supplier-bills?sourcePurchaseOrderId=${purchaseOrderId}&limit=10&offset=0`,
            headers: authHeaders(adminUserId),
          })
        ).statusCode,
      ).toBe(200);
      const purchaseOrderHtml = await app.inject({
        method: 'GET',
        url: `/purchase-orders/${purchaseOrderId}/html`,
        headers: authHeaders(adminUserId),
      });
      expectHtmlResponse(purchaseOrderHtml);
      const purchaseOrderPdf = await app.inject({
        method: 'GET',
        url: `/purchase-orders/${purchaseOrderId}/pdf`,
        headers: authHeaders(adminUserId),
      });
      expectPdfResponse(purchaseOrderPdf);
      const supplierBillHtml = await app.inject({
        method: 'GET',
        url: `/supplier-bills/${supplierBillId}/html`,
        headers: authHeaders(adminUserId),
      });
      expectHtmlResponse(supplierBillHtml);
      const supplierBillPdf = await app.inject({
        method: 'GET',
        url: `/supplier-bills/${supplierBillId}/pdf`,
        headers: authHeaders(adminUserId),
      });
      expectPdfResponse(supplierBillPdf);
      moduleStatus.procurementAndSupplierBills = 'pass';

      supplierPaymentId = idSchema.parse(
        (
          await app.inject({
            method: 'POST',
            url: '/supplier-payments',
            headers: authHeaders(adminUserId),
            payload: {
              supplierId,
              paymentDate: '2026-07-13',
              paymentMethod: 'Bank Transfer',
              reference: 'SL48-SP-001',
              amount: 60,
              allocations: [{ supplierBillId, amount: 60 }],
            },
          })
        ).json(),
      ).id;
      expect(
        (
          await app.inject({
            method: 'GET',
            url: `/supplier-payments/${supplierPaymentId}`,
            headers: authHeaders(adminUserId),
          })
        ).statusCode,
      ).toBe(200);
      expect(
        (
          await app.inject({
            method: 'GET',
            url: `/supplier-payments?supplierId=${supplierId}&limit=10&offset=0`,
            headers: authHeaders(adminUserId),
          })
        ).statusCode,
      ).toBe(200);
      expect(
        (
          await app.inject({
            method: 'GET',
            url: `/supplier-payments/suppliers/${supplierId}?limit=10&offset=0`,
            headers: authHeaders(adminUserId),
          })
        ).statusCode,
      ).toBe(200);
      expect(
        (
          await app.inject({
            method: 'GET',
            url: `/supplier-payments/bills/${supplierBillId}?limit=10&offset=0`,
            headers: authHeaders(adminUserId),
          })
        ).statusCode,
      ).toBe(200);
      const supplierPaymentHtml = await app.inject({
        method: 'GET',
        url: `/supplier-payments/${supplierPaymentId}/html`,
        headers: authHeaders(adminUserId),
      });
      expectHtmlResponse(supplierPaymentHtml);
      const supplierPaymentPdf = await app.inject({
        method: 'GET',
        url: `/supplier-payments/${supplierPaymentId}/pdf`,
        headers: authHeaders(adminUserId),
      });
      expectPdfResponse(supplierPaymentPdf);
      moduleStatus.supplierPayments = 'pass';

      const reportA = await app.inject({
        method: 'GET',
        url: '/reports/read-model?from=2026-07-01&to=2026-07-31&limit=50&offset=0',
        headers: authHeaders(adminUserId),
      });
      const reportB = await app.inject({
        method: 'GET',
        url: '/reports/read-model?from=2026-07-01&to=2026-07-31&limit=50&offset=0',
        headers: authHeaders(adminUserId),
      });
      expect(reportA.statusCode).toBe(200);
      expect(reportB.statusCode).toBe(200);
      expect(reportA.json()).toEqual(reportB.json());
      const reportSummary = reportSummarySchema.parse(reportA.json());
      expect(reportSummary.accountsReceivable.totals.outstanding).toBeGreaterThanOrEqual(0);
      expect(reportSummary.accountsPayable.totals.supplierBillOutstanding).toBeGreaterThanOrEqual(0);

      const searchA = await app.inject({
        method: 'GET',
        url: '/search?q=Slice48&limit=50&offset=0',
        headers: authHeaders(adminUserId),
      });
      const searchB = await app.inject({
        method: 'GET',
        url: '/search?q=Slice48&limit=50&offset=0',
        headers: authHeaders(adminUserId),
      });
      expect(searchA.statusCode).toBe(200);
      expect(searchB.statusCode).toBe(200);
      expect(searchA.json()).toEqual(searchB.json());

      const timeline = await app.inject({
        method: 'GET',
        url: `/timeline/invoice/${invoiceId}?limit=50&offset=0`,
        headers: authHeaders(adminUserId),
      });
      expect(timeline.statusCode).toBe(200);
      expect(JSON.stringify(timeline.json())).toContain('invoice.finalised');
      moduleStatus.reportingSearchTimeline = 'pass';

      const snapshotBefore = backupSchema.parse(
        (
          await app.inject({
            method: 'GET',
            url: '/platform/backup',
            headers: authHeaders(adminUserId),
          })
        ).json(),
      );
      const rejectedMutation = await app.inject({
        method: 'PUT',
        url: `/invoices/${invoiceId}`,
        headers: authHeaders(adminUserId),
        payload: {
          title: 'Should reject finalised edit',
          issueDate: '2026-07-10',
          dueDate: '2026-07-25',
          paymentState: 'Draft',
          lineItems: [{ description: 'Rejected line', quantity: 1, unitPrice: 1, gstApplicable: true }],
        },
      });
      expect(rejectedMutation.statusCode).toBe(409);
      const snapshotAfterRejection = backupSchema.parse(
        (
          await app.inject({
            method: 'GET',
            url: '/platform/backup',
            headers: authHeaders(adminUserId),
          })
        ).json(),
      );
      expect(snapshotAfterRejection.snapshot.entities.timeline_events ?? []).toHaveLength(
        (snapshotBefore.snapshot.entities.timeline_events ?? []).length,
      );
      moduleStatus.rejectionNoMutation = 'pass';

      const restored = createTempDbPath('ai-business-os-slice48-restore-');
      const restoreApp = await buildApp({ dbPath: restored.dbPath, authBypassForTesting: true });
      try {
        const restoreResponse = await restoreApp.inject({
          method: 'POST',
          url: '/platform/restore',
          payload: { snapshot: snapshotBefore.snapshot },
        });
        expect(restoreResponse.statusCode).toBe(204);

        const restoredBackup = backupSchema.parse((await restoreApp.inject({ method: 'GET', url: '/platform/backup' })).json());
        expect(restoredBackup.snapshot.entities.invoices ?? []).toHaveLength(
          (snapshotBefore.snapshot.entities.invoices ?? []).length,
        );
        expect(restoredBackup.snapshot.entities.timeline_events ?? []).toHaveLength(
          (snapshotBefore.snapshot.entities.timeline_events ?? []).length,
        );

        const restoredReport = await restoreApp.inject({
          method: 'GET',
          url: '/reports/read-model?from=2026-07-01&to=2026-07-31&limit=50&offset=0',
        });
        expect(restoredReport.statusCode).toBe(200);
        expect(restoredReport.json()).toEqual(reportA.json());

        const restoredSearch = await restoreApp.inject({ method: 'GET', url: '/search?q=Slice48&limit=50&offset=0' });
        expect(restoredSearch.statusCode).toBe(200);
        expect(restoredSearch.json()).toEqual(searchA.json());
      } finally {
        await restoreApp.close();
        rmSync(restored.dir, { recursive: true, force: true });
      }
      moduleStatus.backupRestore = 'pass';

      expect(
        (
          await app.inject({
            method: 'DELETE',
            url: `/users/${extraUserId}`,
            headers: authHeaders(adminUserId),
          })
        ).statusCode,
      ).toBe(204);
      expect(
        (
          await app.inject({
            method: 'DELETE',
            url: `/roles/${extraRoleId}`,
            headers: authHeaders(adminUserId),
          })
        ).statusCode,
      ).toBe(204);
      expect(
        (
          await app.inject({
            method: 'DELETE',
            url: `/teams/${teamId}/members/${memberUserId}`,
            headers: authHeaders(adminUserId),
          })
        ).statusCode,
      ).toBe(409);

      expect(
        (
          await app.inject({
            method: 'GET',
            url: '/teams?limit=10&offset=0',
            headers: authHeaders(adminUserId),
          })
        ).statusCode,
      ).toBe(200);

      expect(Object.values(moduleStatus)).toEqual([
        'pass',
        'pass',
        'pass',
        'pass',
        'pass',
        'pass',
        'pass',
        'pass',
        'pass',
        'pass',
        'pass',
        'pass',
        'pass',
        'pass',
        'pass',
        'pass',
      ]);
    } finally {
      await app.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
