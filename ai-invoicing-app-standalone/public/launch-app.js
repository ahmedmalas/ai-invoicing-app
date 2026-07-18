const originalFetch = window.fetch.bind(window);
let businessProfileResponse = null;
let businessProfileRequest = null;

function isBusinessProfileRead(input, init = {}) {
  const url = typeof input === 'string' ? input : input?.url || '';
  const method = String(init.method || (typeof input !== 'string' ? input?.method : '') || 'GET').toUpperCase();
  return method === 'GET' && new URL(url, location.origin).pathname === '/api/business-profile';
}

window.fetch = async (input, init = {}) => {
  if (!isBusinessProfileRead(input, init)) return originalFetch(input, init);

  if (businessProfileResponse) return businessProfileResponse.clone();

  if (!businessProfileRequest) {
    businessProfileRequest = originalFetch(input, init)
      .then(async (response) => {
        const body = await response.clone().arrayBuffer();
        businessProfileResponse = new Response(body, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        });
        return businessProfileResponse;
      })
      .catch(() => null);
  }

  // Business profile data is optional for the dashboard. Do not hold the
  // complete login-to-dashboard path open while this endpoint wakes up.
  return new Response(JSON.stringify({ status: 404, code: 'BUSINESS_PROFILE_NOT_FOUND' }), {
    status: 404,
    headers: { 'content-type': 'application/json' },
  });
};

const replacements = new Map([
  ['ABoss Invoicing', 'Aleya Invoicing'],
  ['Opening ABoss Invoicing', 'Opening Aleya Invoicing'],
  ['Continue to ABoss', 'Continue to Aleya'],
  ['Use your ABoss Invoicing owner credentials.', 'Use your Aleya Invoicing owner credentials.'],
  ['ABoss could not complete the request.', 'Aleya Invoicing could not complete the request.'],
  ['ABoss Software · Australian business operations', 'Aleya Invoicing · An ABoss Software module'],
]);

function applyBranding(root = document) {
  if (document.title !== 'Aleya Invoicing') document.title = 'Aleya Invoicing';
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    let value = node.nodeValue;
    for (const [from, to] of replacements) value = value.replaceAll(from, to);
    if (node.nodeValue !== value) node.nodeValue = value;
  }
  for (const strong of document.querySelectorAll('.wordmark strong')) {
    if (strong.textContent === 'ABoss') strong.textContent = 'Aleya';
  }
}

const observer = new MutationObserver((records) => {
  for (const record of records) {
    // Title/head text updates must not re-enter branding (document.title is a childList mutation).
    if (record.target === document.head || record.target?.nodeName === 'TITLE' || record.target?.closest?.('head')) {
      continue;
    }
    for (const node of record.addedNodes) {
      if (node.nodeType === Node.ELEMENT_NODE) applyBranding(node);
    }
  }
});
observer.observe(document.body, { childList: true, subtree: true });
applyBranding();

const application = document.createElement('script');
application.type = 'module';
application.src = '/assets/app.js';
application.addEventListener('load', () => applyBranding());
document.head.append(application);
