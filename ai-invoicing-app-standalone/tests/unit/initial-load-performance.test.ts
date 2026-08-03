import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(process.cwd());
const read = (relative: string) => readFileSync(join(root, relative), 'utf8');

describe('initial-load performance guards', () => {
  it('keeps /assets out of the serverless catch-all rewrite and sets CDN cache headers', () => {
    const vercel = JSON.parse(read('vercel.json')) as {
      headers?: Array<{ source: string; headers: Array<{ key: string; value: string }> }>;
      rewrites?: Array<{ source: string; destination: string }>;
    };
    expect(vercel.rewrites?.[0]?.source).toContain('?!assets/');
    const assetHeader = vercel.headers?.find((entry) => entry.source.includes('/assets/'));
    expect(assetHeader?.headers.some((h) => h.key === 'Cache-Control' && h.value.includes('immutable')))
      .toBe(true);
  });

  it('prepares public/assets during build for filesystem CDN serving', () => {
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    expect(pkg.scripts.build).toContain('prepare-cdn-assets');
    const script = read('scripts/prepare-cdn-assets.mjs');
    expect(script).toContain("join(publicDir, 'assets')");
    expect(script).toContain('build-identity.js');
  });

  it('paints the app shell before waiting on every workspace dataset', () => {
    const app = read('public/app.js');
    expect(app).toContain('deferQuotes');
    expect(app).toContain("api('/api/reports/read-model?limit=100')");
    expect(app).not.toContain("api('/api/reports/read-model?limit=500')");
    expect(app).toContain('ensureFreshSession');
    expect(app).toContain('refreshInFlight');
    expect(app).toMatch(/shell\(\s*'<main class="boot"/);
  });

  it('serves static assets with cacheable Cache-Control (not no-store)', () => {
    const staticAssets = read('api/static-assets.ts');
    expect(staticAssets).toContain('IMMUTABLE_ASSET_CACHE_CONTROL');
    expect(staticAssets).not.toMatch(/cache-control',\s*'no-cache, no-store/);
  });
});
