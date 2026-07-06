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
  'job.created',
  'job.updated',
  'job.completed',
  'job.document_linked',
  'document.linked_to_job',
  'job.scheduled',
  'job.assignment_updated',
  'job.status_changed',
  'team.created',
  'team.member_added',
  'team.member_removed',
  'job.assignment_scope_set',
] as const;

export type TimelineEventKey = (typeof TIMELINE_EVENT_KEYS)[number];

export type TimelineCategory =
  | 'document'
  | 'invoice'
  | 'customer'
  | 'business_profile'
  | 'preferences'
  | 'job'
  | 'team';

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
  'job.created': {
    key: 'job.created',
    version: 1,
    category: 'job',
    entityType: 'job',
    actorType: 'system',
    source: 'api',
    payloadSchema: 'timeline.job.created.v1',
    legacyEventType: 'Job Created',
  },
  'job.updated': {
    key: 'job.updated',
    version: 1,
    category: 'job',
    entityType: 'job',
    actorType: 'system',
    source: 'api',
    payloadSchema: 'timeline.job.updated.v1',
    legacyEventType: 'Job Updated',
  },
  'job.completed': {
    key: 'job.completed',
    version: 1,
    category: 'job',
    entityType: 'job',
    actorType: 'system',
    source: 'api',
    payloadSchema: 'timeline.job.completed.v1',
    legacyEventType: 'Job Completed',
  },
  'job.document_linked': {
    key: 'job.document_linked',
    version: 1,
    category: 'job',
    entityType: 'job',
    actorType: 'system',
    source: 'api',
    payloadSchema: 'timeline.job.document_linked.v1',
    legacyEventType: 'Job Document Linked',
  },
  'job.scheduled': {
    key: 'job.scheduled',
    version: 1,
    category: 'job',
    entityType: 'job',
    actorType: 'system',
    source: 'api',
    payloadSchema: 'timeline.job.scheduled.v1',
    legacyEventType: 'Job Scheduled',
  },
  'job.assignment_updated': {
    key: 'job.assignment_updated',
    version: 1,
    category: 'job',
    entityType: 'job',
    actorType: 'system',
    source: 'api',
    payloadSchema: 'timeline.job.assignment_updated.v1',
    legacyEventType: 'Job Assignment Updated',
  },
  'job.status_changed': {
    key: 'job.status_changed',
    version: 1,
    category: 'job',
    entityType: 'job',
    actorType: 'system',
    source: 'api',
    payloadSchema: 'timeline.job.status_changed.v1',
    legacyEventType: 'Job Status Changed',
  },
  'team.created': {
    key: 'team.created',
    version: 1,
    category: 'team',
    entityType: 'team',
    actorType: 'system',
    source: 'api',
    payloadSchema: 'timeline.team.created.v1',
    legacyEventType: 'Team Created',
  },
  'team.member_added': {
    key: 'team.member_added',
    version: 1,
    category: 'team',
    entityType: 'team',
    actorType: 'system',
    source: 'api',
    payloadSchema: 'timeline.team.member_added.v1',
    legacyEventType: 'Team Member Added',
  },
  'team.member_removed': {
    key: 'team.member_removed',
    version: 1,
    category: 'team',
    entityType: 'team',
    actorType: 'system',
    source: 'api',
    payloadSchema: 'timeline.team.member_removed.v1',
    legacyEventType: 'Team Member Removed',
  },
  'job.assignment_scope_set': {
    key: 'job.assignment_scope_set',
    version: 1,
    category: 'job',
    entityType: 'job',
    actorType: 'system',
    source: 'api',
    payloadSchema: 'timeline.job.assignment_scope_set.v1',
    legacyEventType: 'Job Assignment Scope Set',
  },
  'document.linked_to_job': {
    key: 'document.linked_to_job',
    version: 1,
    category: 'document',
    entityType: 'document',
    actorType: 'system',
    source: 'api',
    payloadSchema: 'timeline.document.linked_to_job.v1',
    legacyEventType: 'Document Linked To Job',
  },
};
