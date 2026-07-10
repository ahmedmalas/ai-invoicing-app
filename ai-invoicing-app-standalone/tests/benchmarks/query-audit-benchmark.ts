import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { z } from 'zod';

import { buildApp } from '../../src/app.js';

interface BenchResult {
  name: string;
  avgMs: number;
  minMs: number;
  maxMs: number;
}

const idSchema = z.object({ id: z.string().uuid() });

function stats(name: string, samples: number[]): BenchResult {
  const total = samples.reduce((sum, value) => sum + value, 0);
  return {
    name,
    avgMs: Number((total / samples.length).toFixed(3)),
    minMs: Number(Math.min(...samples).toFixed(3)),
    maxMs: Number(Math.max(...samples).toFixed(3)),
  };
}

async function runSlice41Benchmark(): Promise<void> {
  const tempDir = mkdtempSync(join(tmpdir(), 'ai-business-os-slice41-bench-'));
  const dbPath = join(tempDir, 'benchmark.sqlite');
  const app = await buildApp({ dbPath, authBypassForTesting: true });

  try {
    const customerRes = await app.inject({
      method: 'POST',
      url: '/customers',
      payload: { displayName: 'Benchmark Customer' },
    });
    const customer = idSchema.parse(customerRes.json());
    const supplierRes = await app.inject({
      method: 'POST',
      url: '/suppliers',
      payload: { displayName: 'Benchmark Supplier' },
    });
    const supplier = idSchema.parse(supplierRes.json());

    for (let index = 0; index < 120; index += 1) {
      const day = String((index % 28) + 1).padStart(2, '0');
      const invoiceRes = await app.inject({
        method: 'POST',
        url: '/invoices',
        payload: {
          customerId: customer.id,
          title: `Benchmark Invoice ${index}`,
          issueDate: `2026-07-${day}`,
          dueDate: `2026-08-${day}`,
          lineItems: [{ description: `Line ${index}`, quantity: 1, unitPrice: 100 + index, gstApplicable: true }],
        },
      });
      const invoice = idSchema.parse(invoiceRes.json());
      await app.inject({ method: 'POST', url: `/invoices/${invoice.id}/finalise` });

      if (index % 4 === 0) {
        await app.inject({
          method: 'POST',
          url: '/credit-notes',
          payload: {
            linkedInvoiceId: invoice.id,
            issueDate: `2026-07-${day}`,
            reason: `Bench credit ${index}`,
            type: 'Partial',
            lineItems: [{ description: 'Credit', amount: 12 }],
          },
        });
      }

      if (index % 3 === 0) {
        await app.inject({
          method: 'POST',
          url: '/payments',
          payload: {
            customerId: customer.id,
            paymentDate: `2026-07-${day}`,
            paymentMethod: 'Bank Transfer',
            reference: `BENCH-PAY-${index}`,
            amount: 30,
            allocations: [{ invoiceId: invoice.id, amount: 30 }],
          },
        });
      }
    }

    for (let index = 0; index < 90; index += 1) {
      const day = String((index % 28) + 1).padStart(2, '0');
      const poRes = await app.inject({
        method: 'POST',
        url: '/purchase-orders',
        payload: {
          supplierId: supplier.id,
          issueDate: `2026-07-${day}`,
          expectedDeliveryDate: `2026-08-${day}`,
          supplierReference: `BENCH-PO-${index}`,
          currency: 'AUD',
          lineItems: [{ description: `PO ${index}`, quantity: 1, unitPrice: 80 + index, gstApplicable: true }],
        },
      });
      const po = idSchema.parse(poRes.json());
      await app.inject({ method: 'POST', url: `/purchase-orders/${po.id}/approve` });
      const billRes = await app.inject({
        method: 'POST',
        url: `/purchase-orders/${po.id}/create-supplier-bill`,
        payload: {},
      });
      const bill = idSchema.parse(billRes.json());
      await app.inject({ method: 'POST', url: `/supplier-bills/${bill.id}/finalise` });

      if (index % 2 === 0) {
        await app.inject({
          method: 'POST',
          url: '/supplier-payments',
          payload: {
            supplierId: supplier.id,
            paymentDate: `2026-07-${day}`,
            paymentMethod: 'Bank Transfer',
            reference: `BENCH-SPAY-${index}`,
            amount: 25,
            allocations: [{ supplierBillId: bill.id, amount: 25 }],
          },
        });
      }
    }

    const bench = async (name: string, url: string, iterations = 15): Promise<BenchResult> => {
      const samples: number[] = [];
      for (let i = 0; i < iterations; i += 1) {
        const start = performance.now();
        const response = await app.inject({ method: 'GET', url });
        if (response.statusCode !== 200) {
          throw new Error(`${name} failed with status ${response.statusCode}`);
        }
        samples.push(performance.now() - start);
      }
      return stats(name, samples);
    };

    const results: BenchResult[] = [];
    results.push(
      await bench('reports_read_model', '/reports/read-model?from=2026-07-01&to=2026-08-31&limit=25&offset=0'),
    );
    results.push(await bench('search_global', '/search?q=bench&limit=25&offset=0'));
    results.push(await bench('payments_list', '/payments?limit=25&offset=0'));
    results.push(await bench('supplier_payments_list', '/supplier-payments?limit=25&offset=0'));
    results.push(await bench('purchase_orders_list', '/purchase-orders?limit=25&offset=0'));
    results.push(await bench('supplier_bills_list', '/supplier-bills?limit=25&offset=0'));

    console.log(JSON.stringify(results, null, 2));
  } finally {
    await app.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
}

await runSlice41Benchmark();
