import {
  captureEditableSelection,
  hasActiveTextSelection,
  isDrawerFormDirty,
  isEditableTarget,
  markDrawerFormPristine,
  restoreEditableSelection,
  shouldCloseDrawerOnBackdropClick,
  shouldIgnoreGlobalShortcut,
} from './form-interaction-guards.js';
import {
  applyInvoiceDraftSnapshot,
  clearInvoiceDraftSnapshot,
  INVOICE_DRAFT_STORAGE_KEY,
  readInvoiceDraftSnapshot,
  snapshotLooksRecoverable,
  writeInvoiceDraftSnapshot,
} from './invoice-draft-persistence.js';
import {
  bindInvoiceWorkspaceInteractions,
  buildInvoiceWorkspaceHtml,
  customerPreviewHtml,
  refreshInvoiceWorkspaceTotals,
} from './invoice-workspace.js';
import {
  collectInvoiceWorkspacePayload,
  invoicePayloadIsAutosaveReady,
} from './invoice-workspace-payload.js';
import { closeInvoiceCurtain, openInvoiceCurtain } from './invoice-curtain.js';
import {
  businessProfileReadinessMessage,
  isBusinessProfileReady,
} from './business-profile-readiness.js';
import { brandMarkHtml, buildLogoCreatorPageHtml, logoSrcFromProfile } from './logo-studio-ui.js';

const root = document.querySelector('#app');
const SESSION_KEY = 'aboss-invoicing-session';
let session = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
let currentUser = null;
let cache = {};
let workspaceCacheAt = 0;
const WORKSPACE_CACHE_TTL_MS = 30_000;
let recoveryAccessToken = null;
let signOutInProgress = false;
let invoiceAutosaveTimer = null;
let invoiceAutosaveInFlight = false;
let invoicePersistQueue = Promise.resolve();
let invoicePersistActive = false;
let drawerPointerDownTarget = null;
let ignoreNextPopstate = false;
let invoiceWorkspaceAction = 'save';
let invoiceCurtainClosing = false;
let logoStudioConcepts = [];
let logoStudioNotice = '';

const escapeHtml = (value) =>
  String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
const money = (value) =>
  new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(Number(value || 0));
const date = (offset = 0) => {
  const value = new Date();
  value.setDate(value.getDate() + offset);
  return value.toISOString().slice(0, 10);
};
const readableDate = (value) =>
  value
    ? new Intl.DateTimeFormat('en-AU', { dateStyle: 'medium' }).format(
        new Date(value + (value.length === 10 ? 'T00:00:00' : '')),
      )
    : '—';
const readableTime = (value) =>
  value
    ? new Intl.DateTimeFormat('en-AU', { dateStyle: 'medium', timeStyle: 'short' }).format(
        new Date(value),
      )
    : '—';
const quoteStatuses = ['Draft', 'Sent', 'Accepted', 'Declined', 'Expired', 'Cancelled'];
const errorMessages = {
  IMMUTABLE_CONVERTED_QUOTE: 'Converted quotes are permanent and cannot be edited.',
  QUOTE_NOT_ACCEPTED: 'Accept the quote before converting it to an invoice.',
  PAYMENT_ALLOCATION_EXCEEDS_OUTSTANDING: 'The payment exceeds the invoice outstanding balance.',
  PAYMENT_ALLOCATION_REQUIRES_FINALISED_INVOICE: 'Only final invoices can receive payments.',
  CUSTOMER_HAS_QUOTES:
    'This customer cannot be deleted because quotes are linked to it. Keep the customer to preserve quote history.',
  CUSTOMER_HAS_INVOICES:
    'This customer cannot be deleted because invoices are linked to it. Keep the customer to preserve accounting records.',
  CUSTOMER_HAS_PAYMENTS:
    'This customer cannot be deleted because payments are linked to it. Keep the customer to preserve payment history.',
  CUSTOMER_HAS_CREDIT_NOTES:
    'This customer cannot be deleted because credit notes are linked to it. Keep the customer to preserve credit history.',
  CUSTOMER_HAS_JOBS:
    'This customer cannot be deleted because jobs are linked to it. Keep the customer to preserve job history.',
  CUSTOMER_HAS_RELATED_RECORDS:
    'This customer cannot be deleted because related business records still reference it.',
  AUTH_FORBIDDEN: 'You do not have permission to make this change.',
  OWNER_ALREADY_PROVISIONED: 'Owner setup is already complete. Sign in instead.',
};
const friendlyMessage = (message) =>
  errorMessages[message] || message || 'Aleya Invoicing could not complete the request.';

const validationFieldLabels = {
  title: 'Invoice title',
  customerId: 'Customer',
  issueDate: 'Issue date',
  dueDate: 'Due date',
  lineItems: 'Line items',
  'lineItems.description': 'Line item description',
  'lineItems.quantity': 'Line item quantity',
  'lineItems.unitPrice': 'Line item unit price',
};

function formatValidationError(payload) {
  const issues = payload?.details?.issues;
  if (!Array.isArray(issues) || !issues.length) {
    return { message: friendlyMessage(payload?.message), fieldPath: null };
  }
  const first = issues[0];
  const path = Array.isArray(first?.path) ? first.path.filter((part) => typeof part === 'string') : [];
  const pathKey = path.join('.');
  const label = validationFieldLabels[pathKey] || validationFieldLabels[path[0]] || null;
  const rawMessage = String(first?.message || '').trim();
  if (path[0] === 'title' && /required|too small|at least 1|min\(1\)/i.test(rawMessage)) {
    return { message: 'Invoice title is required.', fieldPath: 'title' };
  }
  if (label && rawMessage) {
    if (/required|too small|at least 1|min\(1\)/i.test(rawMessage)) {
      return { message: `${label} is required.`, fieldPath: path[0] || null };
    }
    return { message: `${label}: ${rawMessage}`, fieldPath: path[0] || null };
  }
  return {
    message: rawMessage || friendlyMessage(payload?.message),
    fieldPath: path[0] || null,
  };
}

function focusInvoiceValidationField(fieldPath) {
  if (!fieldPath) return;
  const form = document.querySelector('#invoice-workspace-form');
  if (!form) return;
  const field =
    form.querySelector(`[name="${fieldPath}"]`) ||
    (fieldPath === 'lineItems' ? form.querySelector('[name="description"]') : null);
  if (field && typeof field.focus === 'function') {
    field.focus();
    if (typeof field.select === 'function' && field.type !== 'number') field.select();
  }
}

function saveSession(value) {
  session = value;
  if (value) {
    localStorage.setItem(SESSION_KEY, JSON.stringify(value));
    signOutInProgress = false;
  } else localStorage.removeItem(SESSION_KEY);
}

function provisionalUser(data) {
  return {
    email: String(data.email || '').trim(),
    displayName: String(data.name || data.email || '').trim(),
  };
}

function toast(message, error = false) {
  document.querySelector('.toast')?.remove();
  const node = document.createElement('div');
  node.className = 'toast' + (error ? ' error' : '');
  node.textContent = message;
  document.body.append(node);
  setTimeout(() => node.remove(), 4200);
}

async function refreshSession() {
  if (!session?.refresh_token) return false;
  const response = await fetch('/api/auth/refresh', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ refreshToken: session.refresh_token }),
  });
  if (!response.ok) return false;
  saveSession(await response.json());
  return true;
}

