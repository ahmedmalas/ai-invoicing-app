import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { z } from 'zod';

import { buildApp } from '../../src/app.js';

interface BenchResult {
  name: string;
  samples: number;
  avgMs: number;
  minMs: number;
  maxMs: number;
  p95Ms: number;
  p99Ms: number;
}

const idSchema = z.object({ id: z.string().uuid() });

function quantile(values: number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[index] ?? 0;
}

function summarize(name: string, samples: number[]): BenchResult {
  const total = samples.reduce((accumulator, current) => accumulator + current, 0);
  return {
    name,
    samples: samples.length,
    avgMs: Number((total / samples.length).toFixed(3)),
    minMs: Number(Math.min(...samples).toFixed(3)),
    maxMs: Number(Math.max(...samples).toFixed(3)),
    p95Ms: Number(quantile(samples, 0.95).toFixed(3)),
    p99Ms: Number(quantile(samples, 0.99).toFixed(3)),
  };
}

async function benchmark(): Promise<void> {
  const tempDir = mkdtempSync(join(tmpdir(), 'ai-business-os-slice45-bench-'));
  const dbPath = join(tempDir, 'benchmark.sqlite');
  const app = await buildApp({ dbPath, authBypassForTesting: true });

  try {
    const customer = idSchema.parse(
      (
        await app.inject({
          method: 'POST',
          url: '/customers',
          payload: { displayName: 'Slice45 Bench Customer' },
        })
      ).json(),
    );
    const supplier = idSchema.parse(
      (
        await app.inject({
          method: 'POST',
          url: '/suppliers',
          payload: { displayName: 'Slice45 Bench Supplier' },
        })
      ).json(),
    );

    const seededInvoiceIds: string[] = [];
    for (let index = 0; index < 220; index += 1) {
      const day = String((index % 28) + 1).padStart(2, '0');
      const invoice = idSchema.parse(
        (
          await app.inject({
            method: 'POST',
            url: '/invoices',
            payload: {
              customerId: customer.id,
              title: `Slice45 Bench Invoice ${index + 1}`,
              issueDate: `2026-06-${day}`,
              dueDate: `2026-07-${day}`,
              lineItems: [{ description: `Bench ${index + 1}`, quantity: 1, unitPrice: 100 + index, gstApplicable: true }],
            },
          })
        ).json(),
      );
      seededInvoiceIds.push(invoice.id);
      await app.inject({ method: 'POST', url: `/invoices/${invoice.id}/finalise` });
      await app.inject({
        method: 'POST',
        url: '/payments',
        payload: {
          customerId: customer.id,
          paymentDate: `2026-06-${day}`,
          paymentMethod: 'Bank Transfer',
          reference: `SL45-BENCH-PAY-${index + 1}`,
          amount: 22,
          allocations: [{ invoiceId: invoice.id, amount: 22 }],
        },
      });
    }

    for (let index = 0; index < 140; index += 1) {
      const day = String((index % 28) + 1).padStart(2, '0');
      const po = idSchema.parse(
        (
          await app.inject({
            method: 'POST',
            url: '/purchase-orders',
            payload: {
              supplierId: supplier.id,
              issueDate: `2026-06-${day}`,
              expectedDeliveryDate: `2026-07-${day}`,
              supplierReference: `SL45-BENCH-PO-${index + 1}`,
              currency: 'AUD',
              lineItems: [{ description: `PO ${index + 1}`, quantity: 1, unitPrice: 70 + index, gstApplicable: true }],
            },
          })
        ).json(),
      );
      await app.inject({ method: 'POST', url: `/purchase-orders/${po.id}/approve` });
      const bill = idSchema.parse(
        (
          await app.inject({
            method: 'POST',
            url: `/purchase-orders/${po.id}/create-supplier-bill`,
            payload: {},
          })
        ).json(),
      );
      await app.inject({ method: 'POST', url: `/supplier-bills/${bill.id}/finalise` });
      await app.inject({
        method: 'POST',
        url: '/supplier-payments',
        payload: {
          supplierId: supplier.id,
          paymentDate: `2026-06-${day}`,
          paymentMethod: 'Bank Transfer',
          reference: `SL45-BENCH-SPAY-${index + 1}`,
          amount: 18,
          allocations: [{ supplierBillId: bill.id, amount: 18 }],
        },
      });
    }

    const measure = async (
      name: string,
      run: () => Promise<void>,
      iterations: number,
    ): Promise<BenchResult> => {
      const samples: number[] = [];
      for (let index = 0; index < iterations; index += 1) {
        const start = performance.now();
        await run();
        samples.push(performance.now() - start);
      }
      return summarize(name, samples);
    };

    const benchmarks: BenchResult[] = [];
    benchmarks.push(
      await measure(
        'reports_read_model',
        async () => {
          const response = await app.inject({
            method: 'GET',
            url: '/reports/read-model?from=2026-06-01&to=2026-08-31&limit=50&offset=0',
          });
          if (response.statusCode !== 200) {
            throw new Error(`reports_read_model failed: ${response.statusCode}`);
          }
        },
        30,
      ),
    );
    benchmarks.push(
      await measure(
        'search_global',
        async () => {
          const response = await app.inject({
            method: 'GET',
            url: '/search?q=slice45 bench&limit=100&offset=0',
          });
          if (response.statusCode !== 200) {
            throw new Error(`search_global failed: ${response.statusCode}`);
          }
        },
        30,
      ),
    );
    benchmarks.push(
      await measure(
        'payments_list_pagination',
        async () => {
          const response = await app.inject({
            method: 'GET',
            url: '/payments?from=2026-06-01&to=2026-06-28&limit=25&offset=50',
          });
          if (response.statusCode !== 200) {
            throw new Error(`payments_list_pagination failed: ${response.statusCode}`);
          }
        },
        30,
      ),
    );
    benchmarks.push(
      await measure(
        'timeline_lookup',
        async () => {
          const response = await app.inject({
            method: 'GET',
            url: `/timeline/invoice/${seededInvoiceIds[20]}?limit=100&offset=0`,
          });
          if (response.statusCode !== 200) {
            throw new Error(`timeline_lookup failed: ${response.statusCode}`);
          }
        },
        30,
      ),
    );

    benchmarks.push(
      await measure(
        'concurrent_read_during_write',
        async () => {
          const write = app.inject({
            method: 'POST',
            url: '/invoices',
            payload: {
              customerId: customer.id,
              title: 'Slice45 Bench Concurrent Mutation',
              issueDate: '2026-08-01',
              dueDate: '2026-08-14',
              lineItems: [{ description: 'Concurrent', quantity: 1, unitPrice: 60, gstApplicable: true }],
            },
          });
          const read = app.inject({
            method: 'GET',
            url: '/reports/read-model?from=2026-06-01&to=2026-08-31&limit=50&offset=0',
          });
          const [writeResponse, readResponse] = await Promise.all([write, read]);
          if (writeResponse.statusCode !== 201 || readResponse.statusCode !== 200) {
            throw new Error(
              `concurrent_read_during_write failed: write=${writeResponse.statusCode} read=${readResponse.statusCode}`,
            );
          }
        },
        20,
      ),
    );

    console.log(JSON.stringify({ slice: 45, generatedAt: new Date().toISOString(), benchmarks }, null, 2));
  } finally {
    await app.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
}

await benchmark();
