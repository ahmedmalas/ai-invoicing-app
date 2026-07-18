const escapeHtml = (value) =>
  String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

export const LOGO_STYLE_OPTIONS = [
  'minimal',
  'luxury',
  'modern',
  'corporate',
  'premium',
  'bold',
  'friendly',
  'technical',
];

function base64UrlToUtf8(value) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((value.length + 3) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function logoSrcFromProfile(profile) {
  const reference = profile?.logoReference || '';
  if (!reference.startsWith('aleya-logo:v1:')) return '';
  try {
    const payload = JSON.parse(base64UrlToUtf8(reference.slice('aleya-logo:v1:'.length)));
    if (typeof payload.svg === 'string' && payload.svg.includes('<svg')) {
      return 'data:image/svg+xml;utf8,' + encodeURIComponent(payload.svg);
    }
  } catch {
    return '';
  }
  return '';
}

export function brandMarkHtml(profile, options = {}) {
  const sizeClass = options.sizeClass || '';
  const src = logoSrcFromProfile(profile);
  if (src) {
    return (
      '<img class="brand-logo ' +
      sizeClass +
      '" src="' +
      src +
      '" alt="' +
      escapeHtml(profile.companyName || 'Business logo') +
      '" width="40" height="40">'
    );
  }
  const letter = String(profile?.companyName || 'A')
    .trim()
    .charAt(0)
    .toUpperCase() || 'A';
  return '<span class="brand-mark ' + sizeClass + '">' + escapeHtml(letter) + '</span>';
}

export function buildLogoCreatorPageHtml({ profile = {}, concepts = [], selectedId = '', notice = '' } = {}) {
  const styleOptions = LOGO_STYLE_OPTIONS.map(
    (style) => '<option value="' + style + '">' + style.charAt(0).toUpperCase() + style.slice(1) + '</option>',
  ).join('');

  const cards = concepts.length
    ? concepts
        .map((concept) => {
          const selected = concept.id === selectedId ? ' is-selected' : '';
          return (
            '<article class="logo-card' +
            selected +
            '" data-logo-concept-id="' +
            escapeHtml(concept.id) +
            '">' +
            '<div class="logo-card-preview">' +
            concept.svg +
            '</div>' +
            '<div class="logo-card-meta"><strong>' +
            escapeHtml(concept.layout) +
            '</strong><span>' +
            escapeHtml(concept.markShape) +
            ' · ' +
            escapeHtml(concept.style) +
            '</span></div>' +
            '<div class="logo-card-actions">' +
            '<button type="button" class="button small" data-select-logo="' +
            escapeHtml(concept.id) +
            '">Use this logo</button>' +
            '</div></article>'
          );
        })
        .join('')
    : '<div class="empty-state"><strong>No concepts yet</strong><p>Enter your brand details and generate logo concepts.</p></div>';

  const activeSrc = logoSrcFromProfile(profile);
  const active = activeSrc
    ? '<div class="notice success"><strong>Active workspace logo</strong><br>This logo is used on the dashboard, settings, invoice workspace and PDF documents.</div><div class="logo-active-preview"><img src="' +
      activeSrc +
      '" alt="Active logo" width="280" height="160"></div>'
    : '<div class="notice"><strong>No logo selected yet</strong><br>Generate concepts, pick a favourite, and Aleya will apply it across your documents.</div>';

  return (
    '<main class="page logo-studio-page">' +
    '<header class="page-head"><div><span class="kicker">Aleya Branding</span><h1>Logo Creator</h1><p>Generate multiple logo concepts from your business identity, preview them, and save one as your active Aleya brand mark.</p></div>' +
    '<div class="page-actions"><a class="button secondary" href="/settings" data-route>Business profile</a></div></header>' +
    (notice ? '<div class="notice success">' + escapeHtml(notice) + '</div>' : '') +
    '<section class="grid-2 logo-studio-grid">' +
    '<article class="panel"><header class="panel-head"><h2>Brand brief</h2></header>' +
    '<form class="form panel-body" id="logo-studio-form">' +
    '<label>Business name<input name="businessName" required maxlength="120" value="' +
    escapeHtml(profile.companyName || '') +
    '" autocomplete="organization"></label>' +
    '<label>Tagline <span class="muted">(optional)</span><input name="tagline" maxlength="160" placeholder="Short supporting line"></label>' +
    '<label>Industry<input name="industry" required maxlength="80" placeholder="e.g. Scaffold hire, Cafe, Consulting"></label>' +
    '<label>Style<select name="style" required>' +
    styleOptions +
    '</select></label>' +
    '<div class="form-grid"><label>Primary colour<input name="primaryColor" type="color" value="' +
    escapeHtml(profile.primaryColor || '#173f35') +
    '" required></label><label>Secondary colour<input name="secondaryColor" type="color" value="' +
    escapeHtml(profile.secondaryColor || '#c4f36b') +
    '" required></label></div>' +
    '<label>Preferred icon ideas<input name="iconIdeas" maxlength="200" placeholder="leaf, building, star, coffee…"></label>' +
    '<div class="form-actions"><button class="button" type="submit">Generate logo concepts</button>' +
    '<button class="button secondary" type="button" data-regenerate-logos>Regenerate alternatives</button></div>' +
    '</form></article>' +
    '<article class="panel"><header class="panel-head"><h2>Active branding</h2></header><div class="panel-body stack">' +
    active +
    '</div></article></section>' +
    '<section class="panel logo-results"><header class="panel-head"><h2>Generated concepts</h2><p class="muted">Select a favourite to save it as your workspace logo.</p></header>' +
    '<div class="panel-body logo-card-grid" data-logo-results>' +
    cards +
    '</div></section></main>'
  );
}
