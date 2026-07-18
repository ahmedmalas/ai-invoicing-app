const originalFetch = window.fetch.bind(window);
let businessProfileResponse = null;
let businessProfileRequest = null;

function requestUrl(input) {
  return typeof input === 'string' ? input : input?.url || '';
}

function requestMethod(input, init = {}) {
  return String(init.method || (typeof input !== 'string' ? input?.method : '') || 'GET').toUpperCase();
}

function businessProfilePathname(input) {
  try {
    return new URL(requestUrl(input), location.origin).pathname;
  } catch {
    return '';
  }
}

function isBusinessProfileRead(input, init = {}) {
  return requestMethod(input, init) === 'GET' && businessProfilePathname(input) === '/api/business-profile';
}

function isBusinessProfileWrite(input, init = {}) {
  const method = requestMethod(input, init);
  return (
    ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) &&
    businessProfilePathname(input) === '/api/business-profile'
  );
}

export function invalidateBusinessProfileCache() {
  businessProfileResponse = null;
  businessProfileRequest = null;
}

// Expose for app.js after profile save without relying on module graph cycles.
window.__aleyaInvalidateBusinessProfileCache = invalidateBusinessProfileCache;

async function cacheBusinessProfileResponse(response) {
  const body = await response.clone().arrayBuffer();
  businessProfileResponse = new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
  return businessProfileResponse;
}

window.fetch = async (input, init = {}) => {
  if (isBusinessProfileWrite(input, init)) {
    const response = await originalFetch(input, init);
    if (response.ok) invalidateBusinessProfileCache();
    return response;
  }

  if (!isBusinessProfileRead(input, init)) return originalFetch(input, init);

  if (businessProfileResponse) return businessProfileResponse.clone();

  if (!businessProfileRequest) {
    businessProfileRequest = originalFetch(input, init)
      .then((response) => cacheBusinessProfileResponse(response))
      .catch((error) => {
        invalidateBusinessProfileCache();
        throw error;
      });
  }

  // Await the real response. Never return a synthetic 404 — that poisoned the
  // dashboard/settings cache and left PDF generation permanently paused.
  const response = await businessProfileRequest;
  return response.clone();
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