async function api(path, options = {}, retry = true) {
  const headers = new Headers(options.headers || {});
  if (options.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  if (session?.access_token) headers.set('authorization', 'Bearer ' + session.access_token);
  const response = await fetch(path, { ...options, headers });
  if (response.status === 401 && retry && (await refreshSession()))
    return api(path, options, false);
  if (response.status === 401 && !path.startsWith('/api/auth/')) {
    saveSession(null);
    currentUser = null;
    history.replaceState({}, '', '/sign-in');
    authPage('signin', 'Your session has expired. Please sign in again.');
    const error = new Error('Your session has expired. Please sign in again.');
    error.status = 401;
    throw error;
  }
  if (!response.ok) {
    let payload = {};
    try {
      payload = await response.json();
    } catch {}
    const validation =
      payload?.code === 'VALIDATION_FAILED' ? formatValidationError(payload) : null;
    const error = new Error(
      validation?.message || friendlyMessage(payload.message),
    );
    error.status = response.status;
    error.code = payload?.code;
    error.fieldPath = validation?.fieldPath || null;
    error.details = payload?.details || null;
    throw error;
  }
  if (response.status === 204) return null;
  const type = response.headers.get('content-type') || '';
  return type.includes('application/json') ? response.json() : response;
}

function unsavedWorkForm() {
  return (
    document.querySelector('#invoice-workspace-form') ||
    document.querySelector('.drawer-backdrop form')
  );
}

function confirmDiscardUnsavedDrawerWork() {
  const form = unsavedWorkForm();
  if (!form || !isDrawerFormDirty(form)) return true;
  return window.confirm('You have unsaved changes. Discard them and leave this form?');
}

function navigate(path) {
  if (!confirmDiscardUnsavedDrawerWork()) return;
  closeDrawer();
  const leavingWorkspace =
    Boolean(document.querySelector('[data-invoice-curtain]')) &&
    !isInvoiceWorkspacePath(path);
  if (leavingWorkspace) {
    void closeInvoiceWorkspace({ force: true, animate: true }).then(() => {
      history.pushState({}, '', path);
      if (currentUser) void renderRoute();
      else renderPublicAuthRoute();
    });
    return;
  }
  history.pushState({}, '', path);
  if (currentUser) void renderRoute();
  else renderPublicAuthRoute();
}

function authPage(kind, message = '', success = false) {
  const pages = {
    signin: ['Welcome back', 'Sign in', 'Use your Aleya Invoicing owner credentials.', 'Invoicing without the busywork.'],
    signup: ['New workspace', 'Create account', 'Create a private invoicing workspace for your business.', 'Your business. Your secure workspace.'],
    forgot: ['Account recovery', 'Forgot password', 'Enter your email and we will send recovery instructions if an account exists.', 'A safe route back to your work.'],
    reset: ['Account recovery', 'Choose a new password', 'Use a strong password you have not used for this account before.', 'Secure your account. Keep moving.'],
    verification: ['Verify your email', 'Check your inbox', 'Open the verification link we sent, then return to sign in.', 'One last step protects your workspace.'],
    invalid: ['Recovery link unavailable', 'Request a new link', 'This link is malformed, expired, or has already been used.', 'Your account remains protected.'],
  };
  const page = pages[kind] || pages.signin;
  let form = '';
  if (kind === 'signin') {
    form = '<form class="form" id="signin-form"><label>Email<input name="email" type="email" autocomplete="email" required></label><label>Password<input name="password" type="password" autocomplete="current-password" required minlength="12"></label><button class="button" type="submit">Continue to Aleya</button></form><nav class="auth-links" aria-label="Account options"><a href="/create-account" data-route>Create account</a><a href="/forgot-password" data-route>Forgot password?</a></nav>';
  } else if (kind === 'signup') {
    form = '<form class="form" id="signup-form"><label>Name<input name="name" autocomplete="name" required minlength="2" maxlength="120"></label><label>Email<input name="email" type="email" autocomplete="email" required></label><label>Password<input name="password" type="password" autocomplete="new-password" required minlength="12" aria-describedby="password-help"></label><span class="field-help" id="password-help">At least 12 characters with uppercase, lowercase, and a number.</span><label>Confirm password<input name="passwordConfirmation" type="password" autocomplete="new-password" required minlength="12"></label><button class="button" type="submit">Create my workspace</button></form><nav class="auth-links"><a href="/sign-in" data-route>Already have an account? Sign in</a></nav>';
  } else if (kind === 'forgot') {
    form = '<form class="form" id="forgot-form"><label>Email<input name="email" type="email" autocomplete="email" required></label><button class="button" type="submit">Send recovery link</button></form><nav class="auth-links"><a href="/sign-in" data-route>Back to sign in</a></nav>';
  } else if (kind === 'reset') {
    form = '<form class="form" id="reset-form"><label>New password<input name="password" type="password" autocomplete="new-password" required minlength="12" aria-describedby="password-help"></label><span class="field-help" id="password-help">At least 12 characters with uppercase, lowercase, and a number.</span><label>Confirm new password<input name="passwordConfirmation" type="password" autocomplete="new-password" required minlength="12"></label><button class="button" type="submit">Update password</button></form>';
  } else if (kind === 'verification') {
    form = '<nav class="auth-links"><a href="/sign-in" data-route>Return to sign in</a></nav>';
  } else {
    form = '<nav class="auth-links"><a href="/forgot-password" data-route>Request a new recovery link</a><a href="/sign-in" data-route>Back to sign in</a></nav>';
  }
  root.innerHTML = [
    '<main class="auth-page"><section class="auth-story">',
    '<a class="wordmark" href="/" data-route>' +
      brandMarkHtml(null) +
      '<span><strong>Aleya</strong><small>Invoicing</small></span></a>',
    '<div class="auth-copy"><span class="eyebrow">Secure business workspace</span><h1>', page[3], '</h1>',
    '<p>Customers, quotes, invoices, payments and reporting stay connected in one deliberate production workspace.</p></div>',
    '<span class="auth-foot">Aleya Invoicing · Professional Australian invoicing</span></section>',
    '<section class="auth-panel"><div class="auth-card"><span class="eyebrow">', page[0], '</span><h2>', page[1], '</h2><p>', page[2], '</p>',
    message ? '<div class="form-message' + (success ? ' success' : '') + '" role="status">' + escapeHtml(message) + '</div>' : '',
    form,
    '<p class="security-note">Credentials are sent only over the encrypted production connection and are never logged.</p>',
    '</div></section></main>',
  ].join('');
}

function renderPublicAuthRoute(message = '', success = false) {
  const pages = {
    '/sign-in': 'signin',
    '/create-account': 'signup',
    '/forgot-password': 'forgot',
    '/reset-password': recoveryAccessToken ? 'reset' : 'invalid',
  };
  const kind = pages[location.pathname] || 'signin';
  if (!pages[location.pathname]) history.replaceState({}, '', '/sign-in');
  authPage(kind, message, success);
}

const navItems = [
  ['/dashboard', 'DB', 'Dashboard'],
  ['/workspace/customers', 'CU', 'Customers'],
  ['/workspace/quotes', 'QU', 'Quotes'],
  ['/workspace/invoices', 'IN', 'Invoices'],
  ['/workspace/payments', 'PA', 'Payments'],
  ['/workspace/inventory', 'IV', 'Inventory'],
  ['/workspace/purchase-orders', 'PO', 'Purchase Orders'],
  ['/workspace/suppliers', 'SU', 'Suppliers'],
  ['/workspace/stocktakes', 'ST', 'Stocktakes'],
  ['/logo-creator', 'LG', 'Logo Creator'],
  ['/reports', 'RE', 'Reports'],
  ['/timeline', 'TL', 'Timeline'],
  ['/settings', 'SE', 'Settings'],
];

function shell(content) {
  const path = location.pathname;
  root.innerHTML = [
    '<div class="app-shell">',
    '<div class="mobile-overlay" data-menu-close></div>',
    '<aside class="sidebar">',
    '<a class="wordmark" href="/dashboard" data-route>' +
      brandMarkHtml(cache.businessProfile) +
      '<span><strong>Aleya</strong><small>Invoicing</small></span></a>',
    '<span class="nav-label">Workspace</span><nav class="sidebar-nav">',
    navItems
      .map(
        ([href, glyph, label]) =>
          '<a class="nav-item ' +
          (path === href ? 'active' : '') +
          '" href="' +
          href +
          '" data-route><span class="nav-glyph">' +
          glyph +
          '</span><span>' +
          label +
          '</span></a>',
      )
      .join(''),
    '</nav>',
    '<div class="sidebar-foot"><span class="live-dot"></span>Production workspace online</div>',
    '</aside>',
    '<section class="workspace">',
    '<header class="topbar">',
    '<button class="menu-button" type="button" data-menu aria-label="Open navigation">☰</button>',
    '<div class="global-search"><input id="global-search" type="search" placeholder="Search customers, quotes, invoices and payments" aria-label="Search"></div>',
    '<div class="user-context"><span>Signed in</span><strong>',
    escapeHtml(currentUser?.displayName || currentUser?.email || 'Owner'),
    '</strong></div>',
    '<button class="button ghost small" type="button" data-signout>Sign out</button>',
    '</header>',
    '<div id="search-results"></div>',
    content,
    '</section>',
    '</div>',
  ].join('');
}

function pageHead(kicker, title, description, actions = '') {
  return (
    '<header class="page-head"><div><span class="kicker">' +
    kicker +
    '</span><h1>' +
    title +
    '</h1><p>' +
    description +
    '</p></div>' +
    (actions ? '<div class="actions">' + actions + '</div>' : '') +
    '</header>'
  );
}

function empty(label, action = '') {
  return (
    '<div class="empty"><strong>No ' +
    label +
    ' yet</strong><span>' +
    (action || 'Records will appear here as they are created.') +
    '</span></div>'
  );
}

function profileNotice() {
  if (isBusinessProfileReady(cache.businessProfile)) return '';
  return (
    '<div class="notice profile-notice"><strong>Business profile required for PDFs</strong><span>' +
    escapeHtml(businessProfileReadinessMessage(cache.businessProfile)) +
    ' Open Aleya Settings to save your business identity.</span><button class="button small" data-configure-profile>Open Settings</button></div>'
  );
}

function filterBar(placeholder, statuses = []) {
  return (
    '<div class="filter-bar"><label>Filter<input type="search" data-list-search placeholder="' +
    escapeHtml(placeholder) +
    '"></label>' +
    (statuses.length
      ? '<label>Status<select data-list-status><option value="">All statuses</option>' +
        statuses
          .map((status) => '<option value="' + status + '">' + status + '</option>')
          .join('') +
        '</select></label>'
      : '') +
    '</div>'
  );
}

async function loadWorkspace({ force = false } = {}) {
  if (
    !force &&
    workspaceCacheAt &&
    Date.now() - workspaceCacheAt < WORKSPACE_CACHE_TTL_MS &&
    Array.isArray(cache.customers)
  ) {
    return cache;
  }
  const [customers, quotes, invoices, payments, report, businessProfile] = await Promise.all([
    api('/api/customers?limit=500'),
    api('/api/quotes?limit=500'),
    api('/api/invoices?limit=500'),
    api('/api/payments?limit=500'),
    api('/api/reports/read-model?limit=500'),
    api('/api/business-profile').catch((error) =>
      error.status === 404 ? null : Promise.reject(error),
    ),
  ]);
  cache = {
    customers: customers.customers,
    quotes: quotes.quotes,
    invoices: invoices.invoices,
    payments: payments.payments,
    report,
    businessProfile,
  };
  workspaceCacheAt = Date.now();
  return cache;
}

function invalidateWorkspaceCache() {
  workspaceCacheAt = 0;
}

function receivable(invoiceId) {
  return cache.report?.accountsReceivable?.invoices?.find((item) => item.invoiceId === invoiceId);
}

function invoiceView(invoice) {
  const row = receivable(invoice.id);
  const paid = Number(row?.totalPaid || 0);
  const outstanding = Number(
    row?.outstanding ?? (invoice.status === 'Finalised' ? invoice.totals.total : 0),
  );
  const overdue =
    invoice.status === 'Finalised' && outstanding > 0.0001 && invoice.dueDate < date();
  let state = invoice.paymentState;
  if (overdue) state = 'Overdue';
  else if (paid > 0 && outstanding > 0.0001) state = 'Part paid';
  return { paid, outstanding, overdue, state };
}

function customerBalance(customerId) {
  return cache.invoices
    .filter((invoice) => invoice.customerId === customerId)
    .reduce((total, invoice) => total + invoiceView(invoice).outstanding, 0);
}

function invoicePayments(invoiceId) {
  return cache.payments.filter((payment) =>
    payment.allocations?.some((allocation) => allocation.invoiceId === invoiceId),
  );
}

function dashboardPage() {
  const ar = cache.report.accountsReceivable;
  const overdue = ar.invoices.filter((row) => {
    const invoice = cache.invoices.find((item) => item.id === row.invoiceId);
    return invoice && invoice.dueDate < date() && row.outstanding > 0.0001;
  });
  const awaiting = ar.invoices.filter((row) => row.outstanding > 0.0001);
  const recentInvoices = [...cache.invoices].slice(0, 5);
  const recentPayments = [...cache.payments].slice(0, 5);
  const invoiceRows = recentInvoices
    .map((invoice) => {
      const view = invoiceView(invoice);
      const customer = cache.customers.find((item) => item.id === invoice.customerId);
      return (
        '<tr><td class="primary-cell">' +
        escapeHtml(invoice.invoiceNumber || 'Draft') +
        '</td><td>' +
        escapeHtml(customer?.displayName || 'Customer') +
        '</td><td><span class="status ' +
        view.state.replaceAll(' ', '-') +
        '">' +
        escapeHtml(view.state) +
        '</span></td><td>' +
        money(view.outstanding) +
        '</td><td><button class="button ghost small" data-view-invoice="' +
        invoice.id +
        '">View</button></td></tr>'
      );
    })
    .join('');
  const paymentRows = recentPayments
    .map((payment) => {
      const customer = cache.customers.find((item) => item.id === payment.customerId);
      return (
        '<tr><td class="primary-cell">' +
        escapeHtml(payment.paymentNumber) +
        '</td><td>' +
        escapeHtml(customer?.displayName || 'Customer') +
        '</td><td>' +
        readableDate(payment.paymentDate) +
        '</td><td>' +
        money(payment.amount) +
        '</td><td><button class="button ghost small" data-view-payment="' +
        payment.id +
        '">View</button></td></tr>'
      );
    })
    .join('');
  const quoteActivity = quoteStatuses
    .map((status) => {
      const count = cache.quotes.filter((quote) => quote.status === status).length;
      return count
        ? '<span class="summary-chip"><strong>' + count + '</strong> ' + status + '</span>'
        : '';
    })
    .join('');
  shell(
    '<main class="page">' +
      pageHead(
        'Aleya Invoicing',
        'Good business starts with a clear view.',
        'Live figures from the PostgreSQL invoicing ledger.',
        '<button class="button" data-new-quote>New quote</button><button class="button secondary" data-new-payment>Record payment</button>',
      ) +
      profileNotice() +
      '<section class="metric-grid"><article class="metric"><span>Outstanding</span><strong>' +
      money(ar.totals.outstanding) +
      '</strong><small>Across final invoices</small></article><article class="metric"><span>Overdue</span><strong>' +
      money(overdue.reduce((sum, row) => sum + row.outstanding, 0)) +
      '</strong><small>' +
      overdue.length +
      ' invoice' +
      (overdue.length === 1 ? '' : 's') +
      '</small></article><article class="metric"><span>Awaiting payment</span><strong>' +
      awaiting.length +
      '</strong><small>Open receivables</small></article><article class="metric"><span>Customers</span><strong>' +
      cache.customers.length +
      '</strong><small>Active records</small></article></section>' +
      '<section class="grid-2"><article class="panel"><header class="panel-head"><h2>Recent invoices</h2><a href="/invoices" data-route>View all</a></header>' +
      (invoiceRows
        ? '<div class="table-wrap"><table><thead><tr><th>Invoice</th><th>Customer</th><th>State</th><th>Outstanding</th><th></th></tr></thead><tbody>' +
          invoiceRows +
          '</tbody></table></div>'
        : empty('invoices', 'Convert an accepted quote or create an invoice.')) +
      '</article><article class="panel"><header class="panel-head"><h2>Quote activity</h2><a href="/quotes" data-route>Open quotes</a></header><div class="panel-body summary-chips">' +
      (quoteActivity || '<span class="muted">No quote activity yet.</span>') +
      '</div></article></section>' +
      '<section class="panel section-gap"><header class="panel-head"><h2>Recent payments</h2><a href="/payments" data-route>View all</a></header>' +
      (paymentRows
        ? '<div class="table-wrap"><table><thead><tr><th>Payment</th><th>Customer</th><th>Date</th><th>Amount</th><th></th></tr></thead><tbody>' +
          paymentRows +
          '</tbody></table></div>'
        : empty('payments', 'Payments appear after they are allocated.')) +
      '</section></main>',
  );
}

function customersPage() {
  const rows = cache.customers
    .map((customer) => {
      const invoices = cache.invoices.filter((invoice) => invoice.customerId === customer.id);
      const search = [customer.displayName, customer.email, customer.phone, customer.abnTaxId]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return (
        '<tr data-search="' +
        escapeHtml(search) +
        '"><td class="primary-cell">' +
        escapeHtml(customer.displayName) +
        '</td><td>' +
        escapeHtml(customer.email || '—') +
        '</td><td>' +
        escapeHtml(customer.phone || '—') +
        '</td><td>' +
        invoices.length +
        '</td><td>' +
        money(customerBalance(customer.id)) +
        '</td><td><div class="row-actions"><button class="button secondary small" data-view-customer="' +
        customer.id +
        '">View</button><button class="button ghost small" data-edit-customer="' +
        customer.id +
        '">Edit</button><button class="button danger small" data-delete-customer="' +
        customer.id +
        '" data-name="' +
        escapeHtml(customer.displayName) +
        '">Delete</button><button class="button ghost small" data-timeline="customer" data-id="' +
        customer.id +
        '">Audit</button></div></td></tr>'
      );
    })
    .join('');
  shell(
    '<main class="page">' +
      pageHead(
        'Customers',
        'Customer records',
        'Create, search, edit and review customer balances and invoice history.',
        '<button class="button" data-new-customer>New customer</button>',
      ) +
      '<section class="panel">' +
      filterBar('Search name, email, phone or ABN') +
      (rows
        ? '<div class="table-wrap"><table><thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Invoices</th><th>Outstanding</th><th></th></tr></thead><tbody>' +
          rows +
          '</tbody></table></div>'
        : empty('customers', 'Create the first customer to start a quote.')) +
      '</section></main>',
  );
}

function quotesPage() {
  const rows = cache.quotes
    .map((quote) => {
      const customer = cache.customers.find((item) => item.id === quote.customerId);
      const search = [quote.quoteNumber, quote.title, customer?.displayName]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      const editable = quote.status !== 'Converted';
      const nextActions =
        quote.status === 'Draft'
          ? '<button class="button small" data-quote-status="Sent" data-id="' +
            quote.id +
            '">Mark sent</button>'
          : quote.status === 'Sent'
            ? '<button class="button small" data-quote-status="Accepted" data-id="' +
              quote.id +
              '">Accept</button><button class="button danger small" data-quote-status="Declined" data-id="' +
              quote.id +
              '">Reject</button>'
            : quote.status === 'Accepted'
              ? '<button class="button small" data-convert-quote="' +
                quote.id +
                '">Convert</button>'
              : '';
      return (
        '<tr data-search="' +
        escapeHtml(search) +
        '" data-status="' +
        quote.status +
        '"><td class="primary-cell">' +
        escapeHtml(quote.quoteNumber) +
        '</td><td>' +
        escapeHtml(customer?.displayName || 'Customer') +
        '</td><td>' +
        escapeHtml(quote.title) +
        '</td><td><span class="status ' +
        quote.status +
        '">' +
        quote.status +
        '</span></td><td>' +
        readableDate(quote.expiryDate) +
        '</td><td>' +
        money(quote.totals.total) +
        '</td><td><div class="row-actions"><button class="button secondary small" data-view-quote="' +
        quote.id +
        '">View</button><button class="button secondary small" data-pdf="quote" data-id="' +
        quote.id +
        '">PDF</button>' +
        (editable
          ? '<button class="button ghost small" data-edit-quote="' + quote.id + '">Edit</button>'
          : '') +
        '<button class="button ghost small" data-duplicate-quote="' +
        quote.id +
        '">Duplicate</button>' +
        nextActions +
        '<button class="button ghost small" data-timeline="quote" data-id="' +
        quote.id +
        '">Audit</button></div></td></tr>'
      );
    })
    .join('');
  shell(
    '<main class="page">' +
      pageHead(
        'Sales',
        'Quotes',
        'Draft, send, accept, reject, duplicate, download and convert priced proposals.',
        '<button class="button" data-new-quote>New quote</button>',
      ) +
      profileNotice() +
      '<section class="panel">' +
      filterBar('Search quote, title or customer', [
        'Draft',
        'Sent',
        'Accepted',
        'Declined',
        'Expired',
        'Cancelled',
        'Converted',
      ]) +
      (rows
        ? '<div class="table-wrap"><table><thead><tr><th>Quote</th><th>Customer</th><th>Title</th><th>Status</th><th>Expires</th><th>Total</th><th></th></tr></thead><tbody>' +
          rows +
          '</tbody></table></div>'
        : empty('quotes', 'Create a quote after adding a customer.')) +
      '</section></main>',
  );
}

function invoicesPage() {
  const states = ['Draft', 'Awaiting Payment', 'Part paid', 'Overdue', 'Paid', 'Cancelled'];
  const rows = cache.invoices
    .map((invoice) => {
      const customer = cache.customers.find((item) => item.id === invoice.customerId);
      const view = invoiceView(invoice);
      const search = [
        invoice.invoiceNumber,
        invoice.sourceQuoteNumber,
        invoice.title,
        customer?.displayName,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return (
        '<tr data-search="' +
        escapeHtml(search) +
        '" data-status="' +
        view.state +
        '"><td class="primary-cell">' +
        escapeHtml(invoice.invoiceNumber || 'Draft') +
        '</td><td>' +
        escapeHtml(customer?.displayName || 'Customer') +
        '</td><td>' +
        escapeHtml(invoice.sourceQuoteNumber || 'Direct') +
        '</td><td>' +
        escapeHtml(invoice.title) +
        '</td><td><span class="status ' +
        view.state.replaceAll(' ', '-') +
        '">' +
        escapeHtml(view.state) +
        '</span></td><td>' +
        money(view.paid) +
        '</td><td>' +
        money(view.outstanding) +
        '</td><td>' +
        money(invoice.totals.total) +
        '</td><td><div class="row-actions"><button class="button secondary small" data-view-invoice="' +
        invoice.id +
        '">View</button>' +
        (invoice.status === 'Draft'
          ? '<button class="button ghost small" data-edit-invoice="' +
            invoice.id +
            '">Edit</button><button class="button small" data-finalise-invoice="' +
            invoice.id +
            '">Issue</button>'
          : '<button class="button secondary small" data-pdf="invoice" data-id="' +
            invoice.id +
            '">PDF</button>') +
        '<button class="button ghost small" data-timeline="invoice" data-id="' +
        invoice.id +
        '">Audit</button></div></td></tr>'
      );
    })
    .join('');
  shell(
    '<main class="page">' +
      pageHead(
        'Revenue',
        'Invoices',
        'Create, issue, search and reconcile invoices while preserving final-document protections.',
        '<button class="button" data-new-invoice>New invoice</button>',
      ) +
      profileNotice() +
      '<section class="panel">' +
      filterBar('Search invoice, source quote, title or customer', states) +
      (rows
        ? '<div class="table-wrap"><table><thead><tr><th>Invoice</th><th>Customer</th><th>Source</th><th>Title</th><th>Payment state</th><th>Paid</th><th>Outstanding</th><th>Total</th><th></th></tr></thead><tbody>' +
          rows +
          '</tbody></table></div>'
        : empty('invoices', 'Convert an accepted quote or create an invoice directly.')) +
      '</section></main>',
  );
}

function paymentsPage() {
  const rows = cache.payments
    .map((payment) => {
      const customer = cache.customers.find((item) => item.id === payment.customerId);
      const invoiceNumbers = payment.allocations
        .map(
          (allocation) =>
            cache.invoices.find((invoice) => invoice.id === allocation.invoiceId)?.invoiceNumber ||
            'Invoice',
        )
        .join(', ');
      const search = [
        payment.paymentNumber,
        customer?.displayName,
        payment.reference,
        payment.paymentMethod,
        invoiceNumbers,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return (
        '<tr data-search="' +
        escapeHtml(search) +
        '"><td class="primary-cell">' +
        escapeHtml(payment.paymentNumber) +
        '</td><td>' +
        escapeHtml(customer?.displayName || 'Customer') +
        '</td><td>' +
        escapeHtml(invoiceNumbers) +
        '</td><td>' +
        readableDate(payment.paymentDate) +
        '</td><td>' +
        escapeHtml(payment.paymentMethod) +
        '</td><td>' +
        escapeHtml(payment.reference) +
        '</td><td>' +
        money(payment.amount) +
        '</td><td><div class="row-actions"><button class="button secondary small" data-view-payment="' +
        payment.id +
        '">View</button><button class="button secondary small" data-pdf="payment" data-id="' +
        payment.id +
        '">Receipt</button><button class="button ghost small" data-timeline="payment" data-id="' +
        payment.id +
        '">Audit</button></div></td></tr>'
      );
    })
    .join('');
  shell(
    '<main class="page">' +
      pageHead(
        'Receivables',
        'Payments',
        'Allocate partial or final receipts and verify the running ledger balance.',
        '<button class="button" data-new-payment>Record payment</button>',
      ) +
      profileNotice() +
      '<section class="metric-grid"><article class="metric"><span>Allocated receipts</span><strong>' +
      money(cache.report.accountsReceivable.totals.totalPaid) +
      '</strong><small>' +
      cache.payments.length +
      ' payment' +
      (cache.payments.length === 1 ? '' : 's') +
      '</small></article><article class="metric"><span>Outstanding</span><strong>' +
      money(cache.report.accountsReceivable.totals.outstanding) +
      '</strong><small>Server-calculated balance</small></article></section><section class="panel">' +
      filterBar('Search payment, invoice, customer or reference') +
      (rows
        ? '<div class="table-wrap"><table><thead><tr><th>Payment</th><th>Customer</th><th>Invoice</th><th>Date</th><th>Method</th><th>Reference</th><th>Amount</th><th></th></tr></thead><tbody>' +
          rows +
          '</tbody></table></div>'
        : empty('payments', 'Issue an invoice, then record the first receipt.')) +
      '</section></main>',
  );
}

function reportsPage() {
  const report = cache.report;
  const ar = report.accountsReceivable;
  const invoiceRows = ar.invoices
    .map((item) => {
      const invoice = cache.invoices.find((entry) => entry.id === item.invoiceId);
      const overdue = invoice && invoice.dueDate < date() && item.outstanding > 0.0001;
      return (
        '<tr><td class="primary-cell">' +
        escapeHtml(item.invoiceNumber) +
        '</td><td>' +
        money(item.totalInvoiced) +
        '</td><td>' +
        money(item.totalPaid) +
        '</td><td>' +
        money(item.totalCredited) +
        '</td><td>' +
        money(item.outstanding) +
        '</td><td>' +
        (overdue ? '<span class="status Overdue">Overdue</span>' : '—') +
        '</td></tr>'
      );
    })
    .join('');
  const customerRows = ar.customerStatements
    .map(
      (item) =>
        '<tr><td class="primary-cell">' +
        escapeHtml(item.customerName) +
        '</td><td>' +
        money(item.openingBalance) +
        '</td><td>' +
        money(item.activity) +
        '</td><td>' +
        money(item.closingBalance) +
        '</td></tr>',
    )
    .join('');
  const filters = report.filters || {};
  shell(
    '<main class="page">' +
      pageHead(
        'Live ledger',
        'Reports',
        'Receivables, overdue invoices, customer balances and payment activity from the server read model.',
        '<button class="button secondary" data-export-report>Export CSV</button>',
      ) +
      '<form class="filter-bar report-filter" id="report-filter"><label>From<input type="date" name="from" value="' +
      escapeHtml(filters.from || '') +
      '"></label><label>To<input type="date" name="to" value="' +
      escapeHtml(filters.to || '') +
      '"></label><button class="button small" type="submit">Apply dates</button><button class="button ghost small" type="button" data-clear-report>Clear</button></form><section class="metric-grid"><article class="metric"><span>Invoiced</span><strong>' +
      money(ar.totals.totalInvoiced) +
      '</strong></article><article class="metric"><span>Paid</span><strong>' +
      money(ar.totals.totalPaid) +
      '</strong></article><article class="metric"><span>Credited</span><strong>' +
      money(ar.totals.totalCredited) +
      '</strong></article><article class="metric"><span>Outstanding</span><strong>' +
      money(ar.totals.outstanding) +
      '</strong></article></section><section class="panel"><header class="panel-head"><h2>Invoice receivables</h2></header>' +
      (invoiceRows
        ? '<div class="table-wrap"><table><thead><tr><th>Invoice</th><th>Invoiced</th><th>Paid</th><th>Credited</th><th>Outstanding</th><th>Alert</th></tr></thead><tbody>' +
          invoiceRows +
          '</tbody></table></div>'
        : empty('report rows', 'Final invoices appear here.')) +
      '</section><section class="panel section-gap"><header class="panel-head"><h2>Customer balances</h2></header>' +
      (customerRows
        ? '<div class="table-wrap"><table><thead><tr><th>Customer</th><th>Opening</th><th>Activity</th><th>Closing</th></tr></thead><tbody>' +
          customerRows +
          '</tbody></table></div>'
        : empty('customer balances')) +
      '</section></main>',
  );
}

function safeEventSummary(event) {
  const labels = {
    'customer.created': 'Customer created',
    'customer.updated': 'Customer updated',
    'quote.created': 'Quote created',
    'quote.updated': 'Quote updated',
    'quote.status_changed': 'Quote status changed',
    'quote.converted': 'Quote converted to invoice',
    'invoice.draft_created': 'Invoice draft created',
    'invoice.draft_updated': 'Invoice draft updated',
    'invoice.finalised': 'Invoice issued',
    'invoice.paid': 'Invoice paid',
    'payment.created': 'Payment recorded',
    'payment.allocated': 'Payment allocated',
    'business_profile.updated': 'Business profile updated',
  };
  let payload = {};
  try {
    payload = JSON.parse(event.eventPayload || event.event_payload || '{}');
  } catch {}
  const details = [];
  if (payload.quoteNumber) details.push(payload.quoteNumber);
  if (payload.invoiceNumber) details.push(payload.invoiceNumber);
  if (payload.paymentNumber) details.push(payload.paymentNumber);
  if (payload.from && payload.to) details.push(payload.from + ' → ' + payload.to);
  if (typeof payload.amount === 'number') details.push(money(payload.amount));
  if (typeof payload.total === 'number') details.push(money(payload.total));
  const key = event.eventKey || event.event_key || event.eventType || event.event_type;
  return { title: labels[key] || String(key).replaceAll('.', ' '), detail: details.join(' · ') };
}

async function timelinePage() {
  const entities = [
    ...cache.customers.map((item) => ['customer', item.id, item.displayName]),
    ...cache.quotes.map((item) => ['quote', item.id, item.quoteNumber]),
    ...cache.invoices.map((item) => ['invoice', item.id, item.invoiceNumber || 'Invoice draft']),
    ...cache.payments.map((item) => ['payment', item.id, item.paymentNumber]),
  ];
  const results = await Promise.allSettled(
    entities.map(async ([type, id, label]) => {
      const result = await api(
        '/api/timeline/' + encodeURIComponent(type) + '/' + encodeURIComponent(id) + '?limit=200',
      );
      return result.events.map((event) => ({ ...event, entityLabel: label, entityKind: type }));
    }),
  );
  const recordedEvents = results.flatMap((result) =>
    result.status === 'fulfilled' ? result.value : [],
  );
  const paidEvents = cache.invoices
    .filter((invoice) => invoice.paymentState === 'Paid')
    .map((invoice) => {
      const latestPayment = invoicePayments(invoice.id).sort((a, b) =>
        b.updatedAt.localeCompare(a.updatedAt),
      )[0];
      return {
        eventKey: 'invoice.paid',
        createdAt: latestPayment?.updatedAt || invoice.updatedAt,
        entityLabel: invoice.invoiceNumber || 'Invoice',
        entityKind: 'invoice',
      };
    });
  const events = [...recordedEvents, ...paidEvents]
    .sort((a, b) =>
      String(b.createdAt || b.created_at).localeCompare(String(a.createdAt || a.created_at)),
    )
    .slice(0, 200);
  const rows = events
    .map((event) => {
      const summary = safeEventSummary(event);
      const details = [
        ...new Set([event.entityLabel, ...summary.detail.split(' · ')].filter(Boolean)),
      ].join(' · ');
      return (
        '<article class="activity-event"><time>' +
        readableTime(event.createdAt || event.created_at) +
        '</time><div><span class="kicker">' +
        escapeHtml(event.entityKind) +
        '</span><h3>' +
        escapeHtml(summary.title) +
        '</h3><p>' +
        escapeHtml(details) +
        '</p></div></article>'
      );
    })
    .join('');
  shell(
    '<main class="page">' +
      pageHead(
        'Audit',
        'Timeline',
        'A readable activity history across customers, quotes, invoices and payments.',
      ) +
      '<section class="panel activity-list">' +
      (rows || empty('audit events', 'Business activity appears here as records change.')) +
      '</section></main>',
  );
}

function settingsPage() {
  const profile = cache.businessProfile || {};
  const ready = isBusinessProfileReady(profile);
  shell(
    '<main class="page">' +
      pageHead(
        'Aleya Settings',
        'Business profile',
        'This Aleya workspace stores your business identity for invoices, quotes and receipts. It is the single source of truth — not an external settings page.',
      ) +
      '<section class="grid-2 settings-grid"><article class="panel"><header class="panel-head"><h2>Business profile</h2></header><form class="form panel-body" id="profile-form"><label>Business name<input name="companyName" required value="' +
      escapeHtml(profile.companyName || '') +
      '" autocomplete="organization"></label><label>Legal name<input name="legalName" value="' +
      escapeHtml(profile.legalName || '') +
      '"></label><div class="form-grid"><label>ABN / Tax ID<input name="abnTaxId" value="' +
      escapeHtml(profile.abnTaxId || '') +
      '"></label><label>Email<input name="email" type="email" value="' +
      escapeHtml(profile.email || '') +
      '" autocomplete="email"></label><label>Phone<input name="phone" value="' +
      escapeHtml(profile.phone || '') +
      '" autocomplete="tel"></label><label class="wide">Business address<textarea name="address" required rows="3" placeholder="Street, suburb, state, postcode">' +
      escapeHtml(profile.address || '') +
      '</textarea></label><label>Primary colour<input name="primaryColor" type="color" value="' +
      escapeHtml(profile.primaryColor || '#173f35') +
      '" required></label><label>Secondary colour<input name="secondaryColor" type="color" value="' +
      escapeHtml(profile.secondaryColor || '#c4f36b') +
      '" required></label></div><p class="muted">Business name and address are required before PDF preview and download unlock.</p><button class="button" type="submit">Save business profile</button></form></article><article class="panel"><header class="panel-head"><h2>Brand identity</h2></header><div class="panel-body stack">' +
      (logoSrcFromProfile(profile)
        ? '<div class="notice success"><strong>Logo active</strong><br>Your selected logo is used across the dashboard, invoices and PDFs.</div><img class="settings-logo-preview" src="' +
          logoSrcFromProfile(profile) +
          '" alt="Active logo" width="240" height="140">'
        : '<div class="notice"><strong>No logo yet</strong><br>Create a logo once — Aleya applies it everywhere automatically.</div>') +
      '<a class="button" href="/logo-creator" data-route>Open Logo Creator</a>' +
      '<div class="notice success"><strong>Stored in Aleya</strong><br>Business profile rows live in this app’s database via <code>/api/business-profile</code>.</div>' +
      (ready
        ? '<div class="notice success"><strong>PDF downloads are ready</strong><br>' +
          escapeHtml(businessProfileReadinessMessage(profile)) +
          '</div>'
        : '<div class="notice"><strong>PDF downloads are paused</strong><br>' +
          escapeHtml(businessProfileReadinessMessage(profile)) +
          '</div>') +
      '</div></article></section></main>',
  );
}

async function logoCreatorPage() {
  let standaloneUrl = '';
  let abossLaunchUrl = '';
  try {
    const platform = await api('/api/logo-studio/brand-kits');
    standaloneUrl = platform.standaloneUrl || '';
    abossLaunchUrl = platform.abossLaunchUrl || '';
  } catch {
    // Platform metadata is optional — Logo Creator still works locally.
  }
  shell(
    buildLogoCreatorPageHtml({
      profile: cache.businessProfile || {},
      concepts: logoStudioConcepts,
      selectedId: '',
      notice: logoStudioNotice,
      standaloneUrl,
      abossLaunchUrl,
    }),
  );
}

function drawer(title, body) {
  document.querySelector('.drawer-backdrop')?.remove();
  document.body.insertAdjacentHTML(
    'beforeend',
    '<div class="drawer-backdrop" data-drawer-backdrop><aside class="drawer"><header class="drawer-head"><div><span class="kicker">Aleya Invoicing</span><h2>' +
      escapeHtml(title) +
      '</h2></div><button class="icon-button" data-close-drawer aria-label="Close">×</button></header>' +
      body +
      '</aside></div>',
  );
  const form = document.querySelector('.drawer-backdrop form');
  if (form) markDrawerFormPristine(form);
}
const closeDrawer = () => document.querySelector('.drawer-backdrop')?.remove();
function requestCloseDrawer() {
  if (!confirmDiscardUnsavedDrawerWork()) return false;
  closeDrawer();
  return true;
}

function openDestructiveConfirmDialog({ title, message, confirmLabel = 'Delete' }) {
  return new Promise((resolve) => {
    document.querySelector('.confirm-backdrop')?.remove();
    document.body.insertAdjacentHTML(
      'beforeend',
      '<div class="confirm-backdrop" data-confirm-backdrop role="presentation"><div class="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-destructive-title" aria-describedby="confirm-destructive-message"><h3 id="confirm-destructive-title">' +
        escapeHtml(title) +
        '</h3><p id="confirm-destructive-message">' +
        escapeHtml(message) +
        '</p><div class="confirm-actions"><button type="button" class="button ghost" data-confirm-cancel>Cancel</button><button type="button" class="button danger" data-confirm-ok>' +
        escapeHtml(confirmLabel) +
        '</button></div></div></div>',
    );
    const backdrop = document.querySelector('.confirm-backdrop');
    const finish = (value) => {
      backdrop?.remove();
      resolve(value);
    };
    backdrop?.querySelector('[data-confirm-cancel]')?.addEventListener('click', () => finish(false));
    backdrop?.querySelector('[data-confirm-ok]')?.addEventListener('click', () => finish(true));
    backdrop?.addEventListener('click', (event) => {
      if (event.target === backdrop) finish(false);
    });
    backdrop?.querySelector('[data-confirm-ok]')?.focus();
  });
}

async function removeCustomerViaApi(customerId, displayName) {
  const confirmed = await openDestructiveConfirmDialog({
    title: 'Delete customer?',
    message:
      'Permanently delete "' +
      (displayName || 'this customer') +
      '"? This is only allowed when no invoices, quotes, payments, credit notes, or jobs reference the customer.',
    confirmLabel: 'Delete customer',
  });
  if (!confirmed) return;
  await api('/api/customers/' + customerId, { method: 'DELETE' });
  closeDrawer();
  toast('Customer deleted.');
  invalidateWorkspaceCache();
  await renderRoute({ forceReload: true });
}


function isInvoiceWorkspacePath(path = location.pathname) {
  return path === '/workspace/invoices/new' || /^\/workspace\/invoices\/[^/]+\/edit$/.test(path);
}

function parseInvoiceWorkspacePath(path = location.pathname) {
  if (path === '/workspace/invoices/new') return { mode: 'create', id: null };
  const match = path.match(/^\/workspace\/invoices\/([^/]+)\/edit$/);
  if (match) return { mode: 'edit', id: match[1] };
  return null;
}

function openInvoiceWorkspaceRoute(id = null) {
  navigate(id ? '/workspace/invoices/' + id + '/edit' : '/workspace/invoices/new');
}

function updateCustomerPreview(form) {
  const select = form?.querySelector('[data-customer-select]');
  const preview = form?.querySelector('[data-customer-preview]');
  if (!select || !preview) return;
  const customer = cache.customers.find((item) => item.id === select.value);
  preview.innerHTML = customerPreviewHtml(customer || null);
}

function scheduleInvoiceDraftSnapshot(form) {
  if (!form) return;
  const active = form.ownerDocument?.activeElement;
  const selection =
    active && form.contains(active) && isEditableTarget(active)
      ? captureEditableSelection(active)
      : null;
  writeInvoiceDraftSnapshot(form);
  if (selection) restoreEditableSelection(selection);
  if (invoiceAutosaveTimer) clearTimeout(invoiceAutosaveTimer);
  invoiceAutosaveTimer = setTimeout(() => {
    void autosaveInvoiceWorkspace(form);
  }, 1200);
}

async function autosaveInvoiceWorkspace(form) {
  if (
    !form ||
    !form.isConnected ||
    invoiceAutosaveInFlight ||
    invoicePersistActive ||
    form.dataset.autosaveLocked === 'true'
  ) {
    return;
  }
  let body;
  try {
    body = await collectInvoiceWorkspacePayload(form);
  } catch {
    return;
  }
  if (!invoicePayloadIsAutosaveReady(body)) return;
  invoiceAutosaveInFlight = true;
  form.dataset.autosaveLocked = 'true';
  try {
    const saved = await persistInvoiceWorkspace(form, {
      stay: true,
      quiet: true,
      source: 'autosave',
    });
    if (form.isConnected) {
      writeInvoiceDraftSnapshot(form, { recordId: saved.id });
    }
  } catch (error) {
    // Keep local snapshot; never clear form values after a failed autosave.
    if (error?.status !== 401) {
      /* quiet autosave failure */
    }
  } finally {
    invoiceAutosaveInFlight = false;
    if (form.isConnected) form.dataset.autosaveLocked = 'false';
  }
}

async function mountInvoiceWorkspace(record = null) {
  if (!cache.customers.length) {
    toast('Create a customer before creating an invoice.', true);
    history.replaceState({}, '', '/workspace/customers');
    customersPage();
    return;
  }
  if (record && record.status && record.status !== 'Draft') {
    toast('Final invoices are locked. Open the invoice details instead.', true);
    history.replaceState({}, '', '/workspace/invoices');
    invoicesPage();
    return;
  }
  document.querySelector('[data-invoice-curtain]')?.remove();
  if (invoiceAutosaveTimer) {
    clearTimeout(invoiceAutosaveTimer);
    invoiceAutosaveTimer = null;
  }
  const recovered =
    !record?.id && snapshotLooksRecoverable(readInvoiceDraftSnapshot())
      ? readInvoiceDraftSnapshot()
      : null;
  // If a prior autosave already created a server draft, reload that record instead of a blank /new form.
  if (!record?.id && recovered?.recordId) {
    try {
      const persisted = await api('/api/invoices/' + recovered.recordId);
      if (persisted?.id && persisted.status === 'Draft') {
        history.replaceState({}, '', '/workspace/invoices/' + persisted.id + '/edit');
        clearInvoiceDraftSnapshot();
        await mountInvoiceWorkspace(persisted);
        toast('Restored your invoice draft after refresh.');
        return;
      }
    } catch {
      /* fall through to local snapshot recovery */
    }
  }
  const defaults = {
    issueDate: record?.issueDate || date(),
    dueDate: record?.dueDate || date(14),
    ...(record || {}),
  };
  document.body.insertAdjacentHTML(
    'beforeend',
    buildInvoiceWorkspaceHtml({
      profile: cache.businessProfile || {},
      customers: cache.customers,
      // Pass date-only defaults for create so customer select renders (edit requires record.id).
      record: record?.id ? defaults : { issueDate: defaults.issueDate, dueDate: defaults.dueDate },
    }),
  );
  const curtain = document.querySelector('[data-invoice-curtain]');
  const form = document.querySelector('#invoice-workspace-form');
  if (!form || !curtain) return;
  if (!record?.id) {
    form.querySelector('[name="issueDate"]').value = defaults.issueDate;
    form.querySelector('[name="endDate"]').value = defaults.dueDate;
    if (recovered) {
      applyInvoiceDraftSnapshot(form, recovered);
      toast('Restored unsaved invoice details from this browser session.');
    }
  } else {
    clearInvoiceDraftSnapshot();
  }
  bindInvoiceWorkspaceInteractions(form, { onToast: toast });
  updateCustomerPreview(form);
  form.addEventListener('change', (event) => {
    if (event.target.matches('[data-customer-select]')) updateCustomerPreview(form);
    scheduleInvoiceDraftSnapshot(form);
  });
  form.addEventListener('input', () => scheduleInvoiceDraftSnapshot(form));
  markDrawerFormPristine(form);
  refreshInvoiceWorkspaceTotals(form);
  await openInvoiceCurtain(curtain, {
    onOpened: () => {
      // Never yank focus if the user already started editing (title/description/etc.).
      const active = form.ownerDocument?.activeElement;
      if (active && form.contains(active) && isEditableTarget(active)) return;
      form.querySelector('[name="title"], [data-customer-select]')?.focus();
    },
  });
}

function closeInvoiceWorkspace({ force = false, animate = true } = {}) {
  const curtain = document.querySelector('[data-invoice-curtain]');
  if (!curtain) return Promise.resolve(true);
  if (!force && !confirmDiscardUnsavedDrawerWork()) return Promise.resolve(false);
  if (invoiceCurtainClosing) {
    return Promise.resolve(true);
  }
  invoiceCurtainClosing = true;
  return closeInvoiceCurtain(curtain, { animate }).finally(() => {
    invoiceCurtainClosing = false;
  });
}

async function persistInvoiceWorkspace(form, { stay = true, quiet = false, source = 'manual' } = {}) {
  const run = async () => {
    if (!form?.isConnected) {
      throw new Error('Invoice form is no longer available. Refresh and try again.');
    }
    // Capture values up front so a remount cannot empty the POST/PUT body mid-flight.
    const body = await collectInvoiceWorkspacePayload(form);
    if (!String(body.title || '').trim()) {
      const error = new Error('Invoice title is required.');
      error.status = 400;
      error.fieldPath = 'title';
      throw error;
    }
    const recordId = form.dataset.recordId;
    let saved;
    if (recordId) {
      const { customerId, ...invoiceBody } = body;
      saved = await api('/api/invoices/' + recordId, {
        method: 'PUT',
        body: JSON.stringify({
          ...invoiceBody,
          paymentState: form.dataset.paymentState || 'Draft',
        }),
      });
    } else {
      saved = await api('/api/invoices', { method: 'POST', body: JSON.stringify(body) });
    }
    // Prefer server truth (includes committed line items) for any remount/reload.
    if (!Array.isArray(saved.lineItems)) {
      saved = await api('/api/invoices/' + saved.id);
    }
    // Only mutate the live form/URL after success, and only if it is still mounted.
    if (form.isConnected) {
      form.dataset.recordId = saved.id;
      form.dataset.paymentState = saved.paymentState || 'Draft';
      form.dataset.status = saved.status || 'Draft';
      const number = form.querySelector('[data-invoice-number]');
      if (number) number.textContent = saved.invoiceNumber || 'Draft';
      markDrawerFormPristine(form);
      writeInvoiceDraftSnapshot(form, { recordId: saved.id });
    } else {
      // Keep recovery data if the DOM node was replaced mid-save.
      const previous = readInvoiceDraftSnapshot();
      if (previous) {
        try {
          localStorage.setItem(
            INVOICE_DRAFT_STORAGE_KEY,
            JSON.stringify({ ...previous, recordId: saved.id, title: previous.title || body.title }),
          );
        } catch {
          /* ignore quota / private mode */
        }
      }
    }
    invalidateWorkspaceCache();
    // Always bind the URL to the persisted id so refresh reloads from the database.
    history.replaceState({}, '', '/workspace/invoices/' + saved.id + '/edit');
    if (stay && !quiet) {
      toast(recordId ? 'Draft saved.' : 'Invoice draft created.');
    } else if (!stay && !quiet && source === 'manual') {
      /* caller shows toast for Save */
    }
    return saved;
  };

  const queued = invoicePersistQueue.then(async () => {
    invoicePersistActive = true;
    try {
      return await run();
    } finally {
      invoicePersistActive = false;
    }
  });
  // Keep the queue alive after failures so later saves still serialize.
  invoicePersistQueue = queued.catch(() => undefined);
  return queued;
}

async function requestCloseInvoiceWorkspace() {
  const closed = await closeInvoiceWorkspace({ force: false, animate: true });
  if (!closed) return false;
  if (invoiceAutosaveTimer) {
    clearTimeout(invoiceAutosaveTimer);
    invoiceAutosaveTimer = null;
  }
  clearInvoiceDraftSnapshot();
  history.pushState({}, '', '/workspace/invoices');
  invalidateWorkspaceCache();
  await renderRoute({ forceReload: true });
  return true;
}

async function previewInvoicePdf(id) {
  if (!isBusinessProfileReady(cache.businessProfile))
    throw new Error('Save your business name and address in Aleya Settings before generating PDFs.');
  let response = await fetch('/api/invoices/' + id + '/pdf', {
    headers: { authorization: 'Bearer ' + session.access_token },
  });
  if (response.status === 401 && (await refreshSession()))
    response = await fetch('/api/invoices/' + id + '/pdf', {
      headers: { authorization: 'Bearer ' + session.access_token },
    });
  if (!response.ok) throw new Error('The PDF could not be generated.');
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank', 'noopener,noreferrer');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function customerOptions(selected = '') {
  return cache.customers
    .map(
      (item) =>
        '<option value="' +
        item.id +
        '"' +
        (item.id === selected ? ' selected' : '') +
        '>' +
        escapeHtml(item.displayName) +
        '</option>',
    )
    .join('');
}

function lineRow(item = {}) {
  return (
    '<div class="line-row"><label>Description<input name="description" value="' +
    escapeHtml(item.description || '') +
    '" required></label><label>Qty<input name="quantity" type="number" min="0.01" step="0.01" value="' +
    escapeHtml(item.quantity ?? 1) +
    '" required></label><label>Unit price<input name="unitPrice" type="number" min="0" step="0.01" value="' +
    escapeHtml(item.unitPrice ?? 0) +
    '" required></label><label>GST<select name="gstApplicable"><option value="true"' +
    (item.gstApplicable !== false ? ' selected' : '') +
    '>Yes</option><option value="false"' +
    (item.gstApplicable === false ? ' selected' : '') +
    '>No</option></select></label><button class="icon-button remove-line" type="button" data-remove-line aria-label="Remove line">×</button></div>'
  );
}

function salesForm(kind, record = null, duplicate = false) {
  if (kind === 'invoice') {
    openInvoiceWorkspaceRoute(record && !duplicate ? record.id : null);
    return;
  }
  if (!cache.customers.length) {
    toast('Create a customer before creating a quote.', true);
    navigate('/workspace/customers');
    return;
  }
  const editing = Boolean(record && !duplicate);
  const title = editing
    ? 'Edit ' + record.quoteNumber
    : duplicate
      ? 'Duplicate ' + record.quoteNumber
      : 'New quote';
  const endDate = record?.expiryDate;
  const customerControl =
    '<select name="customerId" required><option value="">Select customer</option>' +
    customerOptions(record?.customerId) +
    '</select>';
  const statusControl = editing
    ? '<label>Status<select name="status">' +
      quoteStatuses
        .map(
          (status) =>
            '<option value="' +
            status +
            '"' +
            (record.status === status ? ' selected' : '') +
            '>' +
            status +
            '</option>',
        )
        .join('') +
      '</select></label>'
    : '';
  const lines = record?.lineItems?.length
    ? record.lineItems.map((item) => lineRow(item)).join('')
    : lineRow();
  drawer(
    title,
    '<form class="form" id="sales-form" data-kind="quote" data-record-id="' +
      (editing ? record.id : '') +
      '"><div class="form-grid"><label class="wide">Customer' +
      customerControl +
      '</label><label class="wide">Title<input name="title" value="' +
      escapeHtml(duplicate ? record.title + ' (copy)' : record?.title || '') +
      '" required></label><label>Issue date<input name="issueDate" type="date" value="' +
      escapeHtml(record?.issueDate || date()) +
      '" required></label><label>Valid until<input name="endDate" type="date" value="' +
      escapeHtml(endDate || date(14)) +
      '" required></label>' +
      statusControl +
      '<label class="wide">Payment terms<input name="paymentTerms" value="' +
      escapeHtml(record?.terms || '') +
      '"></label><label class="wide">Notes<textarea name="notes">' +
      escapeHtml(record?.notes || '') +
      '</textarea></label></div><div class="stack"><div class="panel-head"><h2>Line items</h2><button class="button secondary small" type="button" data-add-line>Add line</button></div><div class="line-items">' +
      lines +
      '</div></div><button class="button" type="submit">' +
      (editing ? 'Save changes' : 'Create quote draft') +
      '</button></form>',
  );
}

function paymentForm() {
  const rows = cache.report.accountsReceivable.invoices.filter((item) => item.outstanding > 0.0001);
  if (!rows.length) return toast('There are no outstanding final invoices to pay.', true);
  const options = rows
    .map((item) => {
      const invoice = cache.invoices.find((entry) => entry.id === item.invoiceId);
      const customer = cache.customers.find((entry) => entry.id === invoice?.customerId);
      return (
        '<option value="' +
        item.invoiceId +
        '" data-customer="' +
        (invoice?.customerId || '') +
        '" data-outstanding="' +
        item.outstanding +
        '">' +
        escapeHtml(
          item.invoiceNumber +
            ' · ' +
            (customer?.displayName || 'Customer') +
            ' · ' +
            money(item.outstanding),
        ) +
        '</option>'
      );
    })
    .join('');
  drawer(
    'Record payment',
    '<form class="form" id="payment-form"><label>Invoice<select name="invoiceId" required><option value="">Select outstanding invoice</option>' +
      options +
      '</select></label><label>Amount<input name="amount" type="number" min="0.01" step="0.01" required></label><label>Payment date<input name="paymentDate" type="date" value="' +
      date() +
      '" required></label><label>Method<select name="paymentMethod"><option>Bank transfer</option><option>Card</option><option>Cash</option><option>Other</option></select></label><label>Reference<input name="reference" required></label><label>Notes<textarea name="notes"></textarea></label><div class="notice success" id="payment-balance">Choose an invoice to see its outstanding balance.</div><button class="button" type="submit">Record and allocate payment</button></form>',
  );
}

function customerForm(customer = null) {
  drawer(
    customer ? 'Edit customer' : 'New customer',
    '<form class="form" id="customer-form" data-record-id="' +
      (customer?.id || '') +
      '"><label>Customer or business name<input name="displayName" value="' +
      escapeHtml(customer?.displayName || '') +
      '" required></label><div class="form-grid"><label>Email<input name="email" type="email" value="' +
      escapeHtml(customer?.email || '') +
      '"></label><label>Phone<input name="phone" value="' +
      escapeHtml(customer?.phone || '') +
      '"></label><label>ABN / Tax ID<input name="abnTaxId" value="' +
      escapeHtml(customer?.abnTaxId || '') +
      '"></label><label>Address<input name="address" value="' +
      escapeHtml(customer?.address || '') +
      '"></label><label class="wide">Notes<textarea name="notes">' +
      escapeHtml(customer?.notes || '') +
      '</textarea></label></div><button class="button" type="submit">' +
      (customer ? 'Save customer' : 'Create customer') +
      '</button></form>',
  );
}

function lineItemsTable(items) {
  return (
    '<div class="table-wrap"><table><thead><tr><th>Description</th><th>Qty</th><th>Unit</th><th>GST</th></tr></thead><tbody>' +
    items
      .map(
        (item) =>
          '<tr><td>' +
          escapeHtml(item.description) +
          '</td><td>' +
          item.quantity +
          '</td><td>' +
          money(item.unitPrice) +
          '</td><td>' +
          (item.gstApplicable ? 'Yes' : 'No') +
          '</td></tr>',
      )
      .join('') +
    '</tbody></table></div>'
  );
}

async function customerDetails(id) {
  const customer = await api('/api/customers/' + id);
  const invoices = cache.invoices.filter((invoice) => invoice.customerId === id);
  const rows = invoices
    .map((invoice) => {
      const view = invoiceView(invoice);
      return (
        '<tr><td class="primary-cell">' +
        escapeHtml(invoice.invoiceNumber || 'Draft') +
        '</td><td>' +
        readableDate(invoice.issueDate) +
        '</td><td>' +
        money(invoice.totals.total) +
        '</td><td>' +
        money(view.outstanding) +
        '</td><td><button class="button ghost small" data-view-invoice="' +
        invoice.id +
        '">View</button></td></tr>'
      );
    })
    .join('');
  drawer(
    customer.displayName,
    '<div class="detail-grid"><div><span>Email</span><strong>' +
      escapeHtml(customer.email || '—') +
      '</strong></div><div><span>Phone</span><strong>' +
      escapeHtml(customer.phone || '—') +
      '</strong></div><div><span>ABN / Tax ID</span><strong>' +
      escapeHtml(customer.abnTaxId || '—') +
      '</strong></div><div><span>Outstanding</span><strong>' +
      money(customerBalance(id)) +
      '</strong></div><div class="wide"><span>Address</span><strong>' +
      escapeHtml(customer.address || '—') +
      '</strong></div><div class="wide"><span>Notes</span><strong>' +
      escapeHtml(customer.notes || '—') +
      '</strong></div></div><div class="drawer-actions"><button class="button" data-edit-customer="' +
      id +
      '">Edit customer</button><button class="button danger" data-delete-customer="' +
      id +
      '" data-name="' +
      escapeHtml(customer.displayName) +
      '">Delete customer</button><button class="button ghost" data-timeline="customer" data-id="' +
      id +
      '">Audit timeline</button></div><section class="panel section-gap"><header class="panel-head"><h2>Invoice history</h2></header>' +
      (rows
        ? '<div class="table-wrap"><table><thead><tr><th>Invoice</th><th>Issued</th><th>Total</th><th>Outstanding</th><th></th></tr></thead><tbody>' +
          rows +
          '</tbody></table></div>'
        : empty('invoices')) +
      '</section>',
  );
}

async function quoteDetails(id) {
  const quote = await api('/api/quotes/' + id);
  const customer = cache.customers.find((item) => item.id === quote.customerId);
  drawer(
    quote.quoteNumber,
    '<div class="detail-grid"><div><span>Customer</span><strong>' +
      escapeHtml(customer?.displayName || 'Customer') +
      '</strong></div><div><span>Status</span><strong>' +
      escapeHtml(quote.status) +
      '</strong></div><div><span>Issue date</span><strong>' +
      readableDate(quote.issueDate) +
      '</strong></div><div><span>Expires</span><strong>' +
      readableDate(quote.expiryDate) +
      '</strong></div><div><span>Total</span><strong>' +
      money(quote.totals.total) +
      '</strong></div><div><span>Converted invoice</span><strong>' +
      escapeHtml(
        cache.invoices.find((item) => item.id === quote.convertedInvoiceId)?.invoiceNumber || '—',
      ) +
      '</strong></div><div class="wide"><span>Notes</span><strong>' +
      escapeHtml(quote.notes || '—') +
      '</strong></div></div><section class="panel section-gap"><header class="panel-head"><h2>Line items</h2></header>' +
      lineItemsTable(quote.lineItems) +
      '</section><div class="drawer-actions"><button class="button secondary" data-pdf="quote" data-id="' +
      id +
      '">Download PDF</button>' +
      (quote.status !== 'Converted'
        ? '<button class="button ghost" data-edit-quote="' + id + '">Edit quote</button>'
        : '') +
      '<button class="button ghost" data-duplicate-quote="' +
      id +
      '">Duplicate</button><button class="button ghost" data-timeline="quote" data-id="' +
      id +
      '">Audit timeline</button></div>',
  );
}

async function invoiceDetails(id) {
  const invoice = await api('/api/invoices/' + id);
  const customer = cache.customers.find((item) => item.id === invoice.customerId);
  const view = invoiceView(invoice);
  const payments = invoicePayments(id);
  const paymentRows = payments
    .map(
      (payment) =>
        '<tr><td class="primary-cell">' +
        escapeHtml(payment.paymentNumber) +
        '</td><td>' +
        readableDate(payment.paymentDate) +
        '</td><td>' +
        escapeHtml(payment.paymentMethod) +
        '</td><td>' +
        money(payment.allocations.find((allocation) => allocation.invoiceId === id)?.amount || 0) +
        '</td><td><button class="button ghost small" data-view-payment="' +
        payment.id +
        '">View</button></td></tr>',
    )
    .join('');
  drawer(
    invoice.invoiceNumber || 'Invoice draft',
    '<div class="detail-grid"><div><span>Customer</span><strong>' +
      escapeHtml(customer?.displayName || 'Customer') +
      '</strong></div><div><span>State</span><strong>' +
      escapeHtml(view.state) +
      '</strong></div><div><span>Issued</span><strong>' +
      readableDate(invoice.issueDate) +
      '</strong></div><div><span>Due</span><strong>' +
      readableDate(invoice.dueDate) +
      '</strong></div><div><span>Source quote</span><strong>' +
      escapeHtml(invoice.sourceQuoteNumber || 'Direct invoice') +
      '</strong></div><div><span>Total</span><strong>' +
      money(invoice.totals.total) +
      '</strong></div><div><span>Paid</span><strong>' +
      money(view.paid) +
      '</strong></div><div><span>Remaining</span><strong>' +
      money(view.outstanding) +
      '</strong></div><div class="wide"><span>Notes</span><strong>' +
      escapeHtml(invoice.notes || '—') +
      '</strong></div></div><section class="panel section-gap"><header class="panel-head"><h2>Line items</h2></header>' +
      lineItemsTable(invoice.lineItems) +
      '</section><section class="panel section-gap"><header class="panel-head"><h2>Payment history</h2></header>' +
      (paymentRows
        ? '<div class="table-wrap"><table><thead><tr><th>Payment</th><th>Date</th><th>Method</th><th>Allocated</th><th></th></tr></thead><tbody>' +
          paymentRows +
          '</tbody></table></div>'
        : empty('payments')) +
      '</section><div class="drawer-actions">' +
      (invoice.status === 'Draft'
        ? '<button class="button" data-edit-invoice="' +
          id +
          '">Edit draft</button><button class="button" data-finalise-invoice="' +
          id +
          '">Issue invoice</button>'
        : '<button class="button secondary" data-pdf="invoice" data-id="' +
          id +
          '">Download PDF</button>') +
      '<button class="button ghost" data-timeline="invoice" data-id="' +
      id +
      '">Audit timeline</button></div>',
  );
}

async function paymentDetails(id) {
  const payment = await api('/api/payments/' + id);
  const customer = cache.customers.find((item) => item.id === payment.customerId);
  const allocations = payment.allocations
    .map((allocation) => {
      const invoice = cache.invoices.find((item) => item.id === allocation.invoiceId);
      return (
        '<tr><td class="primary-cell">' +
        escapeHtml(invoice?.invoiceNumber || 'Invoice') +
        '</td><td>' +
        money(allocation.amount) +
        '</td><td><button class="button ghost small" data-view-invoice="' +
        allocation.invoiceId +
        '">View</button></td></tr>'
      );
    })
    .join('');
  drawer(
    payment.paymentNumber,
    '<div class="detail-grid"><div><span>Customer</span><strong>' +
      escapeHtml(customer?.displayName || 'Customer') +
      '</strong></div><div><span>Date</span><strong>' +
      readableDate(payment.paymentDate) +
      '</strong></div><div><span>Method</span><strong>' +
      escapeHtml(payment.paymentMethod) +
      '</strong></div><div><span>Reference</span><strong>' +
      escapeHtml(payment.reference) +
      '</strong></div><div><span>Amount</span><strong>' +
      money(payment.amount) +
      '</strong></div><div class="wide"><span>Notes</span><strong>' +
      escapeHtml(payment.notes || '—') +
      '</strong></div></div><section class="panel section-gap"><header class="panel-head"><h2>Allocations</h2></header><div class="table-wrap"><table><thead><tr><th>Invoice</th><th>Amount</th><th></th></tr></thead><tbody>' +
      allocations +
      '</tbody></table></div></section><div class="drawer-actions"><button class="button secondary" data-pdf="payment" data-id="' +
      id +
      '">Download receipt</button><button class="button ghost" data-timeline="payment" data-id="' +
      id +
      '">Audit timeline</button></div>',
  );
}

async function openTimeline(type, id) {
  const result = await api(
    '/api/timeline/' + encodeURIComponent(type) + '/' + encodeURIComponent(id) + '?limit=200',
  );
  const events = [...result.events]
    .reverse()
    .map((event) => {
      const summary = safeEventSummary(event);
      return (
        '<article class="timeline-event"><time>' +
        readableTime(event.createdAt || event.created_at) +
        '</time><div><strong>' +
        escapeHtml(summary.title) +
        '</strong><p>' +
        escapeHtml(summary.detail || 'Recorded by the application audit ledger.') +
        '</p></div></article>'
      );
    })
    .join('');
  drawer(
    'Audit timeline',
    events ? '<div class="timeline-list">' + events + '</div>' : empty('audit events'),
  );
}

async function updateQuoteStatus(id, status) {
  await api('/api/quotes/' + id + '/status', {
    method: 'POST',
    body: JSON.stringify({ status }),
  });
}

async function downloadDocument(type, id) {
  if (!isBusinessProfileReady(cache.businessProfile))
    throw new Error('Save your business name and address in Aleya Settings before generating PDFs.');
  const endpoints = {
    quote: '/api/quotes/' + id + '/pdf',
    invoice: '/api/invoices/' + id + '/pdf',
    payment: '/api/payments/' + id + '/pdf',
  };
  let response = await fetch(endpoints[type], {
    headers: { authorization: 'Bearer ' + session.access_token },
  });
  if (response.status === 401 && (await refreshSession()))
    response = await fetch(endpoints[type], {
      headers: { authorization: 'Bearer ' + session.access_token },
    });
  if (!response.ok) throw new Error('The PDF could not be generated.');
  const blob = await response.blob();
  const disposition = response.headers.get('content-disposition') || '';
  const name = disposition.match(/filename="?([^";]+)"?/)?.[1] || type + '.pdf';
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return name;
}

async function inventoryPage() {
  const [productsRes, alertsRes, reports] = await Promise.all([
    api('/api/products?limit=500'),
    api('/api/inventory/alerts'),
    api('/api/inventory/reports'),
  ]);
  const products = productsRes.products || [];
  const alerts = alertsRes.alerts || [];
  const rows = products
    .map((product) => {
      const stock = product.stock || {};
      return (
        '<tr><td><strong>' +
        escapeHtml(product.name) +
        '</strong><div class="muted">' +
        escapeHtml(product.sku) +
        (product.barcode ? ' · ' + escapeHtml(product.barcode) : '') +
        '</div></td><td>' +
        escapeHtml(product.category || '—') +
        '</td><td>' +
        money(product.sellPrice) +
        '</td><td>' +
        Number(stock.available ?? 0) +
        ' <span class="muted">/ ' +
        Number(stock.onHand ?? 0) +
        '</span></td><td>' +
        Number(product.minimumStockLevel || 0) +
        '</td><td><button class="button ghost small" data-inv-view="' +
        product.id +
        '">Open</button></td></tr>'
      );
    })
    .join('');
  const alertCards = alerts.length
    ? alerts
        .slice(0, 8)
        .map(
          (alert) =>
            '<article class="inventory-alert"><strong>' +
            escapeHtml(alert.kind.replaceAll('_', ' ')) +
            '</strong><p>' +
            escapeHtml(alert.message) +
            '</p>' +
            (alert.suggestedReorderQuantity != null
              ? '<span>Reorder ' + alert.suggestedReorderQuantity + '</span>'
              : '') +
            '</article>',
        )
        .join('')
    : '<p class="muted">No open stock alerts.</p>';
  shell(
    '<main class="page inventory-page">' +
      pageHead(
        'Inventory',
        'Stock control',
        'Catalogue, barcodes, low-stock intelligence, and movements linked to purchasing and invoices.',
        '<button class="button" data-inv-new>New product</button><button class="button secondary" data-inv-scan>Scan barcode</button>',
      ) +
      '<section class="panel section-gap"><header class="panel-head"><h2>Alerts</h2><button class="button ghost small" data-inv-refresh-alerts>Refresh</button></header><div class="inventory-alert-grid">' +
      alertCards +
      '</div></section>' +
      '<section class="panel section-gap"><header class="panel-head"><h2>Products</h2><span class="muted">' +
      products.length +
      ' items · valuation ' +
      money(
        (reports.stockValuation || []).reduce((sum, row) => sum + Number(row.valuation || 0), 0),
      ) +
      '</span></header><div class="table-wrap"><table><thead><tr><th>Product</th><th>Category</th><th>Sell</th><th>Available / On hand</th><th>Min</th><th></th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="6">' + empty('products') + '</td></tr>') +
      '</tbody></table></div></section></main>',
  );
  document.querySelector('[data-inv-new]')?.addEventListener('click', () => openProductForm());
  document.querySelector('[data-inv-scan]')?.addEventListener('click', () => openBarcodeScanner());
  document.querySelector('[data-inv-refresh-alerts]')?.addEventListener('click', async () => {
    await api('/api/inventory/alerts/refresh', { method: 'POST', body: '{}' });
    await inventoryPage();
  });
  document.querySelectorAll('[data-inv-view]').forEach((button) => {
    button.addEventListener('click', () => openProductDetail(button.getAttribute('data-inv-view')));
  });
}

function openProductForm(product = null) {
  drawer(
    product ? 'Edit product' : 'New product',
    '<form class="stack-form" data-product-form>' +
      '<label>SKU<input name="sku" required value="' +
      escapeHtml(product?.sku || '') +
      '"></label>' +
      '<label>Name<input name="name" required value="' +
      escapeHtml(product?.name || '') +
      '"></label>' +
      '<label>Barcode<input name="barcode" value="' +
      escapeHtml(product?.barcode || '') +
      '" placeholder="USB scanner or type"></label>' +
      '<label>Category<input name="category" value="' +
      escapeHtml(product?.category || '') +
      '"></label>' +
      '<div class="form-grid-2"><label>Cost<input name="costPrice" type="number" min="0" step="0.01" value="' +
      (product?.costPrice ?? 0) +
      '"></label><label>Sell<input name="sellPrice" type="number" min="0" step="0.01" value="' +
      (product?.sellPrice ?? 0) +
      '"></label></div>' +
      '<div class="form-grid-2"><label>Min stock<input name="minimumStockLevel" type="number" min="0" step="1" value="' +
      (product?.minimumStockLevel ?? 0) +
      '"></label><label>Reorder qty<input name="reorderQuantity" type="number" min="0" step="1" value="' +
      (product?.reorderQuantity ?? 0) +
      '"></label></div>' +
      (!product
        ? '<label>Opening stock<input name="openingStock" type="number" min="0" step="1" value="0"></label>'
        : '') +
      '<label>Notes<textarea name="notes" rows="3">' +
      escapeHtml(product?.notes || '') +
      '</textarea></label>' +
      '<div class="drawer-actions"><button class="button" type="submit">Save product</button></div></form>',
  );
  document.querySelector('[data-product-form]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload = {
      sku: String(form.get('sku') || '').trim(),
      name: String(form.get('name') || '').trim(),
      barcode: String(form.get('barcode') || '').trim() || null,
      category: String(form.get('category') || '').trim() || null,
      costPrice: Number(form.get('costPrice') || 0),
      sellPrice: Number(form.get('sellPrice') || 0),
      minimumStockLevel: Number(form.get('minimumStockLevel') || 0),
      reorderQuantity: Number(form.get('reorderQuantity') || 0),
      notes: String(form.get('notes') || '').trim() || null,
      trackStock: true,
      gstStatus: 'gst',
    };
    if (!product) payload.openingStock = Number(form.get('openingStock') || 0);
    if (product) await api('/api/products/' + product.id, { method: 'PUT', body: JSON.stringify(payload) });
    else await api('/api/products', { method: 'POST', body: JSON.stringify(payload) });
    closeDrawer();
    await inventoryPage();
  });
}

