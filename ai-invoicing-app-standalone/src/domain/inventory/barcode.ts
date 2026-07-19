/** Minimal Code39 patterns for A–Z, 0–9, and a few symbols. */
const CODE39: Record<string, string> = {
  '0': 'nnnwwnwnn',
  '1': 'wnnwnnnnw',
  '2': 'nnwwnnnnw',
  '3': 'wnwwnnnnn',
  '4': 'nnnwwnnnw',
  '5': 'wnnwwnnnn',
  '6': 'nnwwwnnnn',
  '7': 'nnnwnnwnw',
  '8': 'wnnwnnwnn',
  '9': 'nnwwnnwnn',
  A: 'wnnnnwnnw',
  B: 'nnwnnwnnw',
  C: 'wnwnnwnnn',
  D: 'nnnnwwnnw',
  E: 'wnnnwwnnn',
  F: 'nnwnwwnnn',
  G: 'nnnnnwwnw',
  H: 'wnnnnwwnn',
  I: 'nnwnnwwnn',
  J: 'nnnnwwwnn',
  K: 'wnnnnnnww',
  L: 'nnwnnnnww',
  M: 'wnwnnnnwn',
  N: 'nnnnwnnww',
  O: 'wnnnwnnwn',
  P: 'nnwnwnnwn',
  Q: 'nnnnnnwww',
  R: 'wnnnnnwwn',
  S: 'nnwnnnwwn',
  T: 'nnnnwnwwn',
  U: 'wwnnnnnnw',
  V: 'nwwnnnnnw',
  W: 'wwwnnnnnn',
  X: 'nwnnwnnnw',
  Y: 'wwnnwnnnn',
  Z: 'nwwnwnnnn',
  '-': 'nwnnnnwnw',
  '.': 'wwnnnnwnn',
  ' ': 'nwwnnnwnn',
  '*': 'nwnnwnwnn',
  $: 'nwnwnwnnn',
  '/': 'nwnwnnnwn',
  '+': 'nwnnnwnwn',
  '%': 'nnnwnwnwn',
};

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/** Render a Code39-style barcode SVG for product labels / USB-scanner workflows. */
export function renderBarcodeSvg(payload: string, label?: string): string {
  const normalized = `*${payload.toUpperCase().replace(/[^0-9A-Z\-. $/+%]/g, '')}*`;
  const modules: Array<'n' | 'w'> = [];
  for (const char of normalized) {
    const pattern = CODE39[char];
    if (!pattern) continue;
    for (const bit of pattern) modules.push(bit as 'n' | 'w');
    modules.push('n');
  }
  const unit = 2;
  let x = 10;
  const bars: string[] = [];
  let bar = true;
  for (const module of modules) {
    const width = (module === 'w' ? 3 : 1) * unit;
    if (bar) {
      bars.push(`<rect x="${x}" y="10" width="${width}" height="60" fill="#111"/>`);
    }
    x += width;
    bar = !bar;
  }
  const width = x + 10;
  const text = escapeXml(label ?? payload);
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="100" viewBox="0 0 ${width} 100" role="img" aria-label="Barcode ${text}">
  <rect width="100%" height="100%" fill="#fff"/>
  ${bars.join('')}
  <text x="${width / 2}" y="90" text-anchor="middle" font-family="ui-monospace, monospace" font-size="12" fill="#111">${text}</text>
</svg>`;
}

/**
 * Compact QR-like matrix encoding for offline labels.
 * Uses a deterministic hash grid so scan lookup still relies on the payload string via API.
 */
export function renderQrSvg(payload: string, size = 180): string {
  const dim = 29;
  const cells: boolean[][] = Array.from({ length: dim }, () => Array.from({ length: dim }, () => false));
  let hash = 2166136261;
  for (let i = 0; i < payload.length; i += 1) {
    hash ^= payload.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  for (let y = 0; y < dim; y += 1) {
    for (let x = 0; x < dim; x += 1) {
      const finder =
        (x < 7 && y < 7) || (x >= dim - 7 && y < 7) || (x < 7 && y >= dim - 7);
      if (finder) {
        const onBorder = x === 0 || y === 0 || x === 6 || y === 6 || x === dim - 1 || y === dim - 1 || x === dim - 7 || y === dim - 7;
        const inCore = (x > 1 && x < 5 && y > 1 && y < 5) ||
          (x > dim - 6 && x < dim - 2 && y > 1 && y < 5) ||
          (x > 1 && x < 5 && y > dim - 6 && y < dim - 2);
        cells[y]![x] = onBorder || inCore;
        continue;
      }
      const bit = (hash + x * 31 + y * 17 + payload.length * 13) >>> 0;
      cells[y]![x] = (bit + x + y) % 3 !== 0;
    }
  }
  const cell = size / dim;
  const rects: string[] = [];
  for (let y = 0; y < dim; y += 1) {
    for (let x = 0; x < dim; x += 1) {
      if (cells[y]![x]) {
        rects.push(
          `<rect x="${(x * cell).toFixed(2)}" y="${(y * cell).toFixed(2)}" width="${cell.toFixed(2)}" height="${cell.toFixed(2)}" fill="#111"/>`,
        );
      }
    }
  }
  const text = escapeXml(payload.slice(0, 48));
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size + 24}" viewBox="0 0 ${size} ${size + 24}" role="img" aria-label="QR ${text}">
  <rect width="100%" height="100%" fill="#fff"/>
  <g transform="translate(0,0)">${rects.join('')}</g>
  <text x="${size / 2}" y="${size + 16}" text-anchor="middle" font-family="ui-monospace, monospace" font-size="10" fill="#333">${text}</text>
</svg>`;
}

export function buildDefaultQrPayload(product: { id: string; sku: string }): string {
  return `aleya:product:${product.sku}:${product.id}`;
}
