/**
 * Authoritative product-capability map for Aleya AI.
 * Distinguishes “feature exists in the app” from “Aleya AI can access it”.
 * Bank feeds are not implemented — do not confuse static invoice payment details with live feeds.
 */

export type FeatureExistence = 'yes' | 'partial' | 'no';
export type AiAccess = 'read' | 'write' | 'none';

export interface ProductCapability {
  id: string;
  domain: string;
  label: string;
  /** Feature exists in the application (UI and/or API). */
  appExists: FeatureExistence;
  /** What Aleya AI can do today. */
  aiAccess: AiAccess;
  tools: string[];
  confirmation: string;
  undo: string;
  permissions: string;
  limitation: string;
  priority: 'P0' | 'P1' | 'P2' | 'P3' | 'done';
  /** Intents this capability can answer conclusively. */
  conclusiveIntents: string[];
}

export const PRODUCT_CAPABILITIES: ProductCapability[] = [
  {
    id: 'dashboard',
    domain: 'dashboard',
    label: 'Dashboard',
    appExists: 'yes',
    aiAccess: 'none',
    tools: [],
    confirmation: '—',
    undo: '—',
    permissions: 'authenticated',
    limitation: 'Dashboard metrics UI exists; no dedicated Aleya tools yet.',
    priority: 'P1',
    conclusiveIntents: [],
  },
  {
    id: 'invoices',
    domain: 'invoices',
    label: 'Invoices',
    appExists: 'yes',
    aiAccess: 'write',
    tools: [
      'search_invoices',
      'get_invoice',
      'create_invoice_draft',
      'update_invoice_draft',
      'manage_invoice_lines',
      'recalculate_invoice_totals',
      'duplicate_invoice',
      'reuse_previous_invoice',
      'finalise_invoice',
      'delete_invoice_draft',
      'set_invoice_payment_state',
      'list_unpaid_invoices',
    ],
    confirmation: 'finalise / delete / payment-state',
    undo: 'snapshot for draft edits',
    permissions: 'authenticated workspace',
    limitation: 'No void-finalised or recurring invoice tools yet.',
    priority: 'done',
    conclusiveIntents: ['unpaid_invoices', 'invoice_lookup', 'invoice_edit'],
  },
  {
    id: 'customers',
    domain: 'customers',
    label: 'Customers',
    appExists: 'yes',
    aiAccess: 'write',
    tools: ['search_customers', 'get_customer', 'create_customer', 'update_customer', 'delete_customer'],
    confirmation: 'delete_customer',
    undo: 'snapshot for update',
    permissions: 'authenticated workspace',
    limitation: '—',
    priority: 'done',
    conclusiveIntents: ['customer_lookup'],
  },
  {
    id: 'payments',
    domain: 'payments',
    label: 'Payments (manual recording)',
    appExists: 'yes',
    aiAccess: 'write',
    tools: ['record_payment', 'list_payments'],
    confirmation: 'record_payment',
    undo: 'none',
    permissions: 'authenticated workspace',
    limitation: 'Manual payments only — not bank-feed matching.',
    priority: 'done',
    conclusiveIntents: ['list_payments'],
  },
  {
    id: 'bank_feeds',
    domain: 'banking',
    label: 'Bank feeds / open banking',
    appExists: 'partial',
    aiAccess: 'write',
    tools: [
      'get_bank_feed_status',
      'list_connected_bank_accounts',
      'get_bank_account_connection',
      'get_last_bank_sync',
      'list_bank_feed_errors',
      'refresh_bank_feed',
      'list_recent_bank_transactions',
      'search_bank_transactions',
      'disconnect_bank_feed',
      'reconnect_bank_feed',
    ],
    confirmation: 'disconnect_bank_feed, reconnect_bank_feed',
    undo: 'none',
    permissions: 'authenticated workspace',
    limitation:
      'Phase 1 Basiq sandbox/test institutions only. Live Australian bank access requires verified production consent configuration. Static BSB/account on invoice templates remain payment instructions, not the feed.',
    priority: 'P1',
    conclusiveIntents: [
      'bank_feed_connected',
      'bank_feed_sync',
      'bank_feed_errors',
      'bank_transactions',
      'bank_accounts',
    ],
  },
  {
    id: 'reconciliation',
    domain: 'banking',
    label: 'Bank reconciliation',
    appExists: 'no',
    aiAccess: 'none',
    tools: [],
    confirmation: '—',
    undo: '—',
    permissions: '—',
    limitation: 'No bank-statement matching workflow. Invoice “reconcile” copy is not bank recon.',
    priority: 'P2',
    conclusiveIntents: [],
  },
  {
    id: 'templates',
    domain: 'templates',
    label: 'Invoice templates',
    appExists: 'yes',
    aiAccess: 'write',
    tools: ['list_templates', 'set_invoice_template'],
    confirmation: 'none',
    undo: 'snapshot for set',
    permissions: 'authenticated workspace',
    limitation: 'AI cannot yet analyse/import/delete templates.',
    priority: 'P1',
    conclusiveIntents: ['list_templates'],
  },
  {
    id: 'business_profile',
    domain: 'profile',
    label: 'Business profile / branding',
    appExists: 'yes',
    aiAccess: 'write',
    tools: ['get_business_profile', 'update_business_profile'],
    confirmation: 'update_business_profile',
    undo: 'none',
    permissions: 'authenticated workspace',
    limitation:
      'Contact/branding only. Cannot verify bank-feed connectivity. Template bank details are separate.',
    priority: 'done',
    conclusiveIntents: ['business_contact', 'branding'],
  },
  {
    id: 'quotes',
    domain: 'quotes',
    label: 'Quotes',
    appExists: 'yes',
    aiAccess: 'none',
    tools: [],
    confirmation: '—',
    undo: '—',
    permissions: 'authenticated workspace',
    limitation: 'Quotes UI/API exist; Aleya tools not registered yet.',
    priority: 'P1',
    conclusiveIntents: [],
  },
  {
    id: 'reports',
    domain: 'reports',
    label: 'Reports / statements',
    appExists: 'yes',
    aiAccess: 'none',
    tools: [],
    confirmation: '—',
    undo: '—',
    permissions: 'authenticated workspace',
    limitation: 'Reports UI/API exist; no Aleya report tools yet.',
    priority: 'P1',
    conclusiveIntents: [],
  },
  {
    id: 'inventory',
    domain: 'inventory',
    label: 'Inventory / stocktakes',
    appExists: 'yes',
    aiAccess: 'none',
    tools: [],
    confirmation: '—',
    undo: '—',
    permissions: 'authenticated workspace',
    limitation: 'Inventory UI/API exist; no Aleya tools yet.',
    priority: 'P2',
    conclusiveIntents: [],
  },
  {
    id: 'purchase_orders',
    domain: 'ap',
    label: 'Purchase orders',
    appExists: 'yes',
    aiAccess: 'none',
    tools: [],
    confirmation: '—',
    undo: '—',
    permissions: 'authenticated workspace',
    limitation: 'PO UI/API exist; no Aleya tools yet.',
    priority: 'P2',
    conclusiveIntents: [],
  },
  {
    id: 'suppliers_ap',
    domain: 'ap',
    label: 'Suppliers / AP bills / supplier payments',
    appExists: 'partial',
    aiAccess: 'none',
    tools: [],
    confirmation: '—',
    undo: '—',
    permissions: 'authenticated workspace',
    limitation: 'Supplier UI + AP APIs partial; no Aleya tools.',
    priority: 'P2',
    conclusiveIntents: [],
  },
  {
    id: 'expenses',
    domain: 'ap',
    label: 'Expenses',
    appExists: 'no',
    aiAccess: 'none',
    tools: [],
    confirmation: '—',
    undo: '—',
    permissions: '—',
    limitation: 'No dedicated expenses module.',
    priority: 'P3',
    conclusiveIntents: [],
  },
  {
    id: 'email_send',
    domain: 'email',
    label: 'Send invoice email',
    appExists: 'partial',
    aiAccess: 'read',
    tools: ['prepare_invoice_email'],
    confirmation: '—',
    undo: '—',
    permissions: 'authenticated workspace',
    limitation: 'Prepare only — outbound send provider not wired.',
    priority: 'P1',
    conclusiveIntents: [],
  },
  {
    id: 'pdf_export',
    domain: 'pdf',
    label: 'Invoice PDF export',
    appExists: 'yes',
    aiAccess: 'read',
    tools: ['prepare_invoice_pdf'],
    confirmation: '—',
    undo: '—',
    permissions: 'authenticated workspace',
    limitation: '—',
    priority: 'done',
    conclusiveIntents: [],
  },
  {
    id: 'imports',
    domain: 'imports',
    label: 'Imports',
    appExists: 'partial',
    aiAccess: 'write',
    tools: ['bulk_create_drafts_from_rows'],
    confirmation: '—',
    undo: '—',
    permissions: 'authenticated workspace',
    limitation: 'Structured rows only; general CSV file ingest incomplete.',
    priority: 'P2',
    conclusiveIntents: [],
  },
  {
    id: 'integrations',
    domain: 'integrations',
    label: 'Third-party integrations',
    appExists: 'no',
    aiAccess: 'none',
    tools: [],
    confirmation: '—',
    undo: '—',
    permissions: '—',
    limitation: 'No connectors shipped.',
    priority: 'P3',
    conclusiveIntents: [],
  },
  {
    id: 'notifications',
    domain: 'notifications',
    label: 'Notifications',
    appExists: 'no',
    aiAccess: 'none',
    tools: [],
    confirmation: '—',
    undo: '—',
    permissions: '—',
    limitation: 'Not implemented.',
    priority: 'P3',
    conclusiveIntents: [],
  },
  {
    id: 'audit_timeline',
    domain: 'audit',
    label: 'Timeline / audit history',
    appExists: 'partial',
    aiAccess: 'none',
    tools: [],
    confirmation: '—',
    undo: '—',
    permissions: 'authenticated workspace',
    limitation: 'Timeline UI/API exist; Aleya cannot query them yet.',
    priority: 'P2',
    conclusiveIntents: [],
  },
  {
    id: 'access_control',
    domain: 'access',
    label: 'Users / roles / teams',
    appExists: 'partial',
    aiAccess: 'none',
    tools: [],
    confirmation: '—',
    undo: '—',
    permissions: 'admin APIs only',
    limitation: 'API exists; no admin UI or Aleya tools.',
    priority: 'P3',
    conclusiveIntents: [],
  },
  {
    id: 'settings',
    domain: 'settings',
    label: 'Settings',
    appExists: 'yes',
    aiAccess: 'write',
    tools: ['get_business_profile', 'update_business_profile'],
    confirmation: 'update_business_profile',
    undo: 'none',
    permissions: 'authenticated workspace',
    limitation: 'Settings UI is primarily business profile + links.',
    priority: 'done',
    conclusiveIntents: ['business_contact'],
  },
  {
    id: 'logo_creator',
    domain: 'branding',
    label: 'Logo Creator',
    appExists: 'yes',
    aiAccess: 'none',
    tools: [],
    confirmation: '—',
    undo: '—',
    permissions: 'authenticated workspace',
    limitation: 'Logo studio UI/API exist; not wrapped for Aleya yet.',
    priority: 'P2',
    conclusiveIntents: [],
  },
];