async function openProductDetail(id) {
  const product = await api('/api/products/' + id);
  const movements = await api('/api/inventory/movements?productId=' + encodeURIComponent(id) + '&limit=20');
  const stock = product.stock || {};
  drawer(
    product.name,
    '<div class="detail-grid"><div><span>SKU</span><strong>' +
      escapeHtml(product.sku) +
      '</strong></div><div><span>Barcode</span><strong>' +
      escapeHtml(product.barcode || '—') +
      '</strong></div><div><span>Available</span><strong>' +
      Number(stock.available || 0) +
      '</strong></div><div><span>On hand</span><strong>' +
      Number(stock.onHand || 0) +
      '</strong></div><div><span>Incoming</span><strong>' +
      Number(stock.incoming || 0) +
      '</strong></div><div><span>Margin</span><strong>' +
      product.profitMargin +
      '%</strong></div></div>' +
      '<div class="form-actions"><a class="button secondary small" href="/api/products/' +
      product.id +
      '/barcode.svg" target="_blank" rel="noreferrer">Barcode</a><a class="button secondary small" href="/api/products/' +
      product.id +
      '/qr.svg" target="_blank" rel="noreferrer">QR</a><button class="button small" data-adj>Adjust stock</button><button class="button ghost small" data-edit>Edit</button><button class="button ghost small" data-archive>Archive</button></div>' +
      '<section class="section-gap"><h3>Recent movements</h3><div class="table-wrap"><table><thead><tr><th>When</th><th>Type</th><th>Qty</th></tr></thead><tbody>' +
      (movements.movements || [])
        .map(
          (movement) =>
            '<tr><td>' +
            readableTime(movement.createdAt) +
            '</td><td>' +
            escapeHtml(movement.movementType) +
            '</td><td>' +
            movement.quantityDelta +
            '</td></tr>',
        )
        .join('') +
      '</tbody></table></div></section>',
  );
  document.querySelector('[data-edit]')?.addEventListener('click', () => openProductForm(product));
  document.querySelector('[data-archive]')?.addEventListener('click', async () => {
    await api('/api/products/' + product.id + '/archive', { method: 'POST', body: '{}' });
    closeDrawer();
    await inventoryPage();
  });
  document.querySelector('[data-adj]')?.addEventListener('click', async () => {
    const raw = prompt('Adjustment quantity (+/-)', '1');
    if (raw == null || raw === '') return;
    const quantityDelta = Number(raw);
    if (!Number.isFinite(quantityDelta) || quantityDelta === 0) return;
    await api('/api/inventory/adjust', {
      method: 'POST',
      body: JSON.stringify({ productId: product.id, quantityDelta, notes: 'Manual adjustment' }),
    });
    await openProductDetail(product.id);
  });
}

