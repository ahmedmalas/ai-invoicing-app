import { describe, expect, it } from 'vitest';

import {
  computeSuggestedReorderQuantity,
  evaluateStockIntelligence,
  profitMarginPercent,
} from '../../src/domain/inventory/stock-intelligence.js';
import { renderBarcodeSvg, renderQrSvg } from '../../src/domain/inventory/barcode.js';
import type { Product } from '../../src/domain/inventory/types.js';

function product(overrides: Partial<Product> = {}): Product {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    sku: 'SKU-1',
    barcode: '123',
    qrPayload: 'aleya:product:SKU-1',
    name: 'Filter',
    description: null,
    category: 'Parts',
    brand: null,
    supplierId: null,
    unitOfMeasure: 'ea',
    costPrice: 10,
    sellPrice: 20,
    gstStatus: 'gst',
    profitMargin: 50,
    trackStock: true,
    minimumStockLevel: 5,
    reorderQuantity: 10,
    storageLocation: null,
    weight: null,
    lengthMm: null,
    widthMm: null,
    heightMm: null,
    imageUrl: null,
    notes: null,
    isActive: true,
    isBundle: false,
    bundleKind: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('inventory stock intelligence', () => {
  it('flags out of stock and suggests reorder quantity', () => {
    const findings = evaluateStockIntelligence({
      product: product(),
      stock: {
        onHand: 0,
        available: 0,
        reserved: 0,
        incoming: 0,
        damaged: 0,
        returned: 0,
      },
      lastMovementAt: '2026-07-01T00:00:00.000Z',
      unitsSoldLast90Days: 3,
      now: new Date('2026-07-18T00:00:00.000Z'),
    });
    expect(findings.some((finding) => finding.kind === 'out_of_stock')).toBe(true);
    expect(computeSuggestedReorderQuantity(
      { onHand: 0, available: 0, reserved: 0, incoming: 0, damaged: 0, returned: 0 },
      5,
      10,
    )).toBe(10);
  });

  it('flags dead stock after long inactivity', () => {
    const findings = evaluateStockIntelligence({
      product: product(),
      stock: {
        onHand: 12,
        available: 12,
        reserved: 0,
        incoming: 0,
        damaged: 0,
        returned: 0,
      },
      lastMovementAt: '2025-01-01T00:00:00.000Z',
      unitsSoldLast90Days: 0,
      now: new Date('2026-07-18T00:00:00.000Z'),
    });
    expect(findings.some((finding) => finding.kind === 'dead_stock')).toBe(true);
  });

  it('computes profit margin and barcode/qr svg payloads', () => {
    expect(profitMarginPercent(10, 25)).toBe(60);
    expect(renderBarcodeSvg('ABC-1')).toContain('<svg');
    expect(renderQrSvg('aleya:product:SKU-1')).toContain('aleya:product:SKU-1');
  });
});
