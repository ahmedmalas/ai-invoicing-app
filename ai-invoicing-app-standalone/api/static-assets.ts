/**
 * Serve browser assets without initializing Postgres / Fastify.
 * Vercel rewrites `/assets/*` into this serverless function, so cold starts
 * must not run schema migrations just to return CSS/JS.
 */

import { existsSync, readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createBuildIdentity } from '../src/build-identity.js';

const PUBLIC_ROOT_CANDIDATES = [
  fileURLToPath(new URL('../public', import.meta.url)),
  join(process.cwd(), 'public'),
  join(process.cwd(), 'ai-invoicing-app-standalone', 'public'),
];

const ASSET_CONTENT_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.html': 'text/html; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

/** Map request pathname → filename under /public (or generated content). */
function resolvePublicFileName(pathname: string): string | null {
  if (pathname === '/favicon.svg' || pathname === '/favicon.ico') {
    return pathname === '/favicon.svg' ? 'favicon.svg' : null;
  }
  if (!pathname.startsWith('/assets/')) return null;
  const name = pathname.slice('/assets/'.length);
  if (!name || name.includes('..') || name.includes('/') || name.includes('\\')) {
    return null;
  }
  return name;
}

function readPublicFile(fileName: string): Buffer | null {
  for (const root of PUBLIC_ROOT_CANDIDATES) {
    const full = join(root, fileName);
    if (existsSync(full)) return readFileSync(full);
  }
  return null;
}

function contentTypeFor(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  const ext = dot >= 0 ? fileName.slice(dot).toLowerCase() : '';
  return ASSET_CONTENT_TYPES[ext] || 'application/octet-stream';
}

function pathnameOf(request: IncomingMessage): string {
  try {
    return new URL(request.url || '/', 'http://localhost').pathname;
  } catch {
    return (request.url || '/').split('?')[0] || '/';
  }
}

export function isStaticAssetPath(pathname: string): boolean {
  return (
    pathname.startsWith('/assets/') ||
    pathname === '/favicon.svg' ||
    pathname === '/favicon.ico'
  );
}

/**
 * Attempt to serve a static asset. Returns true when a response was written.
 * Never opens a database connection.
 */
export function tryServeStaticAsset(
  request: IncomingMessage,
  response: ServerResponse,
): boolean {
  if (request.method && request.method !== 'GET' && request.method !== 'HEAD') {
    return false;
  }
  const pathname = pathnameOf(request);
  if (!isStaticAssetPath(pathname)) return false;

  if (pathname === '/assets/build-identity.js') {
    const identity = createBuildIdentity(process.env);
    const body = `export const buildIdentity = ${JSON.stringify(identity)};\n`;
    response.statusCode = 200;
    response.setHeader('content-type', 'application/javascript; charset=utf-8');
    response.setHeader('cache-control', 'no-cache, no-store, must-revalidate');
    response.setHeader('pragma', 'no-cache');
    if (request.method === 'HEAD') {
      response.end();
    } else {
      response.end(body);
    }
    return true;
  }

  const fileName = resolvePublicFileName(pathname);
  if (!fileName) {
    response.statusCode = 404;
    response.setHeader('content-type', 'application/json; charset=utf-8');
    response.end(JSON.stringify({ status: 404, code: 'ASSET_NOT_FOUND' }));
    return true;
  }

  let body = readPublicFile(fileName);
  if (!body) {
    response.statusCode = 404;
    response.setHeader('content-type', 'application/json; charset=utf-8');
    response.end(JSON.stringify({ status: 404, code: 'ASSET_NOT_FOUND', file: fileName }));
    return true;
  }

  if (fileName === 'launch-app.js') {
    const identity = createBuildIdentity(process.env);
    const version = identity.appCommitSha.slice(0, 12);
    const source = body
      .toString('utf8')
      .replace(
        "application.src = '/assets/app.js';",
        `application.src = '/assets/app.js?v=${version}';`,
      );
    body = Buffer.from(source, 'utf8');
  }

  response.statusCode = 200;
  response.setHeader('content-type', contentTypeFor(fileName));
  response.setHeader('cache-control', 'no-cache, no-store, must-revalidate');
  response.setHeader('pragma', 'no-cache');
  if (request.method === 'HEAD') {
    response.end();
  } else {
    response.end(body);
  }
  return true;
}