function openBarcodeScanner() {
  drawer(
    'Scan barcode',
    '<p class="muted">Use a USB scanner (keyboard wedge) or type/paste a barcode, SKU, or QR payload. On supported mobile browsers, camera scanning is attempted automatically.</p>' +
      '<form class="stack-form" data-scan-form><label>Code<input name="code" autofocus autocomplete="off" required placeholder="Scan or type code"></label>' +
      '<div class="drawer-actions"><button class="button" type="submit">Find product</button></div></form>' +
      '<video data-scan-video playsinline style="display:none;width:100%;border-radius:12px;margin-top:12px;background:#111"></video>' +
      '<div data-scan-result class="section-gap"></div>',
  );
  const form = document.querySelector('[data-scan-form]');
  const result = document.querySelector('[data-scan-result]');
  const video = document.querySelector('[data-scan-video]');
  async function lookup(code) {
    try {
      const product = await api('/api/products/lookup?code=' + encodeURIComponent(code));
      result.innerHTML =
        '<div class="notice success"><strong>' +
        escapeHtml(product.name) +
        '</strong><br>SKU ' +
        escapeHtml(product.sku) +
        ' · Available ' +
        Number(product.stock?.available || 0) +
        '</div><button class="button small" data-open-found>Open product</button>';
      result.querySelector('[data-open-found]')?.addEventListener('click', () => openProductDetail(product.id));
    } catch {
      result.innerHTML = '<div class="notice"><strong>No match</strong><br>No product found for that code.</div>';
    }
  }
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const code = String(new FormData(event.currentTarget).get('code') || '').trim();
    if (code) await lookup(code);
  });
  if (typeof BarcodeDetector !== 'undefined' && navigator.mediaDevices?.getUserMedia) {
    const detector = new BarcodeDetector({ formats: ['qr_code', 'ean_13', 'code_128', 'code_39'] });
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' } })
      .then((stream) => {
        video.style.display = 'block';
        video.srcObject = stream;
        void video.play();
        const timer = setInterval(async () => {
          try {
            const codes = await detector.detect(video);
            if (codes[0]?.rawValue) {
              clearInterval(timer);
              stream.getTracks().forEach((track) => track.stop());
              form.querySelector('input[name="code"]').value = codes[0].rawValue;
              await lookup(codes[0].rawValue);
            }
          } catch {
            /* ignore frame errors */
          }
        }, 700);
      })
      .catch(() => {
        /* camera optional */
      });
  }
}

