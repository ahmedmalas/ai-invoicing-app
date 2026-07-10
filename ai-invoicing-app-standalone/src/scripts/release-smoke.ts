import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildApp } from '../app.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function requestJson(url: string): Promise<{ response: Response; body: unknown }> {
  const response = await fetch(url);
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { response, body };
}

async function main(): Promise<void> {
  const tempDir = mkdtempSync(join(tmpdir(), 'ai-business-os-release-smoke-'));
  const dbPath = join(tempDir, 'release-smoke.db');

  const app = await buildApp({
    dbPath,
    nodeEnv: 'production',
    serviceName: 'ai-business-os-release-candidate',
    logLevel: 'info',
    enableStructuredLogging: true,
    organizationId: 'single-tenant',
    authBypassForTesting: false,
  });

  try {
    await app.listen({ host: '127.0.0.1', port: 0 });
    const listeningAddress = app.server.address();
    assert(
      listeningAddress !== null && typeof listeningAddress === 'object' && 'port' in listeningAddress,
      'Unable to resolve listening address',
    );
    const baseUrl = `http://127.0.0.1:${listeningAddress.port}`;

    const health = await requestJson(`${baseUrl}/health`);
    assert(health.response.status === 200, `Expected /health=200, received ${health.response.status}`);
    assert(
      typeof health.body === 'object' && health.body !== null && 'status' in health.body && health.body.status === 'ok',
      'Expected /health payload status=ok',
    );

    const healthLive = await requestJson(`${baseUrl}/health/live`);
    assert(healthLive.response.status === 200, `Expected /health/live=200, received ${healthLive.response.status}`);
    assert(
      typeof healthLive.body === 'object' &&
        healthLive.body !== null &&
        'status' in healthLive.body &&
        healthLive.body.status === 'ok',
      'Expected /health/live payload status=ok',
    );

    const healthReady = await requestJson(`${baseUrl}/health/ready`);
    assert(healthReady.response.status === 200, `Expected /health/ready=200, received ${healthReady.response.status}`);
    assert(
      typeof healthReady.body === 'object' &&
        healthReady.body !== null &&
        'status' in healthReady.body &&
        healthReady.body.status === 'ready',
      'Expected /health/ready payload status=ready',
    );

    const diagnostics = await requestJson(`${baseUrl}/health/diagnostics`);
    assert(
      diagnostics.response.status === 401,
      `Expected /health/diagnostics unauthenticated=401, received ${diagnostics.response.status}`,
    );

    const search = await requestJson(`${baseUrl}/search?q=smoke`);
    assert(search.response.status === 401, `Expected /search unauthenticated=401, received ${search.response.status}`);

    const backup = await requestJson(`${baseUrl}/platform/backup`);
    assert(
      backup.response.status === 401,
      `Expected /platform/backup unauthenticated=401, received ${backup.response.status}`,
    );

    console.log('release smoke: passed');
  } finally {
    await app.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
}

void main().catch((error: unknown) => {
  console.error('release smoke: failed');
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
