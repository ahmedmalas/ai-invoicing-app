import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { buildApp } from '../../src/app.js';

const dirs: string[] = [];

function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ai-recon-'));
  dirs.push(dir);
  return join(dir, 'test.sqlite');
}

afterEach(() => {
  while (dirs.length) {
    const dir = dirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('bank reconciliation integration', () => {
  it('imports CSV, auto-matches high confidence, and records audit', async () => {
    const app = await buildApp({
      dbPath: tempDbPath(),
      authBypassForTesting: true,
      serveFrontend: false,
    });

    try {
      const customer = await app.inject({
        method: 'POST',
        url: '/api/customers',
        payload: { displayName: 'Acme Plumbing', email: 'acme@example.com' },
      });
      expect(customer.statusCode).toBe(201);
      const customerId = customer.json().id as string;

      const draft = await app.inject({
        method: 'POST',
        url: '/api/invoices',
        payload: {
          customerId,
          title: 'Service call',
          issueDate: '2026-07-01',
          dueDate: '2026-07-15',
          lineItems: [
            { description: 'Labour', quantity: 1, unitPrice: 150, gstApplicable: false },
          ],
        },
      });
      expect(draft.statusCode).toBe(201);
      const invoiceId = draft.json().id as string;

      const finalised = await app.inject({
        method: 'POST',
        url: `/api/invoices/${invoiceId}/finalise`,
      });
      expect(finalised.statusCode).toBe(200);
      const invoiceNumber = finalised.json().invoiceNumber as string;

      const account = await app.inject({
        method: 'POST',
        url: '/api/reconciliation/accounts',
        payload: {
          nickname: 'Business Cheque',
          accountType: 'business_cheque',
          institution: 'CBA',
          accountNumberMasked: '•••• 9999',
          bsbMasked: '062-000',
          currency: 'AUD',
          source: 'manual',
        },
      });
      expect(account.statusCode).toBe(201);
      const bankAccountId = account.json().id as string;

      const csv = [
        'Date,Amount,Description,Reference,Name,Balance',
        `18/07/2026,150.00,Payment ${invoiceNumber},${invoiceNumber},Acme Plumbing,1500.00`,
      ].join('\n');
      const contentBase64 = Buffer.from(csv, 'utf8').toString('base64');

      const imported = await app.inject({
        method: 'POST',
        url: '/api/reconciliation/import',
        payload: {
          bankAccountId,
          format: 'csv',
          filename: 'july.csv',
          contentBase64,
          autoMatch: true,
        },
      });
      expect(imported.statusCode).toBe(201);
      const importBody = imported.json();
      expect(importBody.imported).toBe(1);
      expect(importBody.duplicates).toBe(0);
      expect(importBody.autoMatched).toBe(1);

      const duplicate = await app.inject({
        method: 'POST',
        url: '/api/reconciliation/import',
        payload: {
          bankAccountId,
          format: 'csv',
          filename: 'july-again.csv',
          contentBase64,
          autoMatch: true,
        },
      });
      expect(duplicate.statusCode).toBe(201);
      expect(duplicate.json().imported).toBe(0);
      expect(duplicate.json().duplicates).toBe(1);

      const invoiceAfter = await app.inject({
        method: 'GET',
        url: `/api/invoices/${invoiceId}`,
      });
      expect(invoiceAfter.json().paymentState).toBe('Paid');

      const workspace = await app.inject({
        method: 'GET',
        url: '/api/reconciliation/workspace',
      });
      expect(workspace.statusCode).toBe(200);
      expect(workspace.json().summary.matched).toBeGreaterThanOrEqual(1);

      const audit = await app.inject({
        method: 'GET',
        url: '/api/reconciliation/audit',
      });
      expect(audit.statusCode).toBe(200);
      const actions = (audit.json().audit as Array<{ action: string }>).map((row) => row.action);
      expect(actions).toContain('import');
      expect(actions).toContain('auto_match');

      const report = await app.inject({
        method: 'GET',
        url: '/api/reconciliation/reports',
      });
      expect(report.statusCode).toBe(200);
      expect(report.json().cashReceived.total).toBeGreaterThanOrEqual(150);
    } finally {
      await app.close();
    }
  });

  it('supports medium-confidence approval and ignore flows', async () => {
    const app = await buildApp({
      dbPath: tempDbPath(),
      authBypassForTesting: true,
      serveFrontend: false,
    });

    try {
      const customer = await app.inject({
        method: 'POST',
        url: '/api/customers',
        payload: { displayName: 'Riverstone Homes' },
      });
      const customerId = customer.json().id as string;

      const draft = await app.inject({
        method: 'POST',
        url: '/api/invoices',
        payload: {
          customerId,
          title: 'Deposit',
          issueDate: '2026-07-01',
          dueDate: '2026-07-20',
          lineItems: [
            { description: 'Deposit', quantity: 1, unitPrice: 400, gstApplicable: false },
          ],
        },
      });
      const invoiceId = draft.json().id as string;
      await app.inject({ method: 'POST', url: `/api/invoices/${invoiceId}/finalise` });

      const account = await app.inject({
        method: 'POST',
        url: '/api/reconciliation/accounts',
        payload: {
          nickname: 'Trust',
          accountType: 'trust',
          currency: 'AUD',
          source: 'manual',
        },
      });
      const bankAccountId = account.json().id as string;

      // Name + exact amount, no invoice number => medium confidence suggestion
      const csv = [
        'Date,Amount,Description,Reference,Name',
        '18/07/2026,400.00,Transfer,EFT,Riverstone Homes',
        '18/07/2026,12.00,Unknown credit,XYZ,Random Payee',
      ].join('\n');

      const imported = await app.inject({
        method: 'POST',
        url: '/api/reconciliation/import',
        payload: {
          bankAccountId,
          format: 'csv',
          filename: 'medium.csv',
          contentBase64: Buffer.from(csv, 'utf8').toString('base64'),
          autoMatch: true,
        },
      });
      expect(imported.statusCode).toBe(201);
      expect(imported.json().suggested).toBeGreaterThanOrEqual(1);

      const matches = await app.inject({
        method: 'GET',
        url: '/api/reconciliation/matches?status=suggested',
      });
      const suggested = matches.json().matches as Array<{ id: string }>;
      expect(suggested.length).toBeGreaterThanOrEqual(1);

      const approved = await app.inject({
        method: 'POST',
        url: `/api/reconciliation/matches/${suggested[0]!.id}/approve`,
        payload: {},
      });
      expect(approved.statusCode).toBe(200);
      expect(approved.json().payment.amount).toBe(400);

      const txns = await app.inject({
        method: 'GET',
        url: '/api/reconciliation/transactions?status=unmatched',
      });
      const unmatched = txns.json().transactions as Array<{ id: string; amount: number }>;
      const noise = unmatched.find((txn) => txn.amount === 12);
      expect(noise).toBeTruthy();

      const ignored = await app.inject({
        method: 'POST',
        url: '/api/reconciliation/transactions/ignore',
        payload: { transactionIds: [noise!.id] },
      });
      expect(ignored.statusCode).toBe(200);
      expect(ignored.json().ignored).toBe(1);
    } finally {
      await app.close();
    }
  });
});
