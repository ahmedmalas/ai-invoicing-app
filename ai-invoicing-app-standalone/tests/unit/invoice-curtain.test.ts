import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { INVOICE_CURTAIN_DURATION_MS } from '../../public/invoice-curtain.js';

describe('invoice curtain animation helpers', () => {
  const source = readFileSync(join(process.cwd(), 'public/invoice-curtain.js'), 'utf8');
  const styles = readFileSync(join(process.cwd(), 'public/styles.css'), 'utf8');
  const app = readFileSync(join(process.cwd(), 'public/app.js'), 'utf8');

  it('keeps duration in the perceptible 250–400ms band', () => {
    expect(INVOICE_CURTAIN_DURATION_MS).toBeGreaterThanOrEqual(250);
    expect(INVOICE_CURTAIN_DURATION_MS).toBeLessThanOrEqual(400);
    expect(source).toContain(`INVOICE_CURTAIN_DURATION_MS = ${INVOICE_CURTAIN_DURATION_MS}`);
  });

  it('opens and closes with WAAPI translate3d keyframes (not a single-rAF CSS class flip)', () => {
    expect(source).toContain('curtain.animate');
    expect(source).toContain("translate3d(0, -100%, 0)");
    expect(source).toContain("translate3d(0, 0, 0)");
    expect(source).toContain('prepareCurtainClosedFrame');
    expect(source).toContain('getBoundingClientRect');
    // CSP style-src blocks inline styles in production — never write element.style.
    expect(source).not.toContain('style.transform');
    expect(app).toContain('openInvoiceCurtain');
    expect(app).toContain('closeInvoiceCurtain');
    expect(app).not.toMatch(/requestAnimationFrame\(\(\)\s*=>\s*\{\s*curtain\.classList\.add\('is-open'\)/);
  });

  it('keeps CSS as resting transforms only so mount cannot skip motion', () => {
    expect(styles).toContain('.invoice-curtain');
    expect(styles).toContain('translate3d(0, -100%, 0)');
    expect(styles).toContain('Web Animations API');
    const curtainBlock = styles.slice(
      styles.indexOf('/* Full-page invoice workspace (curtain)'),
      styles.indexOf('.invoice-workspace'),
    );
    expect(curtainBlock).not.toContain('transition:');
  });
});
