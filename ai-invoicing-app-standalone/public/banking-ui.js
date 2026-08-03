/** Bank Feeds UI — provider retired. Neutral placeholder until a new provider is configured. */

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function neutralBankFeedsPanel(options = {}) {
  const title = options.title || 'Bank Feeds';
  const kicker = options.kicker || 'Banking';
  return [
    '<section class="panel settings-bank-feeds-panel">',
    '<header class="panel-head"><h2>' + escapeHtml(title) + '</h2></header>',
    '<div class="panel-body banking-placeholder">',
    '<p class="banking-placeholder-status"><strong>Bank feeds are not connected yet.</strong></p>',
    '<p class="muted">' +
      escapeHtml(
        'The previous bank-feed provider has been retired. A new bank-feed provider is being configured. Existing invoices, payments and business records are unchanged.',
      ) +
      '</p>',
    '<div class="actions banking-placeholder-actions">',
    '<button type="button" class="button" disabled aria-disabled="true" title="Bank-feed provider not configured yet">Connect bank account</button>',
    '</div>',
    '<p class="muted banking-placeholder-note">Connect bank account will be available once the new provider is ready.</p>',
    '</div>',
    '</section>',
  ].join('');
}

export function createBankingUi({ api: _api, shell }) {
  async function mountBankFeedsSettings(host) {
    if (!host) return;
    host.innerHTML = neutralBankFeedsPanel({
      title: 'Bank Feeds',
      kicker: 'Settings',
    });
  }

  async function bankingPage() {
    shell(
      '<main class="page banking-page">' +
        '<header class="page-head"><div><span class="kicker">Banking</span><h1>Bank Feeds</h1>' +
        '<p>Imported bank activity will appear here after a provider is connected.</p></div></header>' +
        neutralBankFeedsPanel({ title: 'Connection' }) +
        '</main>',
    );
  }

  return {
    mountBankFeedsSettings,
    bankingPage,
  };
}
