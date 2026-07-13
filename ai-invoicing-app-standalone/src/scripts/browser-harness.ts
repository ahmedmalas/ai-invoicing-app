import { randomBytes, randomUUID } from 'node:crypto';
import { createServer as createHttpServer } from 'node:http';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer as createNetServer } from 'node:net';
import os, { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { buildApp } from '../app.js';

if (process.platform === 'win32' && process.arch === 'arm64') {
  Object.defineProperty(os, 'arch', { value: () => 'x64' });
}
const { default: EmbeddedPostgres } = await import('embedded-postgres');

async function availablePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createNetServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string')
        return reject(new Error('PORT_ALLOCATION_FAILED'));
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

const directory = mkdtempSync(join(tmpdir(), 'aboss-browser-postgres-'));
const databasePort = await availablePort();
const authPort = await availablePort();
const appPort = await availablePort();
const databasePassword = randomBytes(24).toString('hex');
const ownerEmail = 'browser-acceptance@local.invalid';
const ownerPassword = randomBytes(18).toString('base64url') + '!Aa1';
const credentialsPath = process.env.BROWSER_HARNESS_CREDENTIALS_PATH ?? '';
if (!credentialsPath) throw new Error('BROWSER_HARNESS_CREDENTIALS_PATH is required');
mkdirSync(dirname(credentialsPath), { recursive: true });
writeFileSync(credentialsPath, JSON.stringify({ email: ownerEmail, password: ownerPassword }), {
  mode: 0o600,
});

const postgres = new EmbeddedPostgres({
  databaseDir: directory,
  port: databasePort,
  user: 'postgres',
  password: databasePassword,
  persistent: false,
  onLog: () => undefined,
  onError: () => undefined,
});
await postgres.initialise();
await postgres.start();
await postgres.createDatabase('aboss_browser');

let authUser: { id: string; email: string } | null = null;
let authPassword: string | null = null;
const accessToken = randomBytes(32).toString('base64url');
const refreshToken = randomBytes(32).toString('base64url');
const authServer = createHttpServer((request, response) => {
  const chunks: Buffer[] = [];
  request.on('data', (chunk: Buffer) => chunks.push(chunk));
  request.on('end', () => {
    const body = chunks.length
      ? (JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>)
      : {};
    response.setHeader('content-type', 'application/json');
    if (request.method === 'POST' && request.url === '/auth/v1/admin/users') {
      authUser = { id: randomUUID(), email: String(body.email) };
      authPassword = String(body.password);
      response.end(JSON.stringify(authUser));
      return;
    }
    if (request.method === 'DELETE' && request.url?.startsWith('/auth/v1/admin/users/')) {
      authUser = null;
      authPassword = null;
      response.end('{}');
      return;
    }
    if (request.method === 'POST' && request.url?.startsWith('/auth/v1/token')) {
      const passwordGrant = request.url.includes('grant_type=password');
      const refreshGrant = request.url.includes('grant_type=refresh_token');
      const validPassword =
        !passwordGrant ||
        (String(body.email).toLowerCase() === authUser?.email.toLowerCase() &&
          String(body.password) === authPassword);
      const validRefresh = !refreshGrant || body.refresh_token === refreshToken;
      if (!authUser || !validPassword || !validRefresh) {
        response.statusCode = 401;
        response.end(JSON.stringify({ message: 'Invalid credentials' }));
        return;
      }
      response.end(
        JSON.stringify({
          access_token: accessToken,
          refresh_token: refreshToken,
          token_type: 'bearer',
          expires_in: 3600,
          user: authUser,
        }),
      );
      return;
    }
    if (request.method === 'GET' && request.url === '/auth/v1/user') {
      if (!authUser || request.headers.authorization !== `Bearer ${accessToken}`) {
        response.statusCode = 401;
        response.end(JSON.stringify({ message: 'Invalid token' }));
        return;
      }
      response.end(JSON.stringify(authUser));
      return;
    }
    if (request.method === 'POST' && request.url === '/auth/v1/logout') {
      response.statusCode = 204;
      response.end();
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ message: 'Not found' }));
  });
});
await new Promise<void>((resolve) => authServer.listen(authPort, '127.0.0.1', resolve));

const databaseUrl = `postgresql://postgres:${encodeURIComponent(databasePassword)}@127.0.0.1:${databasePort}/aboss_browser`;
const app = await buildApp({
  databaseUrl,
  nodeEnv: 'development',
  serveFrontend: true,
  supabaseUrl: `http://127.0.0.1:${authPort}`,
  supabaseAnonKey: 'local-public-key',
  supabaseServiceRoleKey: 'local-server-key',
  enableStructuredLogging: false,
});
await app.listen({ host: '127.0.0.1', port: appPort });
process.stdout.write(`BROWSER_HARNESS_READY=http://127.0.0.1:${appPort}\n`);

let closing = false;
async function close(): Promise<void> {
  if (closing) return;
  closing = true;
  await app.close().catch(() => undefined);
  await new Promise<void>((resolve) => authServer.close(() => resolve()));
  await postgres.stop().catch(() => undefined);
  rmSync(directory, { recursive: true, force: true });
  rmSync(credentialsPath, { force: true });
}
process.once('SIGINT', () => void close().finally(() => process.exit(0)));
process.once('SIGTERM', () => void close().finally(() => process.exit(0)));
