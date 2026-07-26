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

const CONNECTIONS_NOT_ENABLED_MESSAGE =
  'Your Basiq application is not enabled for bank connections. Enable Connections in Basiq or contact Basiq Support.';

function bankingCallbackErrorHtml(reason) {
  if (reason === 'connections_not_enabled') {
    return (
      '<p class="banking-error" role="alert">' +
      escapeHtml(CONNECTIONS_NOT_ENABLED_MESSAGE) +
      ' This is not caused by an incorrect mobile number or an invalid API key for /token.</p>'
    );
  }
  return (
    '<p class="banking-error" role="alert">Bank connection callback failed (' +
    escapeHtml(reason || 'unknown') +
    '). No secrets were returned.</p>'
  );
}

function connectErrorMessage(error) {
  const category = error?.category || error?.body?.category || '';
  const code = error?.code || error?.body?.code || '';
  if (
    category === 'connections_not_enabled' ||
    code === 'BASIQ_CONNECTIONS_NOT_ENABLED'
  ) {
    return CONNECTIONS_NOT_ENABLED_MESSAGE;
  }
  return error?.message || 'Unable to start bank connection.';
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
        ? 'Sandbox test connection: Confirm your Australian mobile, then open Basiq AuthLink (Hooli). AuthLink SMS verification uses that mobile — Aleya never uses a placeholder ending in 000.'
        : 'Connect a bank via Basiq AuthLink. Confirm the mobile that will receive the AuthLink SMS verification code. Full account numbers are never shown.');
    const connectLabel = sandbox
      ? 'Connect sandbox test bank'
      : 'Connect bank account';
    const showResend =
      status.status === 'connecting' ||
      status.status === 'reauth_required' ||
      status.status === 'error';
    const showChangeMobile =
      Boolean(status.authLinkMobileMasked) ||
      status.status === 'connecting' ||
      status.status === 'reauth_required' ||
      status.status === 'error';
    const maskedMobile = status.authLinkMobileMasked || null;
    return [
      '<section class="banking-panel" data-banking-status data-bank-feeds-panel>',
      '<header class="banking-panel-head">',
      '<h2>' + escapeHtml(title) + '</h2>',
      sandbox
        ? '<p class="banking-warning" role="status">Sandbox — AuthLink opens in the browser. Basiq will SMS a verification code to your confirmed mobile (not a placeholder).</p>'
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
      '<div><dt>AuthLink SMS destination</dt><dd data-authlink-mobile-masked>' +
        escapeHtml(maskedMobile || 'Not set — confirm before connecting') +
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
      showChangeMobile
        ? '<button type="button" class="button secondary" data-bank-change-mobile>Change mobile number</button>'
        : '',
      showResend || status.status === 'error' || status.status === 'connecting'
        ? '<button type="button" class="button secondary" data-bank-fresh-consent>Start fresh consent</button>'
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
    const message = result?.message || 'AuthLink created. Opening Basiq Connect.';
    const url = result?.authLinkUrl || '';
    const masked = result?.authLinkMobileMasked || '';
    const launchMode = result?.launchMode || result?.deliveryMode || '';
    const redirectHint =
      result?.redirectUrlRequired ||
      'https://ai-invoicing-app.vercel.app/api/banking/basiq/callback';
    const safeUrlDisplay =
      launchMode === 'consent_ui_connect' || String(url).includes('consent.basiq.io')
        ? 'https://consent.basiq.io/home?action=connect&state=…'
        : url;
    return (
      '<p><strong>' +
      escapeHtml(message) +
      '</strong></p>' +
      (launchMode === 'consent_ui_connect'
        ? '<p role="status">Launching Consent UI with <code>action=connect</code> (not the manage / Stop sharing page).</p>'
        : '') +
      (masked && launchMode !== 'consent_ui_connect'
        ? '<p data-authlink-mobile-masked>SMS verification destination: <strong>' +
          escapeHtml(masked) +
          '</strong></p>'
        : '') +
      (url
        ? '<p>Open: <a href="' +
          escapeHtml(url) +
          '" target="_blank" rel="noopener noreferrer" data-bank-authlink>' +
          escapeHtml(safeUrlDisplay) +
          '</a></p>'
        : '') +
      '<p class="muted">Basiq Dashboard Redirect URL must be <code>' +
      escapeHtml(redirectHint) +
      '</code> or there will be no return button after consent.</p>'
    );
  }

  function promptAustralianMobile(defaultValue) {
    const entered = window.prompt(
      'Australian mobile for Basiq AuthLink SMS verification (E.164, e.g. +614XXXXXXXX). This is where Basiq sends the code after you open AuthLink — not used to text you the AuthLink URL.',
      defaultValue || '+614',
    );
    if (entered === null) return null;
    const trimmed = entered.trim();
    if (!trimmed) {
      window.alert('A valid Australian mobile (+614XXXXXXXX) is required.');
      return null;
    }
    return trimmed;
  }

  async function connectBank(options = {}) {
    const {
      isReconnect = false,
      resend = false,
      changeMobile = false,
      freshConsent = false,
      onDone,
      onFlash,
    } = options;
    if (
      isReconnect &&
      !resend &&
      !changeMobile &&
      !freshConsent &&
      !window.confirm(
        'Reconnect may replace the existing open-banking consent. Continue?',
      )
    ) {
      return;
    }
    if (
      freshConsent &&
      !window.confirm(
        'Start a fresh Basiq consent? This revokes the current consent and opens a new AuthLink (use when stuck on Stop sharing / manage home).',
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
    const body = {
      resend: Boolean(resend),
      changeMobile: Boolean(changeMobile),
      freshConsent: Boolean(freshConsent),
    };

    // Always collect/confirm AU mobile for AuthLink hosted 2FA (sandbox + production).
    // Never silently reuse Basiq placeholder mobiles ending in 000.
    if (changeMobile || freshConsent || !status?.authLinkMobileMasked) {
      const entered = promptAustralianMobile('+614');
      if (entered === null) return;
      body.mobile = entered;
      body.changeMobile = true;
    } else if (
      !window.confirm(
        'Continue to open Basiq Consent / AuthLink for ' +
          status.authLinkMobileMasked +
          '? If you previously saw only Stop sharing, Aleya will open action=connect instead.',
      )
    ) {
      return;
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
      const launchMode = result.launchMode || result.deliveryMode || '';
      const masked = result.authLinkMobileMasked || status?.authLinkMobileMasked || '';
      if (launchMode === 'consent_ui_connect') {
        if (
          !window.confirm(
            'Ready to open Basiq Consent UI with action=connect (adds a bank under your existing consent). Continue?',
          )
        ) {
          if (typeof onFlash === 'function') onFlash(connectFlashHtml(result));
          if (typeof onDone === 'function') await onDone();
          return;
        }
      } else if (
        masked &&
        !window.confirm(
          'AuthLink ready. Basiq will send the SMS code to ' +
            masked +
            '. Open AuthLink now?',
        )
      ) {
        if (typeof onFlash === 'function') onFlash(connectFlashHtml(result));
        if (typeof onDone === 'function') await onDone();
        return;
      }
      if (typeof onFlash === 'function') onFlash(connectFlashHtml(result));
      openAuthLinkUrl(result.authLinkUrl);
      // Poll status so hosted Consent UI failures (Connections not enabled) surface in Aleya.
      void pollHostedConnectStatus(onDone);
      if (typeof onDone === 'function') await onDone();
    } catch (error) {
      window.alert(connectErrorMessage(error));
    }
  }

  async function pollHostedConnectStatus(onDone) {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 4000));
      try {
        const status = await loadStatus();
        if (
          status?.errorCode === 'BASIQ_CONNECTIONS_NOT_ENABLED' ||
          status?.status === 'error' ||
          status?.connected
        ) {
          if (typeof onDone === 'function') await onDone();
          return;
        }
      } catch {
        // Keep polling briefly; status may be temporarily unavailable.
      }
    }
  }

  async function reportConnectionsNotEnabledFromCallback(reason) {
    if (reason !== 'connections_not_enabled') return;
    try {
      await api('/api/banking/basiq/report-hosted-error', {
        method: 'POST',
        body: JSON.stringify({
          error: 'access-denied',
          title: 'Connections not enabled',
          detail: 'Connections not enabled',
          message: CONNECTIONS_NOT_ENABLED_MESSAGE,
        }),
      });
    } catch {
      // Status reconcile / callback persistence may already have recorded it.
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
    root.querySelector('[data-bank-change-mobile]')?.addEventListener('click', () =>
      void connectBank({
        isReconnect: false,
        resend: false,
        changeMobile: true,
        onDone: reload,
        onFlash: setFlash,
      }),
    );
    root.querySelector('[data-bank-fresh-consent]')?.addEventListener('click', () =>
      void connectBank({
        isReconnect: false,
        resend: false,
        changeMobile: false,
        freshConsent: true,
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
        if (params.get('banking') === 'error') {
          await reportConnectionsNotEnabledFromCallback(params.get('reason'));
        }
        const callbackFlash =
          params.get('banking') === 'connected'
            ? '<p class="banking-flash" role="status">Bank connection completed. Accounts were imported where available. Open Banking to browse transactions.</p>'
            : params.get('banking') === 'error'
              ? bankingCallbackErrorHtml(params.get('reason'))
              : '';
        const [status, accounts] = await Promise.all([loadStatus(), loadAccounts()]);
        const sandbox = isSandboxStatus(status);
        host.innerHTML =
          callbackFlash +
          renderConnectionPanel(status, accounts, {
            title: 'Bank Feeds',
            intro: sandbox
              ? 'Sandbox test connection for this Aleya business. Confirm your Australian mobile for AuthLink SMS verification, then open AuthLink (Hooli). Use Banking to browse imported transactions after consent.'
              : 'Connect and manage your Basiq bank feed for this Aleya business. Confirm the mobile for AuthLink SMS verification, then open AuthLink. Use Banking to search imported transactions.',
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
          ? bankingCallbackErrorHtml(params.get('reason'))
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