async function purchaseOrdersPage() {
  const [ordersRes, suppliersRes, productsRes] = await Promise.all([
    api('/api/purchase-orders'),
    api('/api/suppliers'),
    api('/api/products?limit=500'),
  ]);
  const orders = ordersRes.purchaseOrders || [];
  const suppliers = suppliersRes.suppliers || [];
  const products = productsRes.products || [];
  const rows = orders
    .map((order) => {
      return (
        '<tr><td><strong>' +
        escapeHtml(order.purchaseOrderNumber) +
        '</strong></td><td>' +
        escapeHtml(order.status) +
        '</td><td>' +
        escapeHtml(order.billingStatus || '—') +
        '</td><td>' +
        money(order.totals?.total || 0) +
        '</td><td><button class="button ghost small" data-po-open="' +
        order.id +
        '">Open</button></td></tr>'
      );
    })
    .join('');
  shell(
    '<main class="page">' +
      pageHead(
        'Purchasing',
        'Purchase orders',
        'Create drafts, send to suppliers, and receive stock into inventory.',
        '<button class="button" data-po-new>New purchase order</button>',
      ) +
      '<section class="panel"><div class="table-wrap"><table><thead><tr><th>Number</th><th>Status</th><th>Billing</th><th>Total</th><th></th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="5">' + empty('purchase orders') + '</td></tr>') +
      '</tbody></table></div></section></main>',
  );
  document.querySelector('[data-po-new]')?.addEventListener('click', () => {
    const supplierOptions = suppliers
      .map((supplier) => '<option value="' + supplier.id + '">' + escapeHtml(supplier.displayName) + '</option>')
      .join('');
    const productOptions = products
      .map(
        (product) =>
          '<option value="' +
          product.id +
          '" data-name="' +
          escapeHtml(product.name) +
          '" data-cost="' +
          product.costPrice +
          '">' +
          escapeHtml(product.sku + ' · ' + product.name) +
          '</option>',
      )
      .join('');
    drawer(
      'New purchase order',
      '<form class="stack-form" data-po-form><label>Supplier<select name="supplierId" required>' +
        supplierOptions +
        '</select></label><label>Issue date<input type="date" name="issueDate" required value="' +
        date() +
        '"></label><label>Product<select name="productId">' +
        '<option value="">Free-text line</option>' +
        productOptions +
        '</select></label><label>Description<input name="description" required value="Materials"></label><div class="form-grid-2"><label>Qty<input type="number" min="0.01" step="0.01" name="quantity" value="1" required></label><label>Unit price<input type="number" min="0" step="0.01" name="unitPrice" value="0" required></label></div><div class="drawer-actions"><button class="button" type="submit">Create draft</button></div></form>',
    );
    const form = document.querySelector('[data-po-form]');
    form?.querySelector('[name="productId"]')?.addEventListener('change', (event) => {
      const option = event.target.selectedOptions[0];
      if (!option?.value) return;
      form.querySelector('[name="description"]').value = option.getAttribute('data-name') || '';
      form.querySelector('[name="unitPrice"]').value = option.getAttribute('data-cost') || '0';
    });
    form?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      const productId = String(data.get('productId') || '') || null;
      await api('/api/purchase-orders', {
        method: 'POST',
        body: JSON.stringify({
          supplierId: String(data.get('supplierId')),
          issueDate: String(data.get('issueDate')),
          currency: 'AUD',
          lineItems: [
            {
              description: String(data.get('description')),
              quantity: Number(data.get('quantity')),
              unitPrice: Number(data.get('unitPrice')),
              gstApplicable: true,
              productId,
            },
          ],
        }),
      });
      closeDrawer();
      await purchaseOrdersPage();
    });
  });
  document.querySelectorAll('[data-po-open]').forEach((button) => {
    button.addEventListener('click', async () => {
      const order = await api('/api/purchase-orders/' + button.getAttribute('data-po-open'));
      const receipt = await api('/api/purchase-orders/' + order.id + '/receipt-status').catch(() => ({
        receiptStatus: 'unordered',
      }));
      const lines = (order.lineItems || [])
        .map(
          (line) =>
            '<tr><td>' +
            escapeHtml(line.description) +
            '</td><td>' +
            line.quantity +
            '</td><td>' +
            Number(line.quantityReceived || 0) +
            '</td><td>' +
            money(line.unitPrice) +
            '</td></tr>',
        )
        .join('');
      drawer(
        order.purchaseOrderNumber,
        '<div class="detail-grid"><div><span>Status</span><strong>' +
          escapeHtml(order.status) +
          '</strong></div><div><span>Receipt</span><strong>' +
          escapeHtml(receipt.receiptStatus || '—') +
          '</strong></div><div><span>Total</span><strong>' +
          money(order.totals?.total || 0) +
          '</strong></div></div><div class="form-actions">' +
          (order.status === 'Draft'
            ? '<button class="button small" data-approve>Send / Approve</button>'
            : '') +
          (order.status === 'Approved'
            ? '<button class="button small" data-receive>Receive goods</button>'
            : '') +
          '</div><div class="table-wrap section-gap"><table><thead><tr><th>Line</th><th>Ordered</th><th>Received</th><th>Price</th></tr></thead><tbody>' +
          lines +
          '</tbody></table></div>',
      );
      document.querySelector('[data-approve]')?.addEventListener('click', async () => {
        await api('/api/purchase-orders/' + order.id + '/approve', { method: 'POST', body: '{}' });
        closeDrawer();
        await purchaseOrdersPage();
      });
      document.querySelector('[data-receive]')?.addEventListener('click', async () => {
        const payload = {
          lineItems: (order.lineItems || []).map((line) => ({
            purchaseOrderLineItemId: line.id,
            quantityReceived: Math.max(0, Number(line.quantity) - Number(line.quantityReceived || 0)) || Number(line.quantity),
            productId: line.productId || undefined,
          })).filter((line) => line.quantityReceived > 0),
        };
        if (!payload.lineItems.length) {
          alert('Nothing outstanding to receive.');
          return;
        }
        await api('/api/purchase-orders/' + order.id + '/receive', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        closeDrawer();
        await purchaseOrdersPage();
      });
    });
  });
}

