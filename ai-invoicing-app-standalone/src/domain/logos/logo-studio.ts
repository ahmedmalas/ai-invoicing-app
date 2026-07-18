import { createHash, randomUUID } from 'node:crypto';

export const LOGO_STYLES = [
  'minimal',
  'luxury',
  'modern',
  'corporate',
  'premium',
  'bold',
  'friendly',
  'technical',
] as const;

export type LogoStyle = (typeof LOGO_STYLES)[number];

export type LogoLayout = 'badge' | 'lockup' | 'wordmark' | 'monogram' | 'emblem' | 'stack';
export type LogoMarkShape = 'circle' | 'rounded-square' | 'hex' | 'shield' | 'pill';

export interface LogoConcept {
  id: string;
  businessName: string;
  tagline: string | null;
  industry: string;
  style: LogoStyle;
  primaryColor: string;
  secondaryColor: string;
  iconIdea: string;
  layout: LogoLayout;
  markShape: LogoMarkShape;
  monogram: string;
  seed: string;
}

export interface LogoGenerateInput {
  businessName: string;
  tagline?: string | undefined;
  industry: string;
  style: LogoStyle;
  primaryColor?: string | undefined;
  secondaryColor?: string | undefined;
  iconIdeas?: string | undefined;
  count?: number | undefined;
}

const STYLE_DEFAULTS: Record<LogoStyle, { primary: string; secondary: string }> = {
  minimal: { primary: '#173f35', secondary: '#e8f5e9' },
  luxury: { primary: '#1a1510', secondary: '#c9a227' },
  modern: { primary: '#0f172a', secondary: '#38bdf8' },
  corporate: { primary: '#0b3d5c', secondary: '#dbeafe' },
  premium: { primary: '#2a1f3d', secondary: '#d4af37' },
  bold: { primary: '#7c1d1d', secondary: '#fde68a' },
  friendly: { primary: '#14532d', secondary: '#86efac' },
  technical: { primary: '#111827', secondary: '#22d3ee' },
};

const LAYOUTS: LogoLayout[] = ['badge', 'lockup', 'wordmark', 'monogram', 'emblem', 'stack'];
const SHAPES: LogoMarkShape[] = ['circle', 'rounded-square', 'hex', 'shield', 'pill'];

function normalizeHex(value: string | undefined, fallback: string): string {
  if (!value) return fallback;
  const trimmed = value.trim();
  if (/^#[0-9A-Fa-f]{6}$/.test(trimmed)) return trimmed.toLowerCase();
  if (/^[0-9A-Fa-f]{6}$/.test(trimmed)) return `#${trimmed.toLowerCase()}`;
  return fallback;
}

export function monogramFromName(businessName: string): string {
  const parts = businessName
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return 'A';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
}

function hashSeed(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 16);
}

function pick<T>(items: readonly T[], salt: string, index: number): T {
  const n = Number.parseInt(salt.slice(index % (salt.length - 1), index % (salt.length - 1) + 2), 16);
  return items[Math.abs(n + index) % items.length]!;
}

