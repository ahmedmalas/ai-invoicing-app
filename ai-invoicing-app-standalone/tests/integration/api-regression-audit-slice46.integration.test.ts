import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { buildApp } from '../../src/app.js';

const idSchema = z.object({ id: z.string().uuid() });
const errorSchema = z.object({
  status: z.number().int(),
  code: z.string(),
  message: z.string(),
});
const backupSchema = z.object({
  snapshot: z.object({
    entities: z.record(z.string(), z.array(z.record(z.string(), z.unknown()))),
  }),
});
const invoiceReadSchema = z.object({
  id: z.string().uuid(),
  invoiceNumber: z.string().nullable(),
});
const supplierBillReadSchema = z.object({
  id: z.string().uuid(),
  billNumber: z.string().nullable(),
});
const purchaseOrderReadSchema = z.object({
  id: z.string().uuid(),
  purchaseOrderNumber: z.string(),
});

function createTempDbPath(prefix: string): { dir: string; dbPath: string } {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  return { dir, dbPath: join(dir, 'app.db') };
}

function authHeaders(userId: string): Record<string, string> {
  return { 'x-actor-user-id': userId };
}

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
interface RouteAuditRequest {
  method: HttpMethod;
  url: string;
  payload?: Record<string, unknown>;
}

describe('slice 46 api contract and full regression audit', () => {
  it('enforces authentication contract across all route surfaces', async () => {
    const { dir, dbPath } = createTempDbPath('ai-business-os-slice46-auth-');
    const bootstrap = await buildApp({ dbPath, authBypassForTesting: true });

    let adminUserId = '';
    let readOnlyUserId = '';
    let customerId = '';
    let supplierId = '';
    let teamId = '';
    let jobId = '';
    let invoiceId = '';
    let creditNoteId = '';
    let paymentId = '';
    let purchaseOrderId = '';
    let supplierBillId = '';
    let supplierPaymentId = '';
    let roleId = '';
    try {
      const adminRole = idSchema.parse(
        (
          await bootstrap.inject({
            method: 'POST',
            url: '/roles',
            payload: { name: 'Slice46 Admin', canBeAssigned: true, canManageAssignments: true },
          })
        ).json(),
      );
      const readOnlyRole = idSchema.parse(
        (
          await bootstrap.inject({
            method: 'POST',
            url: '/roles',
            payload: { name: 'Slice46 ReadOnly', canBeAssigned: false, canManageAssignments: false },
          })
        ).json(),
      );
      roleId = readOnlyRole.id;

      adminUserId = idSchema.parse(
        (
          await bootstrap.inject({
            method: 'POST',
            url: '/users',
            payload: { displayName: 'Slice46 Admin User', roleIds: [adminRole.id] },
          })
        ).json(),
      ).id;
      readOnlyUserId = idSchema.parse(
        (
          await bootstrap.inject({
            method: 'POST',
            url: '/users',
            payload: { displayName: 'Slice46 Readonly User', roleIds: [readOnlyRole.id] },
          })
        ).json(),
      ).id;

      customerId = idSchema.parse(
        (
          await bootstrap.inject({
            method: 'POST',
            url: '/customers',
            payload: { displayName: 'Slice46 Customer' },
          })
        ).json(),
      ).id;
      supplierId = idSchema.parse(
        (
          await bootstrap.inject({
            method: 'POST',
            url: '/suppliers',
            payload: { displayName: 'Slice46 Supplier' },
          })
        ).json(),
      ).id;
      teamId = idSchema.parse(
        (
          await bootstrap.inject({
            method: 'POST',
            url: '/teams',
            payload: { name: 'Slice46 Team' },
          })
        ).json(),
      ).id;
      expect(
        (
          await bootstrap.inject({
            method: 'POST',
            url: `/teams/${teamId}/members`,
            headers: authHeaders(adminUserId),
            payload: { userId: adminUserId, role: 'owner' },
          })
        ).statusCode,
      ).toBe(201);

      invoiceId = idSchema.parse(
        (
          await bootstrap.inject({
            method: 'POST',
            url: '/invoices',
            payload: {
              customerId,
              title: 'Slice46 Invoice',
              issueDate: '2026-07-10',
              dueDate: '2026-07-25',
              lineItems: [{ description: 'Invoice line', quantity: 1, unitPrice: 120, gstApplicable: true }],
            },
          })
        ).json(),
      ).id;
      expect((await bootstrap.inject({ method: 'POST', url: `/invoices/${invoiceId}/finalise` })).statusCode).toBe(200);

      paymentId = idSchema.parse(
        (
          await bootstrap.inject({
            method: 'POST',
            url: '/payments',
            payload: {
              customerId,
              paymentDate: '2026-07-11',
              paymentMethod: 'Bank Transfer',
              reference: 'SL46-PAY',
              amount: 30,
              allocations: [{ invoiceId, amount: 30 }],
            },
          })
        ).json(),
      ).id;
      creditNoteId = idSchema.parse(
        (
          await bootstrap.inject({
            method: 'POST',
            url: '/credit-notes',
            payload: {
              linkedInvoiceId: invoiceId,
              customerId,
              issueDate: '2026-07-11',
              reason: 'Slice46 credit',
              type: 'Partial',
              totalCredit: 15,
              lineItems: [{ description: 'Credit line', amount: 15 }],
            },
          })
        ).json(),
      ).id;

      purchaseOrderId = idSchema.parse(
        (
          await bootstrap.inject({
            method: 'POST',
            url: '/purchase-orders',
            payload: {
              supplierId,
              issueDate: '2026-07-10',
              expectedDeliveryDate: '2026-07-18',
              supplierReference: 'SL46-PO',
              currency: 'AUD',
              lineItems: [{ description: 'PO line', quantity: 2, unitPrice: 80, gstApplicable: true }],
            },
          })
        ).json(),
      ).id;
      expect((await bootstrap.inject({ method: 'POST', url: `/purchase-orders/${purchaseOrderId}/approve` })).statusCode).toBe(
        200,
      );
      supplierBillId = idSchema.parse(
        (
          await bootstrap.inject({
            method: 'POST',
            url: `/purchase-orders/${purchaseOrderId}/create-supplier-bill`,
            payload: {},
          })
        ).json(),
      ).id;
      expect((await bootstrap.inject({ method: 'POST', url: `/supplier-bills/${supplierBillId}/finalise` })).statusCode).toBe(
        200,
      );
      supplierPaymentId = idSchema.parse(
        (
          await bootstrap.inject({
            method: 'POST',
            url: '/supplier-payments',
            payload: {
              supplierId,
              paymentDate: '2026-07-12',
              paymentMethod: 'Bank Transfer',
              reference: 'SL46-SPAY',
              amount: 40,
              allocations: [{ supplierBillId, amount: 40 }],
            },
          })
        ).json(),
      ).id;

      jobId = idSchema.parse(
        (
          await bootstrap.inject({
            method: 'POST',
            url: '/jobs',
            payload: {
              title: 'Slice46 Job',
              customerId,
              status: 'Scheduled',
              priority: 'Normal',
              assignedUserId: adminUserId,
              teamId,
            },
          })
        ).json(),
      ).id;
      expect(
        (
          await bootstrap.inject({
            method: 'POST',
            url: `/jobs/${jobId}/documents`,
            payload: { documentId: invoiceId },
          })
        ).statusCode,
      ).toBe(201);
    } finally {
      await bootstrap.close();
    }

    const app = await buildApp({ dbPath, authBypassForTesting: false });
    try {
      const publicRequests = [
        { method: 'GET' as const, url: '/health' },
        { method: 'GET' as const, url: '/health/live' },
        { method: 'GET' as const, url: '/health/ready' },
      ];
      for (const request of publicRequests) {
        const response = await app.inject(request);
        expect(response.statusCode).toBe(200);
      }

      const protectedRequests: RouteAuditRequest[] = [
        { method: 'GET', url: '/health/diagnostics' },
        { method: 'POST', url: '/business-profile', payload: { companyName: 'X', primaryColor: '#111111', secondaryColor: '#ffffff' } },
        { method: 'GET', url: '/business-profile' },
        { method: 'POST', url: '/business-profile/logo-placeholder', payload: {} },
        { method: 'POST', url: '/preferences/branding', payload: { value: { theme: 'default' } } },
        { method: 'GET', url: '/preferences/branding' },
        { method: 'POST', url: '/customers', payload: { displayName: 'Denied' } },
        { method: 'PUT', url: `/customers/${customerId}`, payload: { displayName: 'Denied Update' } },
        { method: 'GET', url: `/customers/${customerId}` },
        { method: 'DELETE', url: `/customers/${customerId}` },
        { method: 'POST', url: '/suppliers', payload: { displayName: 'Denied Supplier' } },
        { method: 'GET', url: '/suppliers' },
        { method: 'GET', url: `/suppliers/${supplierId}` },
        { method: 'DELETE', url: `/suppliers/${supplierId}` },
        { method: 'POST', url: '/roles', payload: { name: 'Denied Role', canBeAssigned: true, canManageAssignments: false } },
        { method: 'GET', url: '/roles' },
        { method: 'GET', url: `/roles/${roleId}` },
        { method: 'DELETE', url: `/roles/${roleId}` },
        { method: 'POST', url: '/users', payload: { displayName: 'Denied User', roleIds: [roleId] } },
        { method: 'GET', url: '/users' },
        { method: 'GET', url: `/users/${readOnlyUserId}` },
        { method: 'DELETE', url: `/users/${readOnlyUserId}` },
        { method: 'POST', url: '/teams', payload: { name: 'Denied Team' } },
        { method: 'GET', url: '/teams' },
        { method: 'GET', url: `/teams/${teamId}` },
        { method: 'POST', url: `/teams/${teamId}/members`, payload: { userId: readOnlyUserId, role: 'member' } },
        { method: 'GET', url: `/teams/${teamId}/members` },
        { method: 'DELETE', url: `/teams/${teamId}/members/${readOnlyUserId}` },
        { method: 'PATCH', url: `/teams/${teamId}/members/${adminUserId}/role`, payload: { role: 'manager' } },
        { method: 'DELETE', url: `/teams/${teamId}` },
        { method: 'POST', url: '/jobs', payload: { title: 'Denied Job', customerId, status: 'Draft', priority: 'Normal' } },
        { method: 'PUT', url: `/jobs/${jobId}`, payload: { title: 'Denied Job Update' } },
        { method: 'GET', url: '/jobs' },
        { method: 'GET', url: `/jobs/${jobId}` },
        { method: 'POST', url: `/jobs/${jobId}/documents`, payload: { documentId: invoiceId } },
        { method: 'GET', url: `/jobs/${jobId}/documents` },
        { method: 'POST', url: '/invoices', payload: { customerId, title: 'Denied Invoice', issueDate: '2026-07-10', dueDate: '2026-07-25', lineItems: [{ description: 'Line', quantity: 1, unitPrice: 10, gstApplicable: true }] } },
        { method: 'PUT', url: `/invoices/${invoiceId}`, payload: { title: 'Denied Invoice Update', issueDate: '2026-07-10', dueDate: '2026-07-25', lineItems: [{ description: 'Line', quantity: 1, unitPrice: 10, gstApplicable: true }] } },
        { method: 'GET', url: `/invoices/${invoiceId}` },
        { method: 'POST', url: `/invoices/${invoiceId}/finalise` },
        { method: 'GET', url: `/invoices/${invoiceId}/pdf` },
        { method: 'POST', url: '/credit-notes', payload: { linkedInvoiceId: invoiceId, customerId, issueDate: '2026-07-11', reason: 'Denied', type: 'Partial', totalCredit: 5, lineItems: [{ description: 'Line', amount: 5 }] } },
        { method: 'GET', url: `/credit-notes/${creditNoteId}` },
        { method: 'GET', url: '/credit-notes?limit=10&offset=0' },
        { method: 'GET', url: `/credit-notes/customers/${customerId}` },
        { method: 'GET', url: `/credit-notes/invoices/${invoiceId}` },
        { method: 'GET', url: `/credit-notes/${creditNoteId}/html` },
        { method: 'GET', url: `/credit-notes/${creditNoteId}/pdf` },
        { method: 'POST', url: '/payments', payload: { customerId, paymentDate: '2026-07-11', paymentMethod: 'Bank Transfer', reference: 'DENIED', amount: 10, allocations: [{ invoiceId, amount: 10 }] } },
        { method: 'GET', url: `/payments/${paymentId}` },
        { method: 'GET', url: '/payments?limit=10&offset=0' },
        { method: 'GET', url: `/payments/customers/${customerId}` },
        { method: 'GET', url: `/payments/invoices/${invoiceId}` },
        { method: 'GET', url: `/payments/${paymentId}/html` },
        { method: 'GET', url: `/payments/${paymentId}/pdf` },
        { method: 'POST', url: '/purchase-orders', payload: { supplierId, issueDate: '2026-07-10', expectedDeliveryDate: '2026-07-20', supplierReference: 'DENIED-PO', currency: 'AUD', lineItems: [{ description: 'Line', quantity: 1, unitPrice: 10, gstApplicable: true }] } },
        { method: 'PUT', url: `/purchase-orders/${purchaseOrderId}`, payload: { supplierReference: 'DENIED-PO-UPDATE' } },
        { method: 'POST', url: `/purchase-orders/${purchaseOrderId}/approve` },
        { method: 'POST', url: `/purchase-orders/${purchaseOrderId}/close`, payload: { closeReason: 'Denied', closedDate: '2026-07-12' } },
        { method: 'POST', url: `/purchase-orders/${purchaseOrderId}/cancel` },
        { method: 'POST', url: `/purchase-orders/${purchaseOrderId}/create-supplier-bill`, payload: {} },
        { method: 'GET', url: `/purchase-orders/${purchaseOrderId}` },
        { method: 'DELETE', url: `/purchase-orders/${purchaseOrderId}` },
        { method: 'GET', url: '/purchase-orders?limit=10&offset=0' },
        { method: 'GET', url: `/purchase-orders/${purchaseOrderId}/html` },
        { method: 'GET', url: `/purchase-orders/${purchaseOrderId}/pdf` },
        { method: 'POST', url: '/supplier-bills', payload: { supplierId, billDate: '2026-07-12', dueDate: '2026-07-20', currency: 'AUD', lineItems: [{ description: 'Line', quantity: 1, unitPrice: 10, gstApplicable: true }] } },
        { method: 'PUT', url: `/supplier-bills/${supplierBillId}`, payload: { notes: 'Denied update' } },
        { method: 'POST', url: `/supplier-bills/${supplierBillId}/finalise` },
        { method: 'GET', url: `/supplier-bills/${supplierBillId}` },
        { method: 'DELETE', url: `/supplier-bills/${supplierBillId}` },
        { method: 'GET', url: '/supplier-bills?limit=10&offset=0' },
        { method: 'GET', url: `/supplier-bills/${supplierBillId}/html` },
        { method: 'GET', url: `/supplier-bills/${supplierBillId}/pdf` },
        { method: 'POST', url: '/supplier-payments', payload: { supplierId, paymentDate: '2026-07-12', paymentMethod: 'Bank Transfer', reference: 'DENIED-SP', amount: 10, allocations: [{ supplierBillId, amount: 10 }] } },
        { method: 'GET', url: `/supplier-payments/${supplierPaymentId}` },
        { method: 'GET', url: '/supplier-payments?limit=10&offset=0' },
        { method: 'GET', url: `/supplier-payments/suppliers/${supplierId}` },
        { method: 'GET', url: `/supplier-payments/bills/${supplierBillId}` },
        { method: 'GET', url: `/supplier-payments/${supplierPaymentId}/html` },
        { method: 'GET', url: `/supplier-payments/${supplierPaymentId}/pdf` },
        { method: 'GET', url: '/reports/read-model?from=2026-07-01&to=2026-07-31&limit=10&offset=0' },
        { method: 'GET', url: '/search?q=slice46&limit=10&offset=0' },
        { method: 'GET', url: `/timeline/invoice/${invoiceId}?limit=10&offset=0` },
        { method: 'GET', url: `/statements/customers/${customerId}?from=2026-07-01&to=2026-07-31` },
        { method: 'GET', url: `/statements/customers/${customerId}/html?from=2026-07-01&to=2026-07-31` },
        { method: 'GET', url: `/statements/customers/${customerId}/pdf?from=2026-07-01&to=2026-07-31` },
        { method: 'GET', url: '/platform/backup' },
        { method: 'POST', url: '/platform/restore', payload: { snapshot: { nope: true } } },
      ];

      for (const request of protectedRequests) {
        const response = await app.inject({
          method: request.method,
          url: request.url,
          ...(request.payload !== undefined ? { payload: request.payload } : {}),
        });
        expect(response.statusCode).toBe(401);
        expect(errorSchema.parse(response.json()).code).toBe('AUTH_UNAUTHENTICATED');
      }

      const adminOnlyRequests: RouteAuditRequest[] = [
        { method: 'GET', url: '/health/diagnostics' },
        { method: 'GET', url: '/platform/backup' },
        { method: 'POST', url: '/platform/restore', payload: { snapshot: { nope: true } } },
        { method: 'POST', url: '/roles', payload: { name: 'Denied Role', canBeAssigned: true, canManageAssignments: true } },
        { method: 'DELETE', url: `/roles/${roleId}` },
        { method: 'POST', url: '/users', payload: { displayName: 'Denied User', roleIds: [roleId] } },
        { method: 'DELETE', url: `/users/${readOnlyUserId}` },
      ];
      for (const request of adminOnlyRequests) {
        const response = await app.inject({
          method: request.method,
          url: request.url,
          headers: authHeaders(readOnlyUserId),
          ...(request.payload !== undefined ? { payload: request.payload } : {}),
        });
        expect(response.statusCode).toBe(403);
        expect(errorSchema.parse(response.json()).code).toBe('AUTH_FORBIDDEN');
      }
    } finally {
      await app.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('keeps pagination deterministic, finalized numbers immutable, and rejected auth attempts side-effect free', async () => {
    const { dir, dbPath } = createTempDbPath('ai-business-os-slice46-regression-');
    const bootstrap = await buildApp({ dbPath, authBypassForTesting: true });

    let adminUserId = '';
    let readOnlyUserId = '';
    let customerId = '';
    let invoiceId = '';
    let supplierId = '';
    let purchaseOrderId = '';
    let supplierBillId = '';
    try {
      const adminRole = idSchema.parse(
        (
          await bootstrap.inject({
            method: 'POST',
            url: '/roles',
            payload: { name: 'Slice46R Admin', canBeAssigned: true, canManageAssignments: true },
          })
        ).json(),
      );
      const readOnlyRole = idSchema.parse(
        (
          await bootstrap.inject({
            method: 'POST',
            url: '/roles',
            payload: { name: 'Slice46R ReadOnly', canBeAssigned: false, canManageAssignments: false },
          })
        ).json(),
      );
      adminUserId = idSchema.parse(
        (
          await bootstrap.inject({
            method: 'POST',
            url: '/users',
            payload: { displayName: 'Slice46R Admin User', roleIds: [adminRole.id] },
          })
        ).json(),
      ).id;
      readOnlyUserId = idSchema.parse(
        (
          await bootstrap.inject({
            method: 'POST',
            url: '/users',
            payload: { displayName: 'Slice46R Readonly User', roleIds: [readOnlyRole.id] },
          })
        ).json(),
      ).id;

      customerId = idSchema.parse(
        (
          await bootstrap.inject({
            method: 'POST',
            url: '/customers',
            payload: { displayName: 'Slice46R Customer' },
          })
        ).json(),
      ).id;
      supplierId = idSchema.parse(
        (
          await bootstrap.inject({
            method: 'POST',
            url: '/suppliers',
            payload: { displayName: 'Slice46R Supplier' },
          })
        ).json(),
      ).id;

      for (let index = 0; index < 16; index += 1) {
        const day = String((index % 28) + 1).padStart(2, '0');
        const createdInvoice = idSchema.parse(
          (
            await bootstrap.inject({
              method: 'POST',
              url: '/invoices',
              payload: {
                customerId,
                title: `Slice46R Invoice ${index + 1}`,
                issueDate: `2026-07-${day}`,
                dueDate: `2026-08-${day}`,
                lineItems: [{ description: `Line ${index + 1}`, quantity: 1, unitPrice: 100 + index, gstApplicable: true }],
              },
            })
          ).json(),
        ).id;
        if (index === 0) {
          invoiceId = createdInvoice;
        }
        expect((await bootstrap.inject({ method: 'POST', url: `/invoices/${createdInvoice}/finalise` })).statusCode).toBe(200);
      }

      purchaseOrderId = idSchema.parse(
        (
          await bootstrap.inject({
            method: 'POST',
            url: '/purchase-orders',
            payload: {
              supplierId,
              issueDate: '2026-07-10',
              expectedDeliveryDate: '2026-07-20',
              supplierReference: 'SL46R-PO',
              currency: 'AUD',
              lineItems: [{ description: 'PO line', quantity: 2, unitPrice: 75, gstApplicable: true }],
            },
          })
        ).json(),
      ).id;
      expect((await bootstrap.inject({ method: 'POST', url: `/purchase-orders/${purchaseOrderId}/approve` })).statusCode).toBe(
        200,
      );
      supplierBillId = idSchema.parse(
        (
          await bootstrap.inject({
            method: 'POST',
            url: `/purchase-orders/${purchaseOrderId}/create-supplier-bill`,
            payload: {},
          })
        ).json(),
      ).id;
      expect((await bootstrap.inject({ method: 'POST', url: `/supplier-bills/${supplierBillId}/finalise` })).statusCode).toBe(
        200,
      );
    } finally {
      await bootstrap.close();
    }

    const app = await buildApp({ dbPath, authBypassForTesting: false });
    try {
      const paymentsPageA = await app.inject({
        method: 'GET',
        url: '/payments?limit=10&offset=0',
        headers: authHeaders(adminUserId),
      });
      const paymentsPageB = await app.inject({
        method: 'GET',
        url: '/payments?limit=10&offset=0',
        headers: authHeaders(adminUserId),
      });
      expect(paymentsPageA.statusCode).toBe(200);
      expect(paymentsPageB.statusCode).toBe(200);
      expect(paymentsPageA.json()).toEqual(paymentsPageB.json());

      const reportA = await app.inject({
        method: 'GET',
        url: '/reports/read-model?from=2026-07-01&to=2026-08-31&limit=50&offset=0',
        headers: authHeaders(adminUserId),
      });
      const reportB = await app.inject({
        method: 'GET',
        url: '/reports/read-model?from=2026-07-01&to=2026-08-31&limit=50&offset=0',
        headers: authHeaders(adminUserId),
      });
      expect(reportA.statusCode).toBe(200);
      expect(reportB.statusCode).toBe(200);
      expect(reportA.json()).toEqual(reportB.json());

      const timelineA = await app.inject({
        method: 'GET',
        url: `/timeline/invoice/${invoiceId}?limit=50&offset=0`,
        headers: authHeaders(adminUserId),
      });
      const timelineB = await app.inject({
        method: 'GET',
        url: `/timeline/invoice/${invoiceId}?limit=50&offset=0`,
        headers: authHeaders(adminUserId),
      });
      expect(timelineA.statusCode).toBe(200);
      expect(timelineB.statusCode).toBe(200);
      expect(timelineA.json()).toEqual(timelineB.json());

      const invoiceBefore = invoiceReadSchema.parse(
        (
          await app.inject({
            method: 'GET',
            url: `/invoices/${invoiceId}`,
            headers: authHeaders(adminUserId),
          })
        ).json(),
      );
      const invoiceUpdateRejected = await app.inject({
        method: 'PUT',
        url: `/invoices/${invoiceId}`,
        headers: authHeaders(adminUserId),
        payload: {
          title: 'Rejected Finalised Edit',
          issueDate: '2026-07-10',
          dueDate: '2026-08-10',
          paymentState: 'Draft',
          lineItems: [{ description: 'Rejected', quantity: 1, unitPrice: 90, gstApplicable: true }],
        },
      });
      expect(invoiceUpdateRejected.statusCode).toBe(409);
      const invoiceAfter = invoiceReadSchema.parse(
        (
          await app.inject({
            method: 'GET',
            url: `/invoices/${invoiceId}`,
            headers: authHeaders(adminUserId),
          })
        ).json(),
      );
      expect(invoiceAfter.invoiceNumber).toBe(invoiceBefore.invoiceNumber);

      const supplierBillBefore = supplierBillReadSchema.parse(
        (
          await app.inject({
            method: 'GET',
            url: `/supplier-bills/${supplierBillId}`,
            headers: authHeaders(adminUserId),
          })
        ).json(),
      );
      const supplierBillRejected = await app.inject({
        method: 'PUT',
        url: `/supplier-bills/${supplierBillId}`,
        headers: authHeaders(adminUserId),
        payload: {
          billDate: '2026-07-12',
          dueDate: '2026-07-20',
          supplierReference: 'SL46R-PO',
          currency: 'AUD',
          notes: 'Rejected Finalised Bill Edit',
          lineItems: [{ description: 'Rejected Supplier Bill Line', quantity: 1, unitPrice: 80, gstApplicable: true }],
        },
      });
      expect(supplierBillRejected.statusCode).toBe(409);
      const supplierBillAfter = supplierBillReadSchema.parse(
        (
          await app.inject({
            method: 'GET',
            url: `/supplier-bills/${supplierBillId}`,
            headers: authHeaders(adminUserId),
          })
        ).json(),
      );
      expect(supplierBillAfter.billNumber).toBe(supplierBillBefore.billNumber);

      const purchaseOrderBefore = purchaseOrderReadSchema.parse(
        (
          await app.inject({
            method: 'GET',
            url: `/purchase-orders/${purchaseOrderId}`,
            headers: authHeaders(adminUserId),
          })
        ).json(),
      );
      const purchaseOrderRejected = await app.inject({
        method: 'PUT',
        url: `/purchase-orders/${purchaseOrderId}`,
        headers: authHeaders(adminUserId),
        payload: {
          issueDate: '2026-07-10',
          expectedDeliveryDate: '2026-07-20',
          supplierReference: 'Rejected Update',
          currency: 'AUD',
          lineItems: [{ description: 'Rejected PO line', quantity: 1, unitPrice: 75, gstApplicable: true }],
        },
      });
      expect(purchaseOrderRejected.statusCode).toBe(409);
      const purchaseOrderAfter = purchaseOrderReadSchema.parse(
        (
          await app.inject({
            method: 'GET',
            url: `/purchase-orders/${purchaseOrderId}`,
            headers: authHeaders(adminUserId),
          })
        ).json(),
      );
      expect(purchaseOrderAfter.purchaseOrderNumber).toBe(purchaseOrderBefore.purchaseOrderNumber);

      const beforeUnauthorized = backupSchema.parse(
        (
          await app.inject({
            method: 'GET',
            url: '/platform/backup',
            headers: authHeaders(adminUserId),
          })
        ).json(),
      ).snapshot.entities;

      const rejectedActions = await Promise.all([
        app.inject({
          method: 'POST',
          url: '/customers',
          headers: authHeaders(readOnlyUserId),
          payload: { displayName: 'Denied Mutation 1' },
        }),
        app.inject({
          method: 'PUT',
          url: `/invoices/${invoiceId}`,
          headers: authHeaders(readOnlyUserId),
          payload: {
            title: 'Denied Mutation 2',
            issueDate: '2026-07-10',
            dueDate: '2026-08-10',
            lineItems: [{ description: 'Denied', quantity: 1, unitPrice: 10, gstApplicable: true }],
          },
        }),
        app.inject({
          method: 'GET',
          url: '/health/diagnostics',
          headers: authHeaders(readOnlyUserId),
        }),
      ]);
      rejectedActions.forEach((response) => expect([403].includes(response.statusCode)).toBe(true));

      const afterUnauthorized = backupSchema.parse(
        (
          await app.inject({
            method: 'GET',
            url: '/platform/backup',
            headers: authHeaders(adminUserId),
          })
        ).json(),
      ).snapshot.entities;

      expect(afterUnauthorized.customers ?? []).toHaveLength((beforeUnauthorized.customers ?? []).length);
      expect(afterUnauthorized.timeline_events ?? []).toHaveLength((beforeUnauthorized.timeline_events ?? []).length);

      const pdfEndpoints = [
        `/invoices/${invoiceId}/pdf`,
        `/supplier-bills/${supplierBillId}/pdf`,
        `/purchase-orders/${purchaseOrderId}/pdf`,
      ];
      for (const endpoint of pdfEndpoints) {
        const response = await app.inject({
          method: 'GET',
          url: endpoint,
          headers: authHeaders(adminUserId),
        });
        expect(response.statusCode).toBe(200);
        expect(response.headers['content-type']).toContain('application/pdf');
      }
    } finally {
      await app.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
