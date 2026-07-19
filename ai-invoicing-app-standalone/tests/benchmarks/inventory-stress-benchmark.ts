/**
 * Inventory catalogue / movement / scan stress benchmark.
 *
 * Run:
 *   npx tsx tests/benchmarks/inventory-stress-benchmark.ts
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { randomUUID } from 'node:crypto';

import { z } from 'zod';

import { buildApp } from '../../src/app.js';

const idSchema = z.object({ id: z.string().uuid() });

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index]!;
}

async function timeMs(work: () => Promise<unknown>): Promise<number> {
  const start = performance.now();
  await work();
  return performance.now() - start;
}

async function main(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'inventory-bench-'));
  const dbPath = join(dir, 'bench.db');
  const app = await buildApp({
    dbPath,
    authBypassForTesting: true,
    enableStructuredLogging: false,
    logLevel: 'error',
  });

  try {
    const supplier = idSchema.parse(
      (
        await app.inject({
          method: 'POST',
          url: '/suppliers',
          payload: { displayName: 'Bench Supplier', email: 'bench-supplier@example.test' },
        })
      ).json(),
    );

    const productIds: string[] = [];
    const seedStart = performance.now();
    for (let i = 0; i < 400; i += 1) {
      const created = idSchema.parse(
        (
          await app.inject({
            method: 'POST',
            url: '/products',
            payload: {
              sku: `BENCH-${String(i).padStart(4, '0')}`,
              barcode: `9400${String(i).padStart(9, '0')}`,
              name: `Bench Product ${i}`,
              category: i % 2 === 0 ? 'Filters' : 'Hardware',
              costPrice: 5 + (i % 7),
              sellPrice: 12 + (i % 11),
              openingStock: 50 + (i % 20),
              trackStock: true,
              minimumStockLevel: 5,
              reorderQuantity: 15,
              supplierId: supplier.id,
            },
          })
        ).json(),
      );
      productIds.push(created.id);
    }
    const seedMs = performance.now() - seedStart;

    const movementLatencies: number[] = [];
    for (let i = 0; i < 300; i += 1) {
      const productId = productIds[i % productIds.length]!;
      movementLatencies.push(
        await timeMs(() =>
          app.inject({
            method: 'POST',
            url: '/inventory/adjust',
            payload: {
              productId,
              quantityDelta: i % 2 === 0 ? -1 : 1,
              referenceType: 'manual',
              referenceId: randomUUID(),
            },
          }),
        ),
      );
    }

    const scanLatencies: number[] = [];
    for (let i = 0; i < 200; i += 1) {
      const code = `9400${String(i % 400).padStart(9, '0')}`;
      scanLatencies.push(
        await timeMs(() => app.inject({ method: 'GET', url: `/products/lookup?code=${code}` })),
      );
    }

    const listLatencies: number[] = [];
    for (let i = 0; i < 40; i += 1) {
      listLatencies.push(
        await timeMs(() =>
          app.inject({ method: 'GET', url: '/products?limit=50&offset=0&q=Bench' }),
        ),
      );
    }

    const reportLatencies: number[] = [];
    for (let i = 0; i < 20; i += 1) {
      reportLatencies.push(
        await timeMs(() => app.inject({ method: 'GET', url: '/inventory/reports' })),
      );
    }

    const concurrentStart = performance.now();
    await Promise.all(
      Array.from({ length: 40 }, (_, index) =>
        app.inject({
          method: 'POST',
          url: '/inventory/adjust',
          payload: {
            productId: productIds[index % 10]!,
            quantityDelta: -1,
            referenceType: 'manual',
            referenceId: randomUUID(),
          },
        }),
      ),
    );
    const concurrentMs = performance.now() - concurrentStart;

    const summarize = (label: string, values: number[]) => {
      const sorted = [...values].sort((a, b) => a - b);
      const avg = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
      return {
        label,
        samples: sorted.length,
        avgMs: Number(avg.toFixed(2)),
        p95Ms: Number(percentile(sorted, 95).toFixed(2)),
        p99Ms: Number(percentile(sorted, 99).toFixed(2)),
        maxMs: Number((sorted[sorted.length - 1] ?? 0).toFixed(2)),
      };
    };

    const report = {
      seedProducts: 400,
      seedMs: Number(seedMs.toFixed(2)),
      concurrentAdjust40Ms: Number(concurrentMs.toFixed(2)),
      metrics: [
        summarize('adjust', movementLatencies),
        summarize('barcode_lookup', scanLatencies),
        summarize('product_list', listLatencies),
        summarize('inventory_reports', reportLatencies),
      ],
    };
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

await main();
