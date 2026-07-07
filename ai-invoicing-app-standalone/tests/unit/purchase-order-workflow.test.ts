import { describe, expect, it } from 'vitest';

import { assertValidPurchaseOrderStatusTransitionOrThrow } from '../../src/domain/purchase-orders/workflow.js';

describe('purchase order workflow', () => {
  it('allows valid purchase order status transitions', () => {
    expect(() => assertValidPurchaseOrderStatusTransitionOrThrow('Draft', 'Approved')).not.toThrow();
    expect(() => assertValidPurchaseOrderStatusTransitionOrThrow('Draft', 'Cancelled')).not.toThrow();
    expect(() => assertValidPurchaseOrderStatusTransitionOrThrow('Approved', 'Closed')).not.toThrow();
    expect(() => assertValidPurchaseOrderStatusTransitionOrThrow('Approved', 'Cancelled')).not.toThrow();
  });

  it('rejects invalid purchase order status transitions', () => {
    expect(() => assertValidPurchaseOrderStatusTransitionOrThrow('Cancelled', 'Approved')).toThrow(
      'INVALID_PURCHASE_ORDER_STATUS_TRANSITION',
    );
    expect(() => assertValidPurchaseOrderStatusTransitionOrThrow('Closed', 'Approved')).toThrow(
      'INVALID_PURCHASE_ORDER_STATUS_TRANSITION',
    );
  });
});
