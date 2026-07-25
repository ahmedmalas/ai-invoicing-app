/** Lazy-loaded Banking workspace (Basiq Phase 1). */

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function moneyLabel(direction, amount) {
  const abs = Math.abs(Number(amount) || 0).toFixed(2);
  if (direction === 'credit') return { label: 'Money in', value: `$${abs}`, tone: 'in' };
  if (direction === 'debit') return { label: 'Money out', value: `$${abs}`, tone: 'out' };
  return { label: 'Amount', value: `$${abs}`, tone: 'neutral' };
}

function statusLabel(status) {
  const map = {
    not_configured: 'Provider not configured',
    not_connected: 'Not connected',
    connecting: 'Connecting',
    connected: 'Connected',
    syncing: 'Syncing',
    connected_delayed: 'Connected but delayed',
    consent_expiring: 'Consent expiring',
    reauth_required: 'Reauthentication required',
    provider_unavailable: 'Provider unavailable',
    disconnected: 'Disconnected',
    error: 'Error',
  };
  return map[status] || status || 'Unknown';
}

export function createBankingUi({ api, shell }) {
  let txState = {
    accountId: '',
    search: '',
    limit: 25,
    offset: 0,
    total: 0,
  };

  async function loadStatus() {
    return api('/api/banking/status');
  }

  async function loadAccounts() {
    const data = await api('/api/banking/accounts');
    return data.accounts || [];
  }

  async function loadTransactions() {
    const params = new URLSearchParams();
    params.set('limit', String(txState.limit));
    params.set('offset', String(txState.offset));
    if (txState.accountId) params.set('accountId', txState.accountId);
    if (txState.search.trim()) params.set('search', txState.search.trim());
    return api('/api/banking/transactions?' + params.toString());
  }

  function renderStatusCard(status, accounts) {
    const primary = accounts[0] || status.accounts?.[0] || null;
    const errors = Array.isArray(status.errors) ? status.errors : [];
    return [
      '<section class="banking-panel" data-banking-status>',
      '<header class="banking-panel-head">',
      '<h2>Bank connection</h2>',
      '<p class="muted">Basiq sandbox / development feed. Full account numbers are never shown.</p>',
      '</header>',
      '<dl class="banking-meta">',
      '<div><dt>Status</dt><dd data-status="' +
        escapeHtml(status.status) +
        '">' +
        escapeHtml(statusLabel(status.status)) +
        '</dd></div>',
      '<div><dt>Institution</dt><dd>' +
        escapeHtml(status.institution || primary?.institutionName || '—') +
        '</dd></div>',
      '<div><dt>Masked account</dt><dd>' +
        escapeHtml(status.maskedAccount || primary?.maskedAccountNumber || '—') +
        '</dd></div>',
      '<div><dt>Account type</dt><dd>' +
        escapeHtml(primary?.accountType || '—') +
        '</dd></div>',
      '<div><dt>Last successful sync</dt><dd>' +
        escapeHtml(status.lastSuccessfulSyncAt || '—') +
        '</dd></div>',
      '<div><dt>Consent expiry</dt><dd>' +
        escapeHtml(status.consentExpiresAt || '—') +
        '</dd></div>',
      '</dl>',
      status.warning
        ? '<p class="banking-warning" role="status">' + escapeHtml(status.warning) + '</p>'
        : '',
      errors.length
        ? '<p class="banking-error" role="alert">' + escapeHtml(errors.join('; ')) + '</p>'
        : '',
      status.nextAction
        ? '<p class="muted">' + escapeHtml(status.nextAction) + '</p>'
        : '',
      '<div class="banking-actions">',
      status.connected || status.status === 'connecting' || status.status === 'error'
        ? '<button type="button" class="btn" data-bank-refresh>Refresh</button>'
        : '',
      status.status === 'not_connected' ||
      status.status === 'disconnected' ||
      status.status === 'not_configured'
        ? '<button type="button" class="btn primary" data-bank-connect>Connect bank account</button>'
        : '<button type="button" class="btn" data-bank-reconnect>Reconnect</button>',
      status.connected ||
      status.status === 'connecting' ||
      status.status === 'error' ||
      status.status === 'reauth_required' ||
      status.status === 'consent_expiring'
        ? '<button type="button" class="btn danger" data-bank-disconnect>Disconnect</button>'
        : '',
      '</div>',
      '</section>',
    ].join('');
  }

  function renderAccounts(accounts) {
    if (!accounts.length) {
      return '<section class="banking-panel"><h2>Connected accounts</h2><p class="muted">No accounts imported yet.</p></section>';
    }
    return [
      '<section class="banking-panel">',
      '<h2>Connected accounts</h2>',
      '<ul class="banking-account-list">',
      ...accounts.map(
        (account) =>
          '<li><strong>' +
          escapeHtml(account.institutionName || 'Bank') +
          '</strong> · ' +
          escapeHtml(account.accountName || 'Account') +
          ' · ' +
          escapeHtml(account.maskedAccountNumber || '••••') +
          ' · ' +
          escapeHtml(account.accountType || '—') +
          '</li>',
      ),
      '</ul>',
      '</section>',
    ].join('');
  }

  function renderTransactions(payload, accounts) {
    const rows = payload.transactions || [];
    txState.total = Number(payload.total || 0);
    const page = Math.floor(txState.offset / txState.limit) + 1;
    const pages = Math.max(1, Math.ceil(txState.total / txState.limit));
    return [
      '<section class="banking-panel" data-banking-transactions>',
      '<header class="banking-panel-head">',
      '<h2>Recent transactions</h2>',
      '<p class="muted">Loaded only when Banking is open. Paginated.</p>',
      '</header>',
      '<form class="banking-filters" data-bank-filters>',
      '<label>Account<select name="accountId"><option value="">All accounts</option>',
      ...accounts.map(
        (account) =>
          '<option value="' +
          escapeHtml(account.id) +
          '"' +
          (txState.accountId === account.id ? ' selected' : '') +
          '>' +
          escapeHtml(
            (account.institutionName || 'Bank') +
              ' ' +
              (account.maskedAccountNumber || ''),
          ) +
          '</option>',
      ),
      '</select></label>',
      '<label>Search<input name="search" type="search" value="' +
        escapeHtml(txState.search) +
        '" placeholder="Description or merchant" /></label>',
      '<button type="submit" class="btn">Apply</button>',
      '</form>',
      rows.length === 0
        ? '<p class="muted">No transactions to show.</p>'
        : [
            '<table class="banking-tx-table"><thead><tr>',
            '<th>Date</th><th>Description</th><th>Flow</th><th>Amount</th>',
            '</tr></thead><tbody>',
            ...rows.map((tx) => {
              const money = moneyLabel(tx.direction, tx.amount);
              return (
                '<tr><td>' +
                escapeHtml(tx.transactionDate) +
                '</td><td>' +
                escapeHtml(tx.description || tx.merchantName || '—') +
                '</td><td>' +
                escapeHtml(money.label) +
                '</td><td class="banking-amount banking-amount-' +
                money.tone +
                '">' +
                escapeHtml(money.value) +
                '</td></tr>'
              );
            }),
            '</tbody></table>',
          ].join(''),
      '<div class="banking-pagination">',
      '<button type="button" class="btn" data-bank-prev' +
        (txState.offset <= 0 ? ' disabled' : '') +
        '>Previous</button>',
      '<span class="muted">Page ' + page + ' of ' + pages + ' · ' + txState.total + ' total</span>',
      '<button type="button" class="btn" data-bank-next' +
        (txState.offset + txState.limit >= txState.total ? ' disabled' : '') +
        '>Next</button>',
      '</div>',
      '</section>',
    ].join('');
  }

  async function bankingPage() {
    const params = new URLSearchParams(location.search);
    const flash =
      params.get('banking') === 'connected'
        ? '<p class="banking-flash" role="status">Bank connection completed. Imported accounts and transactions where available.</p>'
        : params.get('banking') === 'error'
          ? '<p class="banking-error" role="alert">Bank connection callback failed (' +
            escapeHtml(params.get('reason') || 'unknown') +
            '). No secrets were returned.</p>'
          : '';

    shell(
      [
        '<main class="page banking-page">',
        '<header class="page-header"><div><h1>Banking</h1>',
        '<p class="muted">Connect a Basiq test institution, review sync status, and browse imported transactions.</p>',
        '</div></header>',
        flash,
        '<div data-banking-root><p class="muted">Loading bank feed…</p></div>',
        '</main>',
      ].join(''),
    );

    const root = document.querySelector('[data-banking-root]');
    try {
      const [status, accounts, transactions] = await Promise.all([
        loadStatus(),
        loadAccounts(),
        loadTransactions(),
      ]);
      root.innerHTML =
        renderStatusCard(status, accounts) +
        renderAccounts(accounts) +
        renderTransactions(transactions, accounts);
      bindActions(root);
    } catch (error) {
      root.innerHTML =
        '<p class="banking-error" role="alert">Unable to load banking data. ' +
        escapeHtml(error?.message || 'Unknown error') +
        '</p>';
    }
  }

  function bindActions(root) {
    root.querySelector('[data-bank-connect]')?.addEventListener('click', () => void connectBank());
    root.querySelector('[data-bank-reconnect]')?.addEventListener('click', () => void connectBank(true));
    root.querySelector('[data-bank-refresh]')?.addEventListener('click', () => void refreshBank());
    root.querySelector('[data-bank-disconnect]')?.addEventListener('click', () => void disconnectBank());
    root.querySelector('[data-bank-filters]')?.addEventListener('submit', (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      txState.accountId = form.accountId.value || '';
      txState.search = form.search.value || '';
      txState.offset = 0;
      void bankingPage();
    });
    root.querySelector('[data-bank-prev]')?.addEventListener('click', () => {
      txState.offset = Math.max(0, txState.offset - txState.limit);
      void bankingPage();
    });
    root.querySelector('[data-bank-next]')?.addEventListener('click', () => {
      txState.offset += txState.limit;
      void bankingPage();
    });
  }

  async function connectBank(isReconnect = false) {
    if (
      isReconnect &&
      !window.confirm(
        'Reconnect may replace the existing open-banking consent. Continue?',
      )
    ) {
      return;
    }
    const mobile = window.prompt(
      'Mobile number for Basiq AuthLink SMS (sandbox). Leave blank to use business profile phone.',
      '',
    );
    const body = {};
    if (mobile && mobile.trim()) body.mobile = mobile.trim();
    const result = await api('/api/banking/basiq/connect', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    if (!result?.authLinkUrl) {
      window.alert(result?.message || 'Unable to start bank connection.');
      return;
    }
    window.location.assign(result.authLinkUrl);
  }

  async function refreshBank() {
    await api('/api/banking/refresh', { method: 'POST', body: '{}' });
    await bankingPage();
  }

  async function disconnectBank() {
    if (
      !window.confirm(
        'Disconnect this bank feed? Imported transactions remain, but the live connection will end.',
      )
    ) {
      return;
    }
    await api('/api/banking/disconnect', {
      method: 'POST',
      body: JSON.stringify({ confirm: true }),
    });
    await bankingPage();
  }

  return { bankingPage };
}
