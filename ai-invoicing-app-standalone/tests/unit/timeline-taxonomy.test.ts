import { describe, expect, it } from 'vitest';

import {
  assertValidTimelineEventOrThrow,
  isValidTimelineEventKey,
} from '../../src/domain/timeline/taxonomy.js';

describe('timeline taxonomy validator', () => {
  it('accepts canonical event keys at version 1', () => {
    expect(isValidTimelineEventKey('invoice.finalised')).toBe(true);
    expect(() => assertValidTimelineEventOrThrow('invoice.finalised', 1)).not.toThrow();
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
