import { describe, expect, it } from 'vitest';

import {
  assertValidTimelineEventOrThrow,
  isValidTimelineEventKey,
} from '../../src/domain/timeline/taxonomy.js';

describe('timeline taxonomy validator', () => {
  it('accepts canonical event keys at version 1', () => {
    expect(isValidTimelineEventKey('invoice.finalised')).toBe(true);
    expect(isValidTimelineEventKey('credit_note.created')).toBe(true);
    expect(isValidTimelineEventKey('payment.created')).toBe(true);
    expect(isValidTimelineEventKey('payment.allocated')).toBe(true);
    expect(isValidTimelineEventKey('supplier_bill.created')).toBe(true);
    expect(isValidTimelineEventKey('supplier_bill.finalised')).toBe(true);
    expect(isValidTimelineEventKey('supplier_payment.created')).toBe(true);
    expect(isValidTimelineEventKey('supplier_payment.allocated')).toBe(true);
    expect(isValidTimelineEventKey('purchase_order.created')).toBe(true);
    expect(isValidTimelineEventKey('purchase_order.approved')).toBe(true);
    expect(isValidTimelineEventKey('purchase_order.closed')).toBe(true);
    expect(isValidTimelineEventKey('purchase_order.cancelled')).toBe(true);
    expect(isValidTimelineEventKey('purchase_order.partially_billed')).toBe(true);
    expect(isValidTimelineEventKey('purchase_order.fully_billed')).toBe(true);
    expect(isValidTimelineEventKey('supplier_bill.created_from_purchase_order')).toBe(true);
    expect(isValidTimelineEventKey('job.created')).toBe(true);
    expect(isValidTimelineEventKey('job.document_linked')).toBe(true);
    expect(isValidTimelineEventKey('document.linked_to_job')).toBe(true);
    expect(isValidTimelineEventKey('job.scheduled')).toBe(true);
    expect(isValidTimelineEventKey('job.assignment_updated')).toBe(true);
    expect(isValidTimelineEventKey('job.status_changed')).toBe(true);
    expect(isValidTimelineEventKey('team.created')).toBe(true);
    expect(isValidTimelineEventKey('team.member_added')).toBe(true);
    expect(isValidTimelineEventKey('team.member_removed')).toBe(true);
    expect(isValidTimelineEventKey('team.deleted')).toBe(true);
    expect(isValidTimelineEventKey('job.assignment_scope_set')).toBe(true);
    expect(() => assertValidTimelineEventOrThrow('invoice.finalised', 1)).not.toThrow();
    expect(() => assertValidTimelineEventOrThrow('credit_note.created', 1)).not.toThrow();
    expect(() => assertValidTimelineEventOrThrow('payment.created', 1)).not.toThrow();
    expect(() => assertValidTimelineEventOrThrow('payment.allocated', 1)).not.toThrow();
    expect(() => assertValidTimelineEventOrThrow('supplier_bill.created', 1)).not.toThrow();
    expect(() => assertValidTimelineEventOrThrow('supplier_bill.finalised', 1)).not.toThrow();
    expect(() => assertValidTimelineEventOrThrow('supplier_payment.created', 1)).not.toThrow();
    expect(() => assertValidTimelineEventOrThrow('supplier_payment.allocated', 1)).not.toThrow();
    expect(() => assertValidTimelineEventOrThrow('purchase_order.created', 1)).not.toThrow();
    expect(() => assertValidTimelineEventOrThrow('purchase_order.approved', 1)).not.toThrow();
    expect(() => assertValidTimelineEventOrThrow('purchase_order.closed', 1)).not.toThrow();
    expect(() => assertValidTimelineEventOrThrow('purchase_order.cancelled', 1)).not.toThrow();
    expect(() => assertValidTimelineEventOrThrow('purchase_order.partially_billed', 1)).not.toThrow();
    expect(() => assertValidTimelineEventOrThrow('purchase_order.fully_billed', 1)).not.toThrow();
    expect(() => assertValidTimelineEventOrThrow('supplier_bill.created_from_purchase_order', 1)).not.toThrow();
    expect(() => assertValidTimelineEventOrThrow('job.created', 1)).not.toThrow();
    expect(() => assertValidTimelineEventOrThrow('job.document_linked', 1)).not.toThrow();
    expect(() => assertValidTimelineEventOrThrow('document.linked_to_job', 1)).not.toThrow();
    expect(() => assertValidTimelineEventOrThrow('job.scheduled', 1)).not.toThrow();
    expect(() => assertValidTimelineEventOrThrow('job.assignment_updated', 1)).not.toThrow();
    expect(() => assertValidTimelineEventOrThrow('job.status_changed', 1)).not.toThrow();
    expect(() => assertValidTimelineEventOrThrow('team.created', 1)).not.toThrow();
    expect(() => assertValidTimelineEventOrThrow('team.member_added', 1)).not.toThrow();
    expect(() => assertValidTimelineEventOrThrow('team.member_removed', 1)).not.toThrow();
    expect(() => assertValidTimelineEventOrThrow('team.deleted', 1)).not.toThrow();
    expect(() => assertValidTimelineEventOrThrow('job.assignment_scope_set', 1)).not.toThrow();
  });

  it('rejects invalid event keys', () => {
    expect(isValidTimelineEventKey('invoice.hacked')).toBe(false);
    expect(() => assertValidTimelineEventOrThrow('invoice.hacked', 1)).toThrow(
      'INVALID_TIMELINE_EVENT_TAXONOMY',
    );
  });

  it('rejects invalid event versions', () => {
    expect(() => assertValidTimelineEventOrThrow('invoice.finalised', 2)).toThrow(
      'INVALID_TIMELINE_EVENT_TAXONOMY',
    );
  });
});
