import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';

import { afterEach, describe, expect, it } from 'vitest';

import { isStaticAssetPath, tryServeStaticAsset } from '../../api/static-assets.js';

async function listen(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server = createServer(handler);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no address');
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

describe('static asset serving without DB boot', () => {
  let close: (() => Promise<void>) | undefined;

  afterEach(async () => {
    if (close) await close();
    close = undefined;
  });

  it('recognizes asset paths', () => {
    expect(isStaticAssetPath('/assets/styles.css')).toBe(true);
    expect(isStaticAssetPath('/assets/banking-ui.js')).toBe(true);
    expect(isStaticAssetPath('/favicon.svg')).toBe(true);
    expect(isStaticAssetPath('/settings')).toBe(false);
    expect(isStaticAssetPath('/api/banking/status')).toBe(false);
  });

  it('serves CSS/JS from public without invoking a custom app builder', async () => {
    let appBuilds = 0;
    const runtime = await listen((request, response) => {
      if (tryServeStaticAsset(request, response)) return;
      appBuilds += 1;
      response.statusCode = 500;
      response.end('should-not-build-app');
    });
    close = runtime.close;

    const css = await fetch(`${runtime.baseUrl}/assets/styles.css`);
    expect(css.status).toBe(200);
    expect(css.headers.get('content-type')).toContain('text/css');
    expect((await css.text()).length).toBeGreaterThan(20);

    const js = await fetch(`${runtime.baseUrl}/assets/banking-ui.js`);
    expect(js.status).toBe(200);
    expect(js.headers.get('content-type')).toContain('javascript');
    expect(await js.text()).toContain('createBankingUi');

    const identity = await fetch(`${runtime.baseUrl}/assets/build-identity.js`);
    expect(identity.status).toBe(200);
    expect(await identity.text()).toContain('buildIdentity');

    expect(appBuilds).toBe(0);
  });
});
