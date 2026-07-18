export type EntrySource = 'standalone' | 'aboss' | 'aleya-invoicing';

export interface EntryContext {
  source: EntrySource;
  returnUrl: string | null;
  businessId: string | null;
}

export function parseEntryContext(search = window.location.search): EntryContext {
  const params = new URLSearchParams(search);
  const raw = (params.get('source') || 'standalone').toLowerCase();
  const source: EntrySource =
    raw === 'aboss' || raw === 'aleya-invoicing' ? raw : 'standalone';
  return {
    source,
    returnUrl: params.get('returnUrl') || params.get('return_url'),
    businessId: params.get('businessId') || params.get('business_id'),
  };
}

export function sourceLabel(source: EntrySource): string {
  switch (source) {
    case 'aboss':
      return 'Opened from ABoss';
    case 'aleya-invoicing':
      return 'Opened from Aleya Invoicing';
    default:
      return 'Standalone workspace';
  }
}