export function generateLogoConcepts(input: LogoGenerateInput): LogoConcept[] {
  const businessName = input.businessName.trim();
  const style = input.style;
  const defaults = STYLE_DEFAULTS[style];
  const primaryColor = normalizeHex(input.primaryColor, defaults.primary);
  const secondaryColor = normalizeHex(input.secondaryColor, defaults.secondary);
  const iconIdeas = (input.iconIdeas || input.industry || 'mark').trim();
  const count = Math.min(Math.max(input.count ?? 6, 3), 8);
  const baseSeed = hashSeed(
    [businessName, input.tagline ?? '', input.industry, style, primaryColor, secondaryColor, iconIdeas].join(
      '|',
    ),
  );
  const monogram = monogramFromName(businessName);
  const concepts: LogoConcept[] = [];

  for (let i = 0; i < count; i += 1) {
    const seed = hashSeed(`${baseSeed}:${i}:${randomUUID()}`);
    concepts.push({
      id: randomUUID(),
      businessName,
      tagline: input.tagline?.trim() || null,
      industry: input.industry.trim(),
      style,
      primaryColor: i % 2 === 0 ? primaryColor : secondaryColor,
      secondaryColor: i % 2 === 0 ? secondaryColor : primaryColor,
      iconIdea: iconIdeas.split(/[,/|]/)[i % Math.max(iconIdeas.split(/[,/|]/).length, 1)]!.trim() || iconIdeas,
      layout: pick(LAYOUTS, seed, i),
      markShape: pick(SHAPES, seed, i + 3),
      monogram,
      seed,
    });
  }
  return concepts;
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function markPath(shape: LogoMarkShape, cx: number, cy: number, r: number): string {
  switch (shape) {
    case 'circle':
      return `<circle cx="${cx}" cy="${cy}" r="${r}" />`;
    case 'rounded-square': {
      const s = r * 1.7;
      return `<rect x="${cx - s / 2}" y="${cy - s / 2}" width="${s}" height="${s}" rx="${s * 0.22}" />`;
    }
    case 'hex': {
      const pts = Array.from({ length: 6 }, (_, i) => {
        const a = (Math.PI / 3) * i - Math.PI / 6;
        return `${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`;
      }).join(' ');
      return `<polygon points="${pts}" />`;
    }
    case 'shield':
      return `<path d="M${cx} ${cy - r} L${cx + r * 0.9} ${cy - r * 0.55} V${cy + r * 0.15} C${cx + r * 0.9} ${cy + r * 0.7} ${cx} ${cy + r} ${cx} ${cy + r} C${cx} ${cy + r} ${cx - r * 0.9} ${cy + r * 0.7} ${cx - r * 0.9} ${cy + r * 0.15} V${cy - r * 0.55} Z" />`;
    case 'pill':
      return `<rect x="${cx - r * 1.2}" y="${cy - r * 0.75}" width="${r * 2.4}" height="${r * 1.5}" rx="${r * 0.75}" />`;
  }
}

function iconGlyph(iconIdea: string, cx: number, cy: number, color: string): string {
  const key = iconIdea.toLowerCase();
  if (/leaf|plant|garden|nature|green/.test(key)) {
    return `<path d="M${cx} ${cy + 10} C${cx - 16} ${cy + 2} ${cx - 14} ${cy - 16} ${cx} ${cy - 18} C${cx + 14} ${cy - 16} ${cx + 16} ${cy + 2} ${cx} ${cy + 10} Z" fill="${color}" opacity="0.9"/><path d="M${cx} ${cy + 10} V${cy - 8}" stroke="${color}" stroke-width="2" fill="none"/>`;
  }
  if (/build|home|house|construct|estate/.test(key)) {
    return `<path d="M${cx - 12} ${cy + 8} V${cy - 2} L${cx} ${cy - 14} L${cx + 12} ${cy - 2} V${cy + 8} Z" fill="none" stroke="${color}" stroke-width="2.5"/><rect x="${cx - 3}" y="${cy - 1}" width="6" height="9" fill="${color}"/>`;
  }
  if (/tech|code|digital|soft|data|cloud/.test(key)) {
    return `<circle cx="${cx - 8}" cy="${cy}" r="3" fill="${color}"/><circle cx="${cx + 8}" cy="${cy}" r="3" fill="${color}"/><path d="M${cx - 5} ${cy} H${cx + 5}" stroke="${color}" stroke-width="2"/><path d="M${cx} ${cy - 10} V${cy + 10}" stroke="${color}" stroke-width="2" opacity="0.5"/>`;
  }
  if (/food|cafe|coffee|kitchen|chef/.test(key)) {
    return `<path d="M${cx - 10} ${cy - 4} H${cx + 10} V${cy + 2} C${cx + 10} ${cy + 10} ${cx} ${cy + 14} ${cx} ${cy + 14} C${cx} ${cy + 14} ${cx - 10} ${cy + 10} ${cx - 10} ${cy + 2} Z" fill="none" stroke="${color}" stroke-width="2.5"/><path d="M${cx - 6} ${cy - 10} V${cy - 4} M${cx} ${cy - 12} V${cy - 4} M${cx + 6} ${cy - 10} V${cy - 4}" stroke="${color}" stroke-width="2"/>`;
  }
  if (/star|premium|luxury|gold/.test(key)) {
    return `<polygon points="${cx},${cy - 12} ${cx + 3},${cy - 3} ${cx + 12},${cy - 3} ${cx + 5},${cy + 3} ${cx + 8},${cy + 12} ${cx},${cy + 6} ${cx - 8},${cy + 12} ${cx - 5},${cy + 3} ${cx - 12},${cy - 3} ${cx - 3},${cy - 3}" fill="${color}"/>`;
  }
  // Default abstract spark
  return `<circle cx="${cx}" cy="${cy}" r="4" fill="${color}"/><path d="M${cx} ${cy - 14} V${cy - 7} M${cx} ${cy + 7} V${cy + 14} M${cx - 14} ${cy} H${cx - 7} M${cx + 7} ${cy} H${cx + 14}" stroke="${color}" stroke-width="2.5" stroke-linecap="round"/>`;
}

export function renderLogoSvg(concept: LogoConcept, options?: { size?: number }): string {
  const size = options?.size ?? 320;
  const primary = concept.primaryColor;
  const secondary = concept.secondaryColor;
  const name = escapeXml(concept.businessName);
  const tagline = concept.tagline ? escapeXml(concept.tagline) : '';
  const mono = escapeXml(concept.monogram);
  const mark = markPath(concept.markShape, 70, 70, 42);
  const glyph = iconGlyph(concept.iconIdea, 70, 70, secondary);

  let body = '';
  if (concept.layout === 'monogram' || concept.layout === 'badge' || concept.layout === 'emblem') {
    body = `
      <g fill="${primary}">${mark}</g>
      ${concept.layout === 'emblem' ? glyph : `<text x="70" y="78" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-size="34" font-weight="700" fill="${secondary}">${mono}</text>`}
      <text x="160" y="66" font-family="Georgia, 'Times New Roman', serif" font-size="28" font-weight="700" fill="${primary}">${name}</text>
      ${tagline ? `<text x="160" y="96" font-family="system-ui, sans-serif" font-size="13" fill="#4b5563">${tagline}</text>` : ''}
      <text x="160" y="118" font-family="system-ui, sans-serif" font-size="11" letter-spacing="0.12em" fill="#6b7280">${escapeXml(concept.style.toUpperCase())} · ${escapeXml(concept.industry.toUpperCase())}</text>
    `;
  } else if (concept.layout === 'stack') {
    const stackGlyph = iconGlyph(concept.iconIdea, 160, 72, secondary);
    body = `
      <g fill="${primary}">${markPath(concept.markShape, 160, 72, 48)}</g>
      ${stackGlyph}
      <text x="160" y="150" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-size="26" font-weight="700" fill="${primary}">${name}</text>
      ${tagline ? `<text x="160" y="176" text-anchor="middle" font-family="system-ui, sans-serif" font-size="12" fill="#4b5563">${tagline}</text>` : ''}
    `;
  } else if (concept.layout === 'wordmark') {
    body = `
      <rect x="24" y="48" width="12" height="64" rx="4" fill="${primary}"/>
      <text x="52" y="88" font-family="Georgia, 'Times New Roman', serif" font-size="34" font-weight="700" fill="${primary}">${name}</text>
      ${tagline ? `<text x="52" y="116" font-family="system-ui, sans-serif" font-size="13" fill="#4b5563">${tagline}</text>` : ''}
    `;
  } else {
    // lockup
    body = `
      <g fill="${primary}">${mark}</g>
      ${glyph}
      <text x="130" y="64" font-family="Georgia, 'Times New Roman', serif" font-size="26" font-weight="700" fill="${primary}">${name}</text>
      ${tagline ? `<text x="130" y="92" font-family="system-ui, sans-serif" font-size="13" fill="#4b5563">${tagline}</text>` : `<text x="130" y="92" font-family="system-ui, sans-serif" font-size="12" fill="#6b7280">${escapeXml(concept.industry)}</text>`}
    `;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} 200" width="${size}" height="200" role="img" aria-label="${name} logo">
  <rect width="100%" height="100%" fill="#fbfaf6"/>
  ${body}
</svg>`;
}

export function logoSvgDataUrl(concept: LogoConcept): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(renderLogoSvg(concept))}`;
}

const LOGO_REF_PREFIX = 'aleya-logo:v1:';

export function encodeLogoReference(concept: LogoConcept): string {
  const payload = {
    ...concept,
    svg: renderLogoSvg(concept),
  };
  return LOGO_REF_PREFIX + Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function decodeLogoReference(reference: string | null | undefined): LogoConcept | null {
  if (!reference || !reference.startsWith(LOGO_REF_PREFIX)) return null;
  try {
    const json = Buffer.from(reference.slice(LOGO_REF_PREFIX.length), 'base64url').toString('utf8');
    const parsed = JSON.parse(json) as LogoConcept & { svg?: string };
    if (!parsed?.id || !parsed.businessName || !parsed.primaryColor) return null;
    const concept = { ...parsed };
    delete concept.svg;
    return concept;
  } catch {
    return null;
  }
}

export function logoSvgFromReference(reference: string | null | undefined): string | null {
  if (!reference || !reference.startsWith(LOGO_REF_PREFIX)) return null;
  try {
    const json = Buffer.from(reference.slice(LOGO_REF_PREFIX.length), 'base64url').toString('utf8');
    const parsed = JSON.parse(json) as { svg?: string } & Partial<LogoConcept>;
    if (typeof parsed.svg === 'string' && parsed.svg.includes('<svg')) return parsed.svg;
    if (parsed.id && parsed.businessName && parsed.primaryColor) {
      return renderLogoSvg(parsed as LogoConcept);
    }
    return null;
  } catch {
    return null;
  }
}

export function isAleyaLogoReference(reference: string | null | undefined): boolean {
  return Boolean(reference && reference.startsWith(LOGO_REF_PREFIX));
}