export function getBankFeedCapability() {
  return PRODUCT_CAPABILITIES.find((item) => item.id === 'bank_feeds')!;
}

/** @deprecated Prefer db.getBankFeedStatus — kept for capability-map docs only. */
export function bankFeedStatusPayload() {
  return {
    implemented: true,
    connected: false,
    status: 'not_connected' as const,
    provider: 'basiq' as const,
    institution: null,
    maskedAccount: null,
    lastSuccessfulSyncAt: null,
    lastSyncAttemptAt: null,
    errors: [] as string[],
    warning: null,
    nextAction: 'Open Banking and connect a Basiq sandbox test institution.',
    distinction: {
      featureAbsent: false,
      toolAbsentForExistingFeature: false,
      permissionDenied: false,
      providerDisconnected: true,
      temporaryFailure: false,
    },
  };
}

/** Match user messages that are pure product-status questions we can answer without a model loop. */
export type StatusIntent =
  | 'bank_feed_connected'
  | 'bank_feed_sync'
  | 'bank_feed_errors'
  | 'bank_transactions'
  | 'list_controllable'
  | null;

export function matchStatusIntent(message: string): StatusIntent {
  const text = message.trim().toLowerCase();
  if (!text) return null;

  if (
    /\b(what (parts|areas|features)|what can you (currently )?(control|do|access)|which (parts|features)|your (current )?capabilities)\b/.test(
      text,
    )
  ) {
    return 'list_controllable';
  }

  if (
    /\b(last\s*sync|when\s+did\s+(it|my\s+bank(?:\s*feed)?)\s+last\s+sync|sync\s+health|last\s+successful\s+sync)\b/.test(
      text,
    )
  ) {
    // In Aleya, “when did it last sync?” is treated as a bank-feed status question.
    return 'bank_feed_sync';
  }

  const bankish =
    /\b(bank\s*feed|bankfeed|open\s*banking|connected\s*bank|bank\s*connection|bank\s*sync|imported\s*bank|bank\s*transaction)/i.test(
      text,
    ) || /\b(basiq|plaid|yodlee|frollo|akahu)\b/i.test(text);

  if (!bankish && !/\bbank\b/.test(text)) return null;

  if (/\b(error|errors|fail|failed|failure)\b/.test(text) && (bankish || /\bbank\b/.test(text))) {
    return 'bank_feed_errors';
  }
  if (
    /\b(transaction|transactions|imported)\b/.test(text) &&
    (bankish || /\bbank\b/.test(text))
  ) {
    return 'bank_transactions';
  }
  if (
    bankish ||
    /\b(is\s+my\s+bank|bank\s+feed\s+connected|connected\s+to\s+my\s+(bank|account))\b/.test(text)
  ) {
    return 'bank_feed_connected';
  }
  return null;
}

