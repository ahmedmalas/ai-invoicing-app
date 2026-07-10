import type { PurchaseOrderStatus } from '../../types/entities.js';

const ALLOWED_TRANSITIONS: Record<PurchaseOrderStatus, PurchaseOrderStatus[]> = {
  Draft: ['Approved', 'Cancelled'],
  Approved: ['Closed', 'Cancelled'],
  Closed: [],
  Cancelled: [],
};

export function assertValidPurchaseOrderStatusTransitionOrThrow(
  currentStatus: PurchaseOrderStatus,
  nextStatus: PurchaseOrderStatus,
): void {
  if (currentStatus === nextStatus) {
    return;
  }
  if (!ALLOWED_TRANSITIONS[currentStatus].includes(nextStatus)) {
    throw new Error('INVALID_PURCHASE_ORDER_STATUS_TRANSITION');
  }
}