async function suppliersPage() {
  const suppliersRes = await api('/api/suppliers');
  const suppliers = suppliersRes.suppliers || [];
  const rows = suppliers
    .map(
      (supplier) =>
        '<tr><td><strong>' +
        escapeHtml(supplier.displayName) +
        '</strong><div class="muted">' +
        escapeHtml(supplier.contactPerson || supplier.email || '—') +
        '</div></td><td>' +
        escapeHtml(supplier.phone || '—') +
        '</td><td>' +
        escapeHtml(supplier.paymentTerms || '—') +
        '</td><td>' +
        escapeHtml(supplier.taxId || '—') +
        '</td></tr>',
    )
    .join('');
  shell(
    '<main class="page">' +
      pageHead(
        'Suppliers',
        'Supplier directory',
        'Contacts, payment terms, and purchasing history for inventory replenishment.',
        '<button class="button" data-sup-new>New supplier</button>',
      ) +
      '<section class="panel"><div class="table-wrap"><table><thead><tr><th>Supplier</th><th>Phone</th><th>Terms</th><th>ABN</th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="4">' + empty('suppliers') + '</td></tr>') +
      '</tbody></table></div></section></main>',
  );
  document.querySelector('[data-sup-new]')?.addEventListener('click', () => {
    drawer(
      'New supplier',
      '<form class="stack-form" data-sup-form><label>Company<input name="displayName" required></label><label>Contact person<input name="contactPerson"></label><label>Email<input name="email" type="email"></label><label>Phone<input name="phone"></label><label>Website<input name="website" type="url" placeholder="https://"></label><label>ABN<input name="taxId"></label><label>Payment terms<input name="paymentTerms" placeholder="Net 30"></label><label>Notes<textarea name="notes" rows="3"></textarea></label><div class="drawer-actions"><button class="button" type="submit">Save</button></div></form>',
    );
    document.querySelector('[data-sup-form]')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      const payload = {
        displayName: String(data.get('displayName') || '').trim(),
      };
      for (const key of ['contactPerson', 'email', 'phone', 'website', 'taxId', 'paymentTerms', 'notes']) {
        const value = String(data.get(key) || '').trim();
        if (value) payload[key] = value;
      }
      await api('/api/suppliers', { method: 'POST', body: JSON.stringify(payload) });
      closeDrawer();
      await suppliersPage();
    });
  });
}

