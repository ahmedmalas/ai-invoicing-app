/** Lazy-loaded Banking + Settings Bank Feeds (Basiq Phase 1). Shared API client. */

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

  function isSandboxStatus(status) {
    return Boolean(status?.sandbox) || status?.environment === 'sandbox';
  }

  function renderConnectionPanel(status, accounts, options = {}) {
    const primary = accounts[0] || status.accounts?.[0] || null;
    const errors = Array.isArray(status.errors) ? status.errors : [];
    const sandbox = isSandboxStatus(status);
    const title = options.title || 'Bank Feeds';
    const intro =
      options.intro ||
      (sandbox
        ? 'Sandbox test connection: Connect opens the Basiq AuthLink in your browser (Hooli test bank). No SMS is sent.'
        : 'Connect a bank via Basiq AuthLink in your browser. Manage consent and sync here. Full account numbers are never shown.');
    const connectLabel = sandbox
      ? 'Connect sandbox test bank'
      : 'Connect bank account';
    const showResend =
      status.status === 'connecting' ||
      status.status === 'reauth_required' ||
      status.status === 'error';
    return [
      '<section class="banking-panel" data-banking-status data-bank-feeds-panel>',
      '<header class="banking-panel-head">',
      '<h2>' + escapeHtml(title) + '</h2>',
      sandbox
        ? '<p class="banking-warning" role="status">Sandbox test connection — AuthLink opens in the browser; Basiq does not text you the AuthLink URL.</p>'
        : '',
      '<p class="muted">' + escapeHtml(intro) + '</p>',
      '</header>',
      '<dl class="banking-meta">',
      '<div><dt>Status</dt><dd data-status="' +
        escapeHtml(status.status) +
        '">' +
        escapeHtml(statusLabel(status.status)) +
        '</dd></div>',
      '<div><dt>Environment</dt><dd>' +
        escapeHtml(sandbox ? 'Sandbox' : status.environment || 'Production') +
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
      options.connectFlash
        ? '<div class="banking-flash" role="status" data-bank-connect-flash>' +
          options.connectFlash +
          '</div>'
        : '',
      status.nextAction
        ? '<p class="muted">' + escapeHtml(status.nextAction) + '</p>'
        : '',
      '<div class="banking-actions">',
      status.connected || status.status === 'connecting' || status.status === 'error'
        ? '<button type="button" class="button" data-bank-refresh>Refresh</button>'
        : '',
      status.status === 'not_connected' ||
      status.status === 'disconnected' ||
      status.status === 'not_configured'
        ? '<button type="button" class="button" data-bank-connect>' +
          escapeHtml(connectLabel) +
          '</button>'
        : '<button type="button" class="button secondary" data-bank-reconnect>Reconnect</button>',
      showResend
        ? '<button type="button" class="button secondary" data-bank-resend>Resend AuthLink</button>'
        : '',
      status.connected ||
      status.status === 'connecting' ||
      status.status === 'error' ||
      status.status === 'reauth_required' ||
      status.status === 'consent_expiring'
        ? '<button type="button" class="button danger" data-bank-disconnect>Disconnect</button>'
        : '',
      options.showTransactionsLink
        ? '<a class="button secondary" href="/workspace/banking" data-route>View transactions</a>'
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
      '<h2>Imported transactions</h2>',
      '<p class="muted">Search and paginate feed data. Connection is managed in Settings → Bank Feeds.</p>',
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
      '<button type="submit" class="button">Apply</button>',
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
      '<button type="button" class="button secondary" data-bank-prev' +
        (txState.offset <= 0 ? ' disabled' : '') +
        '>Previous</button>',
      '<span class="muted">Page ' + page + ' of ' + pages + ' · ' + txState.total + ' total</span>',
      '<button type="button" class="button secondary" data-bank-next' +
        (txState.offset + txState.limit >= txState.total ? ' disabled' : '') +
        '>Next</button>',
      '</div>',
      '</section>',
    ].join('');
  }

  function openAuthLinkUrl(url) {
    if (!url) return false;
    const opened = window.open(url, '_blank', 'noopener,noreferrer');
    if (!opened) {
      window.location.assign(url);
      return true;
    }
    return true;
  }

  function connectFlashHtml(result) {
    const sandbox = Boolean(result?.sandbox) || result?.environment === 'sandbox';
    const message =
      result?.message ||
      (sandbox
        ? 'Sandbox AuthLink created. Opening the test bank connection (no SMS is sent).'
        : 'AuthLink created. Opening Basiq Connect.');
    const url = result?.authLinkUrl || '';
    return (
      '<p><strong>' +
      escapeHtml(message) +
      '</strong></p>' +
      (url
        ? '<p>AuthLink: <a href="' +
          escapeHtml(url) +
          '" target="_blank" rel="noopener noreferrer" data-bank-authlink>' +
          escapeHtml(url) +
          '</a></p>'
        : '')
    );
  }

  async function connectBank(options = {}) {
    const { isReconnect = false, resend = false, onDone, onFlash } = options;
    if (
      isReconnect &&
      !resend &&
      !window.confirm(
        'Reconnect may replace the existing open-banking consent. Continue?',
      )
    ) {
      return;
    }

    let status = null;
    try {
      status = await loadStatus();
    } catch {
      status = null;
    }
    const sandbox = isSandboxStatus(status);
    const body = { resend: Boolean(resend) };

    // Production only: collect AU mobile for hosted AuthLink 2FA after open.
    // Basiq does not SMS-deliver the AuthLink URL itself.
    if (!sandbox) {
      const entered = window.prompt(
        'Australian mobile for Basiq AuthLink two-factor authentication (E.164, e.g. +614XXXXXXXX). Used after you open AuthLink — not to SMS you the AuthLink URL. Leave blank to use the business profile phone.',
        '+614',
      );
      if (entered === null) return;
      if (entered.trim()) body.mobile = entered.trim();
    }

    try {
      const result = await api('/api/banking/basiq/connect', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      if (!result?.authLinkUrl) {
        window.alert(result?.message || 'Unable to start bank connection.');
        return;
      }
      if (typeof onFlash === 'function') onFlash(connectFlashHtml(result));
      openAuthLinkUrl(result.authLinkUrl);
      if (typeof onDone === 'function') await onDone();
    } catch (error) {
      window.alert(error?.message || 'Unable to start bank connection.');
    }
  }

  async function refreshBank(onDone) {
    try {
      await api('/api/banking/refresh', { method: 'POST', body: '{}' });
      if (typeof onDone === 'function') await onDone();
    } catch (error) {
      window.alert(error?.message || 'Unable to refresh bank data.');
    }
  }

  async function disconnectBank(onDone) {
    if (
      !window.confirm(
        'Disconnect this bank feed? Imported transactions remain, but the live connection will end.',
      )
    ) {
      return;
    }
    try {
      await api('/api/banking/disconnect', {
        method: 'POST',
        body: JSON.stringify({ confirm: true }),
      });
      if (typeof onDone === 'function') await onDone();
    } catch (error) {
      window.alert(error?.message || 'Unable to disconnect bank feeds.');
    }
  }

  function bindConnectionActions(root, reload, setFlash) {
    root.querySelector('[data-bank-connect]')?.addEventListener('click', () =>
      void connectBank({ isReconnect: false, onDone: reload, onFlash: setFlash }),
    );
    root.querySelector('[data-bank-reconnect]')?.addEventListener('click', () =>
      void connectBank({ isReconnect: true, onDone: reload, onFlash: setFlash }),
    );
    root.querySelector('[data-bank-resend]')?.addEventListener('click', () =>
      void connectBank({
        isReconnect: false,
        resend: true,
        onDone: reload,
        onFlash: setFlash,
      }),
    );
    root.querySelector('[data-bank-refresh]')?.addEventListener('click', () =>
      void refreshBank(reload),
    );
    root.querySelector('[data-bank-disconnect]')?.addEventListener('click', () =>
      void disconnectBank(reload),
    );
  }

  /** Settings → Bank Feeds: connection management only (no full transaction history). */
  async function mountBankFeedsSettings(host) {
    if (!host) return;
    let connectFlash = '';
    const render = async () => {
      host.innerHTML = '<p class="muted">Loading bank feed connection…</p>';
      try {
        const params = new URLSearchParams(location.search);
        const callbackFlash =
          params.get('banking') === 'connected'
            ? '<p class="banking-flash" role="status">Bank connection completed. Accounts were imported where available. Open Banking to browse transactions.</p>'
            : params.get('banking') === 'error'
              ? '<p class="banking-error" role="alert">Bank connection callback failed (' +
                escapeHtml(params.get('reason') || 'unknown') +
                '). No secrets were returned.</p>'
              : '';
        const [status, accounts] = await Promise.all([loadStatus(), loadAccounts()]);
        const sandbox = isSandboxStatus(status);
        host.innerHTML =
          callbackFlash +
          renderConnectionPanel(status, accounts, {
            title: 'Bank Feeds',
            intro: sandbox
              ? 'Sandbox test connection for this Aleya business. Connect opens the Basiq AuthLink (no SMS). Use Banking to browse imported transactions after consent.'
              : 'Connect and manage your Basiq bank feed for this Aleya business. AuthLink opens in the browser. Use Banking in the sidebar to search imported transactions.',
            showTransactionsLink: true,
            connectFlash,
          }) +
          renderAccounts(accounts);
        bindConnectionActions(host, render, (html) => {
          connectFlash = html;
        });
      } catch (error) {
        host.innerHTML =
          '<p class="banking-error" role="alert">Unable to load bank feed settings. ' +
          escapeHtml(error?.message || 'Unknown error') +
          '</p>';
      }
    };
    await render();
  }

  /** Operational Banking page: imported transactions (+ compact connection summary). */
  async function bankingPage() {
    const params = new URLSearchParams(location.search);
    const flash =
      params.get('banking') === 'connected'
        ? '<p class="banking-flash" role="status">Bank connection completed. Manage the feed in Settings → Bank Feeds.</p>'
        : params.get('banking') === 'error'
          ? '<p class="banking-error" role="alert">Bank connection callback failed (' +
            escapeHtml(params.get('reason') || 'unknown') +
            '). No secrets were returned.</p>'
          : '';

    shell(
      [
        '<main class="page banking-page">',
        '<header class="page-header"><div><h1>Banking</h1>',
        '<p class="muted">Browse and search imported bank transactions. Connection and consent are managed in Settings → Bank Feeds.</p>',
        '</div>',
        '<a class="button secondary" href="/settings?tab=bank-feeds" data-route>Bank Feeds settings</a>',
        '</header>',
        flash,
        '<div data-banking-root><p class="muted">Loading transactions…</p></div>',
        '</main>',
      ].join(''),
    );

    const root = document.querySelector('[data-banking-root]');
    const render = async () => {
      try {
        const [status, accounts, transactions] = await Promise.all([
          loadStatus(),
          loadAccounts(),
          loadTransactions(),
        ]);
        root.innerHTML =
          '<section class="banking-panel banking-summary"><p><strong>Status:</strong> ' +
          escapeHtml(statusLabel(status.status)) +
          ' · <strong>Institution:</strong> ' +
          escapeHtml(status.institution || '—') +
          ' · <strong>Account:</strong> ' +
          escapeHtml(status.maskedAccount || '—') +
          ' · <a href="/settings?tab=bank-feeds" data-route>Manage connection</a></p></section>' +
          renderTransactions(transactions, accounts);
        root.querySelector('[data-bank-filters]')?.addEventListener('submit', (event) => {
          event.preventDefault();
          const form = event.currentTarget;
          txState.accountId = form.accountId.value || '';
          txState.search = form.search.value || '';
          txState.offset = 0;
          void render();
        });
        root.querySelector('[data-bank-prev]')?.addEventListener('click', () => {
          txState.offset = Math.max(0, txState.offset - txState.limit);
          void render();
        });
        root.querySelector('[data-bank-next]')?.addEventListener('click', () => {
          txState.offset += txState.limit;
          void render();
        });
      } catch (error) {
        root.innerHTML =
          '<p class="banking-error" role="alert">Unable to load banking data. ' +
          escapeHtml(error?.message || 'Unknown error') +
          '</p>';
      }
    };
    await render();
  }

  return { bankingPage, mountBankFeedsSettings };
}