export function answerForStatusIntent(intent: Exclude<StatusIntent, null>): {
  toolName: string;
  assistantMessage: string;
  data: Record<string, unknown>;
} {
  const status = bankFeedStatusPayload();
  if (intent === 'list_controllable') {
    // Only features that exist in the app and have AI tools.
    const controllable = PRODUCT_CAPABILITIES.filter(
      (item) => item.appExists !== 'no' && item.aiAccess !== 'none',
    );
    const missingInApp = PRODUCT_CAPABILITIES.filter((item) => item.appExists === 'no');
    const inAppNoAi = PRODUCT_CAPABILITIES.filter(
      (item) => item.appExists !== 'no' && item.aiAccess === 'none',
    );
    const lines = [
      'Here is an accurate split of what exists versus what I can control today:',
      '',
      'I can currently help with (features that exist and have registered tools):',
      ...controllable.map(
        (item) =>
          `- ${item.label} (${item.aiAccess}${item.tools.length ? `; tools: ${item.tools.join(', ')}` : ''})`,
      ),
      '',
      'These exist in the app but I cannot operate them yet:',
      ...(inAppNoAi.length
        ? inAppNoAi.map((item) => `- ${item.label} — ${item.limitation}`)
        : ['- (none listed)']),
      '',
      'These are not implemented in the product yet (I will say so honestly if asked — I will not invent a page or connection):',
      ...missingInApp.map((item) => `- ${item.label}`),
      '',
      'I am not a complete operating layer over every Aleya screen yet. I only use tools for features that are registered.',
    ];
    return {
      toolName: 'list_product_capabilities',
      assistantMessage: lines.join('\n'),
      data: {
        controllable: controllable.map((item) => item.id),
        inAppNoAi: inAppNoAi.map((item) => item.id),
        missingInApp: missingInApp.map((item) => item.id),
      },
    };
  }

  if (intent === 'bank_feed_sync') {
    return {
      toolName: 'get_last_bank_sync',
      assistantMessage:
        'Use get_last_bank_sync / Banking to read the stored provider sync timestamps for this workspace.',
      data: status,
    };
  }
  if (intent === 'bank_feed_errors') {
    return {
      toolName: 'list_bank_feed_errors',
      assistantMessage:
        'Use list_bank_feed_errors / Banking to read the current bank-feed error state for this workspace.',
      data: status,
    };
  }
  if (intent === 'bank_transactions') {
    return {
      toolName: 'list_recent_bank_transactions',
      assistantMessage:
        'Use list_recent_bank_transactions / Banking to read imported bank transactions for this workspace.',
      data: status,
    };
  }
  return {
    toolName: 'get_bank_feed_status',
    assistantMessage:
      'Bank feeds are available via Basiq Phase 1. Open /workspace/banking or ask Aleya AI for the live connection status.',
    data: status,
  };
}