async function stocktakesPage() {
  const stocktakesRes = await api('/api/stocktakes');
  const stocktakes = stocktakesRes.stocktakes || [];
  const rows = stocktakes
    .map(
      (stocktake) =>
        '<tr><td><strong>' +
        escapeHtml(stocktake.stocktakeNumber) +
        '</strong></td><td>' +
        escapeHtml(stocktake.type) +
        '</td><td>' +
        escapeHtml(stocktake.status) +
        '</td><td><button class="button ghost small" data-stk="' +
        stocktake.id +
        '">Open</button></td></tr>',
    )
    .join('');
  shell(
    '<main class="page">' +
      pageHead(
        'Stocktakes',
        'Count & reconcile',
        'Full, partial, and cycle counts with variance approval and adjustment history.',
        '<button class="button" data-stk-new>Start stocktake</button>',
      ) +
      '<section class="panel"><div class="table-wrap"><table><thead><tr><th>Number</th><th>Type</th><th>Status</th><th></th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="4">' + empty('stocktakes') + '</td></tr>') +
      '</tbody></table></div></section></main>',
  );
  document.querySelector('[data-stk-new]')?.addEventListener('click', async () => {
    await api('/api/stocktakes', { method: 'POST', body: JSON.stringify({ type: 'full' }) });
    await stocktakesPage();
  });
  document.querySelectorAll('[data-stk]').forEach((button) => {
    button.addEventListener('click', async () => {
      const stocktake = await api('/api/stocktakes/' + button.getAttribute('data-stk'));
      const lines = (stocktake.lines || [])
        .map(
          (line) =>
            '<tr><td>' +
            escapeHtml(line.productId.slice(0, 8)) +
            '</td><td>' +
            line.expectedQuantity +
            '</td><td><input data-count="' +
            line.productId +
            '" type="number" min="0" step="1" value="' +
            (line.countedQuantity ?? line.expectedQuantity) +
            '"></td><td>' +
            (line.variance == null ? '—' : line.variance) +
            '</td></tr>',
        )
        .join('');
      drawer(
        stocktake.stocktakeNumber,
        '<p class="muted">' +
          escapeHtml(stocktake.type) +
          ' · ' +
          escapeHtml(stocktake.status) +
          '</p><div class="table-wrap"><table><thead><tr><th>Product</th><th>Expected</th><th>Counted</th><th>Variance</th></tr></thead><tbody>' +
          lines +
          '</tbody></table></div><div class="form-actions section-gap"><button class="button secondary small" data-save-counts>Save counts</button>' +
          (stocktake.status === 'In Progress' || stocktake.status === 'Draft'
            ? '<button class="button small" data-submit-stk>Submit</button>'
            : '') +
          (stocktake.status === 'Submitted'
            ? '<button class="button small" data-approve-stk>Approve adjustments</button>'
            : '') +
          '</div>',
      );
      document.querySelector('[data-save-counts]')?.addEventListener('click', async () => {
        const countLines = [...document.querySelectorAll('[data-count]')].map((input) => ({
          productId: input.getAttribute('data-count'),
          countedQuantity: Number(input.value || 0),
        }));
        await api('/api/stocktakes/' + stocktake.id + '/counts', {
          method: 'PUT',
          body: JSON.stringify({ lines: countLines }),
        });
        await stocktakesPage();
      });
      document.querySelector('[data-submit-stk]')?.addEventListener('click', async () => {
        await api('/api/stocktakes/' + stocktake.id + '/submit', { method: 'POST', body: '{}' });
        closeDrawer();
        await stocktakesPage();
      });
      document.querySelector('[data-approve-stk]')?.addEventListener('click', async () => {
        await api('/api/stocktakes/' + stocktake.id + '/approve', {
          method: 'POST',
          body: JSON.stringify({ approvedBy: currentUser?.displayName || currentUser?.email || 'owner' }),
        });
        closeDrawer();
        await stocktakesPage();
      });
    });
  });
}

async function renderRoute({ forceReload = false } = {}) {
  if (!currentUser) return;
  const path = location.pathname === '/' ? '/dashboard' : location.pathname;
  const invoiceRoute = parseInvoiceWorkspacePath(path);
  const warm =
    !forceReload &&
    workspaceCacheAt &&
    Date.now() - workspaceCacheAt < WORKSPACE_CACHE_TTL_MS &&
    Array.isArray(cache.customers) &&
    Boolean(document.querySelector('.app-shell'));
  if (!warm) {
    root.innerHTML =
      '<main class="boot"><span class="brand-mark">A</span><p>Loading live workspace…</p></main>';
  }
  try {
    await loadWorkspace({ force: forceReload });
    if (invoiceRoute) {
      invoicesPage();
      if (invoiceRoute.mode === 'create') await mountInvoiceWorkspace(null);
      else {
        const invoice = await api('/api/invoices/' + invoiceRoute.id);
        await mountInvoiceWorkspace(invoice);
      }
      return;
    }
    document.querySelector('[data-invoice-curtain]')?.remove();
    if (path === '/dashboard') dashboardPage();
    else if (path === '/workspace/customers') customersPage();
    else if (path === '/workspace/quotes') quotesPage();
    else if (path === '/workspace/invoices') invoicesPage();
    else if (path === '/workspace/payments') paymentsPage();
    else if (path === '/workspace/inventory') await inventoryPage();
    else if (path === '/workspace/purchase-orders') await purchaseOrdersPage();
    else if (path === '/workspace/suppliers') await suppliersPage();
    else if (path === '/workspace/stocktakes') await stocktakesPage();
    else if (path === '/reports') reportsPage();
    else if (path === '/timeline') await timelinePage();
    else if (path === '/settings') settingsPage();
    else if (path === '/logo-creator') await logoCreatorPage();
    else {
      history.replaceState({}, '', '/dashboard');
      dashboardPage();
    }
  } catch (error) {
    if (error.status !== 401)
      shell(
        '<main class="page"><div class="notice"><strong>Workspace unavailable</strong><br>' +
          escapeHtml(error.message) +
          '</div></main>',
      );
  }
}

async function bootstrap() {
  try {
    const callback = new URLSearchParams(location.hash.slice(1));
    const callbackError = callback.get('error_description') || callback.get('error');
    if (location.pathname === '/reset-password') {
      const token = callback.get('access_token');
      if (token && callback.get('type') === 'recovery') recoveryAccessToken = token;
      if (location.hash) history.replaceState({}, '', '/reset-password');
      saveSession(null);
      currentUser = null;
      authPage(recoveryAccessToken && !callbackError ? 'reset' : 'invalid', callbackError || '');
      return;
    }
    if (location.pathname === '/auth/callback') {
      const accessToken = callback.get('access_token');
      const refreshToken = callback.get('refresh_token');
      if (!callbackError && accessToken && refreshToken) {
        saveSession({
          access_token: accessToken,
          refresh_token: refreshToken,
          expires_in: Number(callback.get('expires_in') || 3600),
          token_type: callback.get('token_type') || 'bearer',
        });
        history.replaceState({}, '', '/dashboard');
      } else {
        saveSession(null);
        history.replaceState({}, '', '/sign-in');
        authPage('signin', callbackError || 'This verification link is invalid or has expired.');
        return;
      }
    }
    if (!session) {
      renderPublicAuthRoute();
      return;
    }
    const identity = await api('/api/auth/me');
    currentUser = identity.user;
    if (['/', '/sign-in', '/create-account', '/forgot-password', '/auth/callback'].includes(location.pathname))
      history.replaceState({}, '', '/dashboard');
    await renderRoute();
  } catch (error) {
    saveSession(null);
    if (location.pathname !== '/sign-in') history.replaceState({}, '', '/sign-in');
    authPage('signin', error.message);
  }
}

async function runAction(action) {
  try {
    await action();
  } catch (error) {
    toast(error.message, true);
    if (error?.fieldPath) focusInvoiceValidationField(error.fieldPath);
  }
}

document.addEventListener(
  'pointerdown',
  (event) => {
    drawerPointerDownTarget = event.target;
  },
  true,
);

document.addEventListener('keydown', (event) => {
  // Never steal clipboard / text-editing keys, and do not close the workspace while typing.
  if (shouldIgnoreGlobalShortcut(event)) return;
  if (event.key === 'Escape' && document.querySelector('[data-invoice-curtain]')) {
    event.preventDefault();
    void requestCloseInvoiceWorkspace();
    return;
  }
  if (event.key === 'Escape' && document.querySelector('.drawer-backdrop')) {
    event.preventDefault();
    requestCloseDrawer();
    return;
  }
});

