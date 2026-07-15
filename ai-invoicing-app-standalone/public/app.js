const root = document.querySelector('#app');
const SESSION_KEY = 'aboss-invoicing-session';
let session = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
let currentUser = null;
let cache = {};
let recoveryAccessToken = null;

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
  CUSTOMER_HAS_QUOTES: 'This customer cannot be deleted because quotes are linked to it.',
  CUSTOMER_HAS_INVOICES: 'This customer cannot be deleted because invoices are linked to it.',
  OWNER_ALREADY_PROVISIONED: 'Owner setup is already complete. Sign in instead.',
};
const friendlyMessage = (message) =>
  errorMessages[message] || message || 'ABoss could not complete the request.';

function saveSession(value) {
  session = value;
  if (value) localStorage.setItem(SESSION_KEY, JSON.stringify(value));
  else localStorage.removeItem(SESSION_KEY);
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
    const error = new Error(friendlyMessage(payload.message));
    error.status = response.status;
    throw error;
  }
  if (response.status === 204) return null;
  const type = response.headers.get('content-type') || '';
  return type.includes('application/json') ? response.json() : response;
}

function navigate(path) {
  history.pushState({}, '', path);
  if (currentUser) void renderRoute();
  else renderPublicAuthRoute();
}

function authPage(kind, message = '', success = false) {
  const pages = {
    signin: ['Welcome back', 'Sign in', 'Use your ABoss Invoicing owner credentials.', 'Invoicing without the busywork.'],
    signup: ['New workspace', 'Create account', 'Create a private invoicing workspace for your business.', 'Your business. Your secure workspace.'],
    forgot: ['Account recovery', 'Forgot password', 'Enter your email and we will send recovery instructions if an account exists.', 'A safe route back to your work.'],
    reset: ['Account recovery', 'Choose a new password', 'Use a strong password you have not used for this account before.', 'Secure your account. Keep moving.'],
    verification: ['Verify your email', 'Check your inbox', 'Open the verification link we sent, then return to sign in.', 'One last step protects your workspace.'],
    invalid: ['Recovery link unavailable', 'Request a new link', 'This link is malformed, expired, or has already been used.', 'Your account remains protected.'],
  };
  const page = pages[kind] || pages.signin;
  let form = '';
  if (kind === 'signin') {
    form = '<form class="form" id="signin-form"><label>Email<input name="email" type="email" autocomplete="email" required></label><label>Password<input name="password" type="password" autocomplete="current-password" required minlength="12"></label><button class="button" type="submit">Continue to ABoss</button></form><nav class="auth-links" aria-label="Account options"><a href="/create-account" data-route>Create account</a><a href="/forgot-password" data-route>Forgot password?</a></nav>';
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
    '<a class="wordmark" href="/" data-route><span class="brand-mark">A</span><span><strong>ABoss</strong><small>Invoicing</small></span></a>',
    '<div class="auth-copy"><span class="eyebrow">Secure business workspace</span><h1>', page[3], '</h1>',
    '<p>Customers, quotes, invoices, payments and reporting stay connected in one deliberate production workspace.</p></div>',
    '<span class="auth-foot">ABoss Software · Australian business operations</span></section>',
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
    '<a class="wordmark" href="/dashboard" data-route><span class="brand-mark">A</span><span><strong>ABoss</strong><small>Invoicing</small></span></a>',
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
  if (cache.businessProfile) return '';
  return '<div class="notice profile-notice"><strong>Business profile required for PDFs</strong><span>Add the real business name and address before downloading customer documents.</span><button class="button small" data-configure-profile>Configure Settings</button></div>';
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

async function loadWorkspace() {
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
  return cache;
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
        'ABoss Invoicing',
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
        '">Edit</button><button class="button ghost small" data-timeline="customer" data-id="' +
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
  shell(
    '<main class="page">' +
      pageHead(
        'Workspace',
        'Settings',
        'Business identity used on every customer-facing invoice, quote and receipt.',
      ) +
      '<section class="grid-2 settings-grid"><article class="panel"><header class="panel-head"><h2>Business profile</h2></header><form class="form panel-body" id="profile-form"><label>Business name<input name="companyName" required value="' +
      escapeHtml(profile.companyName || '') +
      '"></label><label>Legal name<input name="legalName" value="' +
      escapeHtml(profile.legalName || '') +
      '"></label><div class="form-grid"><label>ABN / Tax ID<input name="abnTaxId" value="' +
      escapeHtml(profile.abnTaxId || '') +
      '"></label><label>Email<input name="email" type="email" value="' +
      escapeHtml(profile.email || '') +
      '"></label><label>Phone<input name="phone" value="' +
      escapeHtml(profile.phone || '') +
      '"></label><label>Address<textarea name="address">' +
      escapeHtml(profile.address || '') +
      '</textarea></label><label>Primary colour<input name="primaryColor" type="color" value="' +
      escapeHtml(profile.primaryColor || '#173f35') +
      '" required></label><label>Secondary colour<input name="secondaryColor" type="color" value="' +
      escapeHtml(profile.secondaryColor || '#c4f36b') +
      '" required></label></div><button class="button" type="submit">Save business profile</button></form></article><article class="panel"><header class="panel-head"><h2>Security boundary</h2></header><div class="panel-body stack"><div class="notice success"><strong>Supabase Auth</strong><br>Browser sessions use short-lived access tokens. Database service credentials never enter browser JavaScript.</div><p class="muted">ABoss Invoicing remains isolated in its own repository, Vercel project, Supabase project and PostgreSQL database while presenting one ABoss visual identity.</p>' +
      (!cache.businessProfile
        ? '<div class="notice"><strong>PDF downloads are paused</strong><br>Save genuine business details here before issuing customer documents.</div>'
        : '<div class="notice success"><strong>Document identity configured</strong><br>New PDF downloads use this profile.</div>') +
      '</div></article></section></main>',
  );
}

function drawer(title, body) {
  document.querySelector('.drawer-backdrop')?.remove();
  document.body.insertAdjacentHTML(
    'beforeend',
    '<div class="drawer-backdrop" data-drawer-backdrop><aside class="drawer"><header class="drawer-head"><div><span class="kicker">ABoss Invoicing</span><h2>' +
      escapeHtml(title) +
      '</h2></div><button class="icon-button" data-close-drawer aria-label="Close">×</button></header>' +
      body +
      '</aside></div>',
  );
}
const closeDrawer = () => document.querySelector('.drawer-backdrop')?.remove();

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
  if (!cache.customers.length) {
    toast('Create a customer before creating a ' + kind + '.', true);
    navigate('/workspace/customers');
    return;
  }
  const quote = kind === 'quote';
  const editing = Boolean(record && !duplicate);
  const title = editing
    ? 'Edit ' + (quote ? record.quoteNumber : record.invoiceNumber || 'invoice draft')
    : duplicate
      ? 'Duplicate ' + record.quoteNumber
      : 'New ' + kind;
  const endDate = quote ? record?.expiryDate : record?.dueDate;
  const customerControl =
    editing && !quote
      ? '<input type="hidden" name="customerId" value="' +
        record.customerId +
        '"><select disabled><option>' +
        escapeHtml(
          cache.customers.find((item) => item.id === record.customerId)?.displayName || 'Customer',
        ) +
        '</option></select>'
      : '<select name="customerId" required><option value="">Select customer</option>' +
        customerOptions(record?.customerId) +
        '</select>';
  const statusControl =
    editing && quote
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
    '<form class="form" id="sales-form" data-kind="' +
      kind +
      '" data-record-id="' +
      (editing ? record.id : '') +
      '" data-payment-state="' +
      escapeHtml(record?.paymentState || 'Draft') +
      '"><div class="form-grid"><label class="wide">Customer' +
      customerControl +
      '</label><label class="wide">Title<input name="title" value="' +
      escapeHtml(duplicate ? record.title + ' (copy)' : record?.title || '') +
      '" required></label><label>Issue date<input name="issueDate" type="date" value="' +
      escapeHtml(record?.issueDate || date()) +
      '" required></label><label>' +
      (quote ? 'Valid until' : 'Due date') +
      '<input name="endDate" type="date" value="' +
      escapeHtml(endDate || date(14)) +
      '" required></label>' +
      statusControl +
      '<label class="wide">Payment terms<input name="paymentTerms" value="' +
      escapeHtml((quote ? record?.terms : record?.paymentTerms) || '') +
      '"></label><label class="wide">Notes<textarea name="notes">' +
      escapeHtml(record?.notes || '') +
      '</textarea></label></div><div class="stack"><div class="panel-head"><h2>Line items</h2><button class="button secondary small" type="button" data-add-line>Add line</button></div><div class="line-items">' +
      lines +
      '</div></div><button class="button" type="submit">' +
      (editing ? 'Save changes' : 'Create ' + (quote ? 'quote draft' : 'invoice draft')) +
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
      '">Edit customer</button><button class="button ghost" data-timeline="customer" data-id="' +
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
  if (!cache.businessProfile)
    throw new Error('Configure the real business profile in Settings before generating PDFs.');
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

async function renderRoute() {
  if (!currentUser) return;
  root.innerHTML =
    '<main class="boot"><span class="brand-mark">A</span><p>Loading live workspace…</p></main>';
  try {
    await loadWorkspace();
    const path = location.pathname === '/' ? '/dashboard' : location.pathname;
    if (path === '/dashboard') dashboardPage();
    else if (path === '/workspace/customers') customersPage();
    else if (path === '/workspace/quotes') quotesPage();
    else if (path === '/workspace/invoices') invoicesPage();
    else if (path === '/workspace/payments') paymentsPage();
    else if (path === '/reports') reportsPage();
    else if (path === '/timeline') await timelinePage();
    else if (path === '/settings') settingsPage();
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
  }
}

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
  if (
    event.target.closest('[data-close-drawer]') ||
    event.target.matches('[data-drawer-backdrop]')
  ) {
    closeDrawer();
    return;
  }
  if (event.target.closest('[data-configure-profile]')) {
    closeDrawer();
    navigate('/settings');
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
    salesForm('invoice');
    return;
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
    await runAction(async () =>
      salesForm('invoice', await api('/api/invoices/' + editInvoice.dataset.editInvoice)),
    );
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
      await renderRoute();
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
      await renderRoute();
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
      await renderRoute();
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
    await renderRoute();
    return;
  }
  if (event.target.closest('[data-signout]')) {
    try {
      await api('/api/auth/sign-out', { method: 'POST' });
    } catch {}
    saveSession(null);
    currentUser = null;
    history.replaceState({}, '', '/sign-in');
    authPage('signin');
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
  const submit = form.querySelector('[type="submit"]');
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
        currentUser = (await api('/api/auth/me')).user;
        history.replaceState({}, '', '/dashboard');
        await renderRoute();
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
      currentUser = (await api('/api/auth/me')).user;
      history.replaceState({}, '', '/dashboard');
      await renderRoute();
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
      await renderRoute();
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
        ...(form.dataset.kind === 'quote'
          ? { expiryDate: data.endDate }
          : { dueDate: data.endDate }),
        ...(data.notes ? { notes: data.notes } : {}),
        ...(data.paymentTerms
          ? form.dataset.kind === 'quote'
            ? { terms: data.paymentTerms }
            : { paymentTerms: data.paymentTerms }
          : {}),
        lineItems,
      };
      const recordId = form.dataset.recordId;
      if (recordId && form.dataset.kind === 'quote') {
        await api('/api/quotes/' + recordId, {
          method: 'PUT',
          body: JSON.stringify({ ...body, status: data.status }),
        });
      } else if (recordId) {
        const { customerId, ...invoiceBody } = body;
        await api('/api/invoices/' + recordId, {
          method: 'PUT',
          body: JSON.stringify({ ...invoiceBody, paymentState: form.dataset.paymentState }),
        });
      } else {
        await api('/api/' + (form.dataset.kind === 'quote' ? 'quotes' : 'invoices'), {
          method: 'POST',
          body: JSON.stringify(body),
        });
      }
      closeDrawer();
      toast(
        recordId
          ? 'Changes saved.'
          : form.dataset.kind === 'quote'
            ? 'Quote draft created.'
            : 'Invoice draft created.',
      );
      await renderRoute();
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
      await renderRoute();
      return;
    }
    if (form.id === 'profile-form') {
      const body = Object.fromEntries(
        Object.entries(data).filter(
          ([key, value]) =>
            ['primaryColor', 'secondaryColor'].includes(key) || String(value).trim(),
        ),
      );
      await api('/api/business-profile', { method: 'POST', body: JSON.stringify(body) });
      toast('Business profile saved. PDF downloads are ready.');
      await renderRoute();
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

window.addEventListener('popstate', () => void renderRoute());
void bootstrap();
