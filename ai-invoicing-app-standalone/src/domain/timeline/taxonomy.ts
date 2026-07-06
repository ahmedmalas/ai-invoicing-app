export const TIMELINE_EVENT_KEYS = [
  'document.created',
  'document.updated',
  'invoice.draft_created',
  'invoice.draft_updated',
  'invoice.finalised',
  'customer.created',
  'customer.updated',
  'business_profile.updated',
  'preferences.updated',
] as const;

export type TimelineEventKey = (typeof TIMELINE_EVENT_KEYS)[number];

export type TimelineCategory =
  | 'document'
  | 'invoice'
  | 'customer'
  | 'business_profile'
  | 'preferences';

export type TimelineActorType = 'system';
export type TimelineSource = 'api';

export interface TimelineTaxonomyDefinition {
  key: TimelineEventKey;
  version: 1;
  category: TimelineCategory;
  entityType: string;
  actorType: TimelineActorType;
  source: TimelineSource;
  payloadSchema: string;
  legacyEventType: string;
}

const EVENT_SET = new Set<string>(TIMELINE_EVENT_KEYS);

export function isValidTimelineEventKey(value: string): value is TimelineEventKey {
  return EVENT_SET.has(value);
}

export function assertValidTimelineEventOrThrow(
  eventKey: string,
  eventVersion: number,
): asserts eventKey is TimelineEventKey {
  if (!isValidTimelineEventKey(eventKey) || eventVersion !== 1) {
    throw new Error('INVALID_TIMELINE_EVENT_TAXONOMY');
  }
}

export const TIMELINE_TAXONOMY: Record<TimelineEventKey, TimelineTaxonomyDefinition> = {
  'document.created': {
    key: 'document.created',
    version: 1,
    category: 'document',
    entityType: 'document',
    actorType: 'system',
    source: 'api',
    payloadSchema: 'timeline.document.created.v1',
    legacyEventType: 'Document Created',
  },
  'document.updated': {
    key: 'document.updated',
    version: 1,
    category: 'document',
    entityType: 'document',
    actorType: 'system',
    source: 'api',
    payloadSchema: 'timeline.document.updated.v1',
    legacyEventType: 'Document Updated',
  },
  'invoice.draft_created': {
    key: 'invoice.draft_created',
    version: 1,
    category: 'invoice',
    entityType: 'invoice',
    actorType: 'system',
    source: 'api',
    payloadSchema: 'timeline.invoice.draft_created.v1',
    legacyEventType: 'Draft Created',
  },
  'invoice.draft_updated': {
    key: 'invoice.draft_updated',
    version: 1,
    category: 'invoice',
    entityType: 'invoice',
    actorType: 'system',
    source: 'api',
    payloadSchema: 'timeline.invoice.draft_updated.v1',
    legacyEventType: 'Draft Updated',
  },
  'invoice.finalised': {
    key: 'invoice.finalised',
    version: 1,
    category: 'invoice',
    entityType: 'invoice',
    actorType: 'system',
    source: 'api',
    payloadSchema: 'timeline.invoice.finalised.v1',
    legacyEventType: 'Invoice Finalised',
  },
  'customer.created': {
    key: 'customer.created',
    version: 1,
    category: 'customer',
    entityType: 'customer',
    actorType: 'system',
    source: 'api',
    payloadSchema: 'timeline.customer.created.v1',
    legacyEventType: 'Customer Created',
  },
  'customer.updated': {
    key: 'customer.updated',
    version: 1,
    category: 'customer',
    entityType: 'customer',
    actorType: 'system',
    source: 'api',
    payloadSchema: 'timeline.customer.updated.v1',
    legacyEventType: 'Customer Updated',
  },
  'business_profile.updated': {
    key: 'business_profile.updated',
    version: 1,
    category: 'business_profile',
    entityType: 'business_profile',
    actorType: 'system',
    source: 'api',
    payloadSchema: 'timeline.business_profile.updated.v1',
    legacyEventType: 'Business Profile Updated',
  },
  'preferences.updated': {
    key: 'preferences.updated',
    version: 1,
    category: 'preferences',
    entityType: 'preference',
    actorType: 'system',
    source: 'api',
    payloadSchema: 'timeline.preferences.updated.v1',
    legacyEventType: 'Preferences Updated',
  },
};