document.addEventListener('click', async (event) => {
  const route = event.target.closest('[data-route]');
  if (route) {
    event.preventDefault();
    document.querySelector('.app-shell')?.classList.remove('menu-open');
    navigate(route.getAttribute('href'));
    return;
  }
  if (event.target.closest('[data-menu]')) {
    document.querySelector('.app-shell')?.classList.add('menu-open');
    return;
  }
  if (event.target.closest('[data-menu-close]')) {
    document.querySelector('.app-shell')?.classList.remove('menu-open');
    return;
  }
  if (event.target.closest('[data-close-drawer]')) {
    requestCloseDrawer();
    return;
  }
  if (
    shouldCloseDrawerOnBackdropClick({
      clickTarget: event.target,
      pointerDownTarget: drawerPointerDownTarget,
      hasTextSelection: hasActiveTextSelection(),
    })
  ) {
    requestCloseDrawer();
    return;
  }
  if (event.target.closest('[data-configure-profile]')) {
    navigate('/settings');
    return;
  }
  if (event.target.closest('[data-regenerate-logos]')) {
    const form = document.querySelector('#logo-studio-form');
    if (form) form.requestSubmit();
    return;
  }
  const selectLogo = event.target.closest('[data-select-logo]');
  if (selectLogo) {
    const concept = logoStudioConcepts.find((item) => item.id === selectLogo.dataset.selectLogo);
    if (!concept) return;
    await runAction(async () => {
      const { svg, previewUrl, ...persisted } = concept;
      const result = await api('/api/logo-studio/select', {
        method: 'POST',
        body: JSON.stringify({ concept: persisted }),
      });
      window.__aleyaInvalidateBusinessProfileCache?.();
      cache.businessProfile = result.profile;
      logoStudioNotice =
        'Brand Kit saved. Aleya uses it across the workspace, invoices and PDFs — and syncs to the shared Logo Creator platform when configured.';
      toast(logoStudioNotice);
      await logoCreatorPage();
    });
    return;
  }
  if (event.target.closest('[data-new-customer]')) {
    customerForm();
    return;
  }
  if (event.target.closest('[data-new-quote]')) {
    salesForm('quote');
    return;
  }
  if (event.target.closest('[data-new-invoice]')) {
    openInvoiceWorkspaceRoute();
    return;
  }
  const invoiceAction = event.target.closest('[data-invoice-action]');
  if (invoiceAction) {
    const action = invoiceAction.dataset.invoiceAction;
    const form = document.querySelector('#invoice-workspace-form');
    if (!form) return;
    if (action === 'cancel') {
      void requestCloseInvoiceWorkspace();
      return;
    }
    if (action === 'draft' || action === 'save') {
      invoiceWorkspaceAction = action;
      return;
    }
    if (action === 'preview' || action === 'download') {
      // Collect while inputs are still enabled, then only disable action buttons.
      // Disabling inputs before payload collection previously omitted title from FormData
      // and showed "Invoice title is required" even though the title was visible.
      let body;
      try {
        body = await collectInvoiceWorkspacePayload(form);
      } catch (error) {
        error.fieldPath = error.fieldPath || 'lineItems';
        await runAction(async () => {
          throw error;
        });
        return;
      }
      if (!invoicePayloadIsAutosaveReady(body)) {
        const error = new Error(
          !String(body?.title || '').trim()
            ? 'Invoice title is required.'
            : 'Add a customer, title, and at least one line item before previewing.',
        );
        error.status = 400;
        error.fieldPath = !String(body?.title || '').trim() ? 'title' : 'customerId';
        await runAction(async () => {
          throw error;
        });
        return;
      }
      const controls = form.querySelectorAll('[data-invoice-action]');
      controls.forEach((control) => {
        control.dataset.wasDisabled = control.disabled ? '1' : '0';
        control.disabled = true;
      });
      try {
        await runAction(async () => {
          const saved = await persistInvoiceWorkspace(form, { stay: true, source: 'preview' });
          if (action === 'preview') {
            await previewInvoicePdf(saved.id);
            toast('PDF preview opened.');
          } else {
            toast((await downloadDocument('invoice', saved.id)) + ' downloaded.');
          }
        });
      } finally {
        controls.forEach((control) => {
          if (control.dataset.wasDisabled === '1') return;
          control.disabled = false;
          delete control.dataset.wasDisabled;
        });
      }
      return;
    }
  }
  if (event.target.closest('[data-new-payment]')) {
    paymentForm();
    return;
  }
  if (event.target.closest('[data-add-line]')) {
    document.querySelector('.line-items')?.insertAdjacentHTML('beforeend', lineRow());
    return;
  }
  if (event.target.closest('[data-remove-line]')) {
    const rows = document.querySelectorAll('.line-row');
    if (rows.length > 1) event.target.closest('.line-row').remove();
    else toast('A quote or invoice needs at least one line item.', true);
    return;
  }
  const viewCustomer = event.target.closest('[data-view-customer]');
  if (viewCustomer) {
    await runAction(() => customerDetails(viewCustomer.dataset.viewCustomer));
    return;
  }
  const editCustomer = event.target.closest('[data-edit-customer]');
  if (editCustomer) {
    await runAction(async () =>
      customerForm(await api('/api/customers/' + editCustomer.dataset.editCustomer)),
    );
    return;
  }
  const deleteCustomer = event.target.closest('[data-delete-customer]');
  if (deleteCustomer) {
    deleteCustomer.disabled = true;
    await runAction(() =>
      removeCustomerViaApi(deleteCustomer.dataset.deleteCustomer, deleteCustomer.dataset.name),
    );
    deleteCustomer.disabled = false;
    return;
  }
  const viewQuote = event.target.closest('[data-view-quote]');
  if (viewQuote) {
    await runAction(() => quoteDetails(viewQuote.dataset.viewQuote));
    return;
  }
  const editQuote = event.target.closest('[data-edit-quote]');
  if (editQuote) {
    await runAction(async () =>
      salesForm('quote', await api('/api/quotes/' + editQuote.dataset.editQuote)),
    );
    return;
  }
  const duplicateQuote = event.target.closest('[data-duplicate-quote]');
  if (duplicateQuote) {
    await runAction(async () =>
      salesForm('quote', await api('/api/quotes/' + duplicateQuote.dataset.duplicateQuote), true),
    );
    return;
  }
  const viewInvoice = event.target.closest('[data-view-invoice]');
  if (viewInvoice) {
    await runAction(() => invoiceDetails(viewInvoice.dataset.viewInvoice));
    return;
  }
  const editInvoice = event.target.closest('[data-edit-invoice]');
  if (editInvoice) {
    openInvoiceWorkspaceRoute(editInvoice.dataset.editInvoice);
    return;
  }
  const viewPayment = event.target.closest('[data-view-payment]');
  if (viewPayment) {
    await runAction(() => paymentDetails(viewPayment.dataset.viewPayment));
    return;
  }
  const timeline = event.target.closest('[data-timeline]');
  if (timeline) {
    await runAction(() => openTimeline(timeline.dataset.timeline, timeline.dataset.id));
    return;
  }
  const pdf = event.target.closest('[data-pdf]');
  if (pdf) {
    pdf.disabled = true;
    await runAction(async () =>
      toast((await downloadDocument(pdf.dataset.pdf, pdf.dataset.id)) + ' downloaded.'),
    );
    pdf.disabled = false;
    return;
  }
  const quoteStatus = event.target.closest('[data-quote-status]');
  if (quoteStatus) {
    quoteStatus.disabled = true;
    await runAction(async () => {
      await updateQuoteStatus(quoteStatus.dataset.id, quoteStatus.dataset.quoteStatus);
      toast('Quote status updated to ' + quoteStatus.dataset.quoteStatus + '.');
      invalidateWorkspaceCache();
      await renderRoute({ forceReload: true });
    });
    quoteStatus.disabled = false;
    return;
  }
  const convert = event.target.closest('[data-convert-quote]');
  if (convert) {
    convert.disabled = true;
    await runAction(async () => {
      await api('/api/quotes/' + convert.dataset.convertQuote + '/convert', { method: 'POST' });
      toast('Accepted quote converted to a final invoice.');
      closeDrawer();
      invalidateWorkspaceCache();
      await renderRoute({ forceReload: true });
    });
    convert.disabled = false;
    return;
  }
  const finalise = event.target.closest('[data-finalise-invoice]');
  if (finalise) {
    finalise.disabled = true;
    await runAction(async () => {
      await api('/api/invoices/' + finalise.dataset.finaliseInvoice + '/finalise', {
        method: 'POST',
      });
      toast('Invoice issued and locked.');
      closeDrawer();
      invalidateWorkspaceCache();
      await renderRoute({ forceReload: true });
    });
    finalise.disabled = false;
    return;
  }
  if (event.target.closest('[data-export-report]')) {
    const lines = [
      ['Invoice', 'Invoiced', 'Paid', 'Credited', 'Outstanding'],
      ...cache.report.accountsReceivable.invoices.map((item) => [
        item.invoiceNumber,
        item.totalInvoiced,
        item.totalPaid,
        item.totalCredited,
        item.outstanding,
      ]),
    ];
    const blob = new Blob(
      [
        lines
          .map((row) => row.map((cell) => '"' + String(cell).replaceAll('"', '""') + '"').join(','))
          .join('\n'),
      ],
      { type: 'text/csv' },
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'aboss-accounts-receivable.csv';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('aboss-accounts-receivable.csv downloaded.');
    return;
  }
  if (event.target.closest('[data-clear-report]')) {
    invalidateWorkspaceCache();
    await renderRoute({ forceReload: true });
    return;
  }
  if (event.target.closest('[data-signout]')) {
    if (signOutInProgress) return;
    signOutInProgress = true;
    const accessToken = session?.access_token;
    saveSession(null);
    currentUser = null;
    history.replaceState({}, '', '/sign-in');
    authPage('signin');
    void fetch('/api/auth/sign-out', {
      method: 'POST',
      headers: accessToken ? { authorization: 'Bearer ' + accessToken } : {},
    }).catch(() => {});
  }
});

function applyListFilters() {
  const query = (document.querySelector('[data-list-search]')?.value || '').trim().toLowerCase();
  const status = document.querySelector('[data-list-status]')?.value || '';
  document.querySelectorAll('tr[data-search]').forEach((row) => {
    row.hidden = Boolean(
      (query && !row.dataset.search.includes(query)) || (status && row.dataset.status !== status),
    );
  });
}

document.addEventListener('change', (event) => {
  if (event.target.matches('#payment-form [name="invoiceId"]')) {
    const selected = event.target.selectedOptions[0];
    const outstanding = Number(selected?.dataset.outstanding || 0);
    const amount = document.querySelector('#payment-form [name="amount"]');
    amount.value = outstanding ? outstanding.toFixed(2) : '';
    amount.max = outstanding || '';
    document.querySelector('#payment-balance').textContent = outstanding
      ? 'Outstanding balance: ' +
        money(outstanding) +
        '. Enter a smaller amount for a partial payment.'
      : 'Choose an invoice to see its outstanding balance.';
  }
  if (event.target.matches('[data-list-status]')) applyListFilters();
});

document.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.target;
  const submit =
    event.submitter?.matches?.('[type="submit"]') ? event.submitter : form.querySelector('[type="submit"]');
  if (submit) submit.disabled = true;
  const data = Object.fromEntries(new FormData(form));
  try {
    if (form.id === 'signup-form' || form.id === 'reset-form') {
      if (data.password !== data.passwordConfirmation) throw new Error('Passwords do not match.');
      if (
        String(data.password).length < 12 ||
        !/[a-z]/.test(data.password) ||
        !/[A-Z]/.test(data.password) ||
        !/[0-9]/.test(data.password)
      ) {
        throw new Error('Use at least 12 characters with uppercase, lowercase, and a number.');
      }
    }
    if (form.id === 'signup-form') {
      const result = await api('/api/auth/sign-up', {
        method: 'POST',
        body: JSON.stringify(data),
      });
      if (result.status === 'active' && result.session) {
        saveSession(result.session);
        currentUser = provisionalUser(data);
        history.replaceState({}, '', '/dashboard');
        invalidateWorkspaceCache();
        await renderRoute({ forceReload: true });
      } else {
        history.replaceState({}, '', '/sign-in');
        authPage('verification', result.message, true);
      }
      return;
    }
    if (form.id === 'forgot-form') {
      const result = await api('/api/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify(data),
      });
      authPage('forgot', result.message, true);
      return;
    }
    if (form.id === 'reset-form') {
      if (!recoveryAccessToken) throw new Error('This password reset link is invalid or has expired.');
      const response = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: {
          authorization: 'Bearer ' + recoveryAccessToken,
          'content-type': 'application/json',
        },
        body: JSON.stringify(data),
      });
      let result = {};
      try {
        result = await response.json();
      } catch {}
      if (!response.ok) throw new Error(friendlyMessage(result.message));
      recoveryAccessToken = null;
      saveSession(null);
      history.replaceState({}, '', '/sign-in');
      authPage('signin', result.message, true);
      return;
    }
    if (form.id === 'signin-form') {
      saveSession(await api('/api/auth/sign-in', { method: 'POST', body: JSON.stringify(data) }));
      currentUser = provisionalUser(data);
      history.replaceState({}, '', '/dashboard');
      invalidateWorkspaceCache();
      await renderRoute({ forceReload: true });
      return;
    }
    if (form.id === 'customer-form') {
      const body = Object.fromEntries(
        Object.entries(data).filter(([, value]) => String(value).trim()),
      );
      const duplicate = cache.customers.find(
        (customer) =>
          customer.id !== form.dataset.recordId &&
          customer.displayName.trim().toLowerCase() ===
            String(body.displayName).trim().toLowerCase() &&
          (customer.email || '').trim().toLowerCase() ===
            String(body.email || '')
              .trim()
              .toLowerCase(),
      );
      if (duplicate)
        throw new Error('A matching customer already exists. Open that record instead.');
      if (form.dataset.recordId)
        await api('/api/customers/' + form.dataset.recordId, {
          method: 'PUT',
          body: JSON.stringify(body),
        });
      else await api('/api/customers', { method: 'POST', body: JSON.stringify(body) });
      closeDrawer();
      toast(form.dataset.recordId ? 'Customer updated.' : 'Customer created.');
      invalidateWorkspaceCache();
      await renderRoute({ forceReload: true });
      return;
    }
    if (form.id === 'invoice-workspace-form') {
      const submitterAction = event.submitter?.getAttribute?.('data-invoice-action');
      const action = submitterAction || invoiceWorkspaceAction || 'save';
      invoiceWorkspaceAction = 'save';
      const wasNew = !form.dataset.recordId;
      const saved = await persistInvoiceWorkspace(form, { stay: action === 'draft' });
      clearInvoiceDraftSnapshot();
      if (action === 'draft') return;
      toast(wasNew ? 'Invoice draft created.' : 'Invoice saved.');
      await closeInvoiceWorkspace({ force: true, animate: true });
      history.pushState({}, '', '/workspace/invoices');
      invalidateWorkspaceCache();
      await renderRoute({ forceReload: true });
      // Ensure the saved invoice is present in the reloaded list (regression guard).
      if (saved?.id && !cache.invoices?.some((invoice) => invoice.id === saved.id)) {
        invalidateWorkspaceCache();
        await loadWorkspace({ force: true });
        invoicesPage();
      }
      return;
    }
    if (form.id === 'sales-form') {
      const lineItems = [...form.querySelectorAll('.line-row')].map((row) => ({
        description: row.querySelector('[name="description"]').value.trim(),
        quantity: Number(row.querySelector('[name="quantity"]').value),
        unitPrice: Number(row.querySelector('[name="unitPrice"]').value),
        gstApplicable: row.querySelector('[name="gstApplicable"]').value === 'true',
      }));
      const body = {
        customerId: data.customerId,
        title: data.title,
        issueDate: data.issueDate,
        expiryDate: data.endDate,
        ...(data.notes ? { notes: data.notes } : {}),
        ...(data.paymentTerms ? { terms: data.paymentTerms } : {}),
        lineItems,
      };
      const recordId = form.dataset.recordId;
      if (recordId) {
        await api('/api/quotes/' + recordId, {
          method: 'PUT',
          body: JSON.stringify({ ...body, status: data.status }),
        });
      } else {
        await api('/api/quotes', { method: 'POST', body: JSON.stringify(body) });
      }
      closeDrawer();
      toast(recordId ? 'Changes saved.' : 'Quote draft created.');
      invalidateWorkspaceCache();
      await renderRoute({ forceReload: true });
      return;
    }
    if (form.id === 'payment-form') {
      const selected = form.querySelector('[name="invoiceId"]').selectedOptions[0];
      const amount = Number(data.amount);
      const outstanding = Number(selected.dataset.outstanding);
      if (amount > outstanding + 0.0001)
        throw new Error('Payment cannot exceed the outstanding balance.');
      await api('/api/payments', {
        method: 'POST',
        body: JSON.stringify({
          customerId: selected.dataset.customer,
          paymentDate: data.paymentDate,
          paymentMethod: data.paymentMethod,
          reference: data.reference,
          amount,
          ...(data.notes ? { notes: data.notes } : {}),
          allocations: [{ invoiceId: data.invoiceId, amount }],
        }),
      });
      closeDrawer();
      toast(
        amount < outstanding
          ? 'Partial payment recorded.'
          : 'Final payment recorded. Invoice is paid.',
      );
      invalidateWorkspaceCache();
      await renderRoute({ forceReload: true });
      return;
    }
    if (form.id === 'profile-form') {
      const body = Object.fromEntries(
        Object.entries(data).filter(
          ([key, value]) =>
            ['primaryColor', 'secondaryColor'].includes(key) || String(value).trim(),
        ),
      );
      if (!String(body.companyName || '').trim() || !String(body.address || '').trim()) {
        throw new Error('Business name and address are required to unlock PDF downloads.');
      }
      if (cache.businessProfile?.logoReference) {
        body.logoReference = cache.businessProfile.logoReference;
      }
      const saved = await api('/api/business-profile', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      window.__aleyaInvalidateBusinessProfileCache?.();
      cache.businessProfile = saved;
      toast(
        isBusinessProfileReady(saved)
          ? 'Business profile saved. PDF downloads are ready.'
          : 'Business profile saved.',
      );
      invalidateWorkspaceCache();
      await renderRoute({ forceReload: true });
      return;
    }
    if (form.id === 'logo-studio-form') {
      const payload = {
        businessName: String(data.businessName || '').trim(),
        industry: String(data.industry || '').trim(),
        style: data.style,
        primaryColor: data.primaryColor,
        secondaryColor: data.secondaryColor,
        ...(String(data.tagline || '').trim() ? { tagline: String(data.tagline).trim() } : {}),
        ...(String(data.iconIdeas || '').trim() ? { iconIdeas: String(data.iconIdeas).trim() } : {}),
        count: 6,
      };
      const result = await api('/api/logo-studio/generate', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      logoStudioConcepts = result.concepts || [];
      logoStudioNotice = 'Generated ' + logoStudioConcepts.length + ' logo concepts.';
      await logoCreatorPage();
      toast(logoStudioNotice);
      return;
    }
    if (form.id === 'report-filter') {
      const query = new URLSearchParams();
      if (data.from) query.set('from', data.from);
      if (data.to) query.set('to', data.to);
      query.set('limit', '500');
      cache.report = await api('/api/reports/read-model?' + query.toString());
      reportsPage();
    }
  } catch (error) {
    if (['signin-form', 'signup-form', 'forgot-form', 'reset-form'].includes(form.id)) {
      const kinds = {
        'signin-form': 'signin',
        'signup-form': 'signup',
        'forgot-form': 'forgot',
        'reset-form': recoveryAccessToken ? 'reset' : 'invalid',
      };
      authPage(kinds[form.id], error.message);
    } else {
      toast(error.message, true);
    }
  } finally {
    if (submit?.isConnected) submit.disabled = false;
  }
});

let searchTimer;
document.addEventListener('input', (event) => {
  if (event.target.matches('[data-list-search]')) {
    applyListFilters();
    return;
  }
  if (!event.target.matches('#global-search')) return;
  clearTimeout(searchTimer);
  const query = event.target.value.trim();
  const host = document.querySelector('#search-results');
  if (query.length < 2) {
    host.innerHTML = '';
    return;
  }
  searchTimer = setTimeout(async () => {
    try {
      const result = await api('/api/search?q=' + encodeURIComponent(query) + '&limit=8');
      const items = [
        ...result.customers.map((item) => [
          'Customer',
          item.displayName,
          item.email || '',
          'view-customer',
          item.id,
        ]),
        ...(result.quotes || []).map((item) => [
          'Quote',
          item.quoteNumber,
          item.title,
          'view-quote',
          item.id,
        ]),
        ...result.invoices.map((item) => [
          'Invoice',
          item.invoiceNumber || 'Draft',
          item.title,
          'view-invoice',
          item.id,
        ]),
        ...result.customerPayments.map((item) => [
          'Payment',
          item.paymentNumber,
          item.reference,
          'view-payment',
          item.id,
        ]),
      ].slice(0, 12);
      host.innerHTML = items.length
        ? '<div class="global-search search-results">' +
          items
            .map(
              (item) =>
                '<button class="search-result button ghost" data-' +
                item[3] +
                '="' +
                escapeHtml(item[4]) +
                '"><span><strong>' +
                escapeHtml(item[1]) +
                '</strong><br><small>' +
                escapeHtml(item[0] + ' · ' + item[2]) +
                '</small></span><span>Open →</span></button>',
            )
            .join('') +
          '</div>'
        : '';
    } catch {
      host.innerHTML = '';
    }
  }, 250);
});

window.addEventListener('popstate', () => {
  if (ignoreNextPopstate) {
    ignoreNextPopstate = false;
    return;
  }
  if (!confirmDiscardUnsavedDrawerWork()) {
    ignoreNextPopstate = true;
    history.go(1);
    return;
  }
  closeDrawer();
  void renderRoute();
});

window.addEventListener('beforeunload', (event) => {
  const form = unsavedWorkForm();
  if (!form || !isDrawerFormDirty(form)) return;
  event.preventDefault();
  event.returnValue = '';
});

void bootstrap();
