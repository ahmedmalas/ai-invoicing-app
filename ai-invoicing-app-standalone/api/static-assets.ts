/**
 * Serve browser assets without initializing Postgres / Fastify.
 * Prefer CDN filesystem files under public/assets (see prepare-cdn-assets.mjs).
 * This path remains as a fallback when a request still reaches the function.
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

/** Fingerprinted / content-addressed assets may be cached aggressively. */
export const IMMUTABLE_ASSET_CACHE_CONTROL = 'public, max-age=31536000, immutable';
export const SHORT_ASSET_CACHE_CONTROL = 'public, max-age=86400';

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
    for (const full of [join(root, 'assets', fileName), join(root, fileName)]) {
      if (existsSync(full)) return readFileSync(full);
    }
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

function cacheControlFor(fileName: string): string {
  if (fileName === 'build-identity.js' || fileName === 'favicon.svg') {
    return SHORT_ASSET_CACHE_CONTROL;
  }
  return IMMUTABLE_ASSET_CACHE_CONTROL;
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
    const fromDisk = readPublicFile('build-identity.js');
    const body = fromDisk
      ? fromDisk
      : Buffer.from(
          `export const buildIdentity = ${JSON.stringify(createBuildIdentity(process.env))};\n`,
          'utf8',
        );
    response.statusCode = 200;
    response.setHeader('content-type', 'application/javascript; charset=utf-8');
    response.setHeader('cache-control', SHORT_ASSET_CACHE_CONTROL);
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
    const text = body.toString('utf8');
    if (!text.includes('/assets/app.js?v=')) {
      body = Buffer.from(
        text.replace(
          "application.src = '/assets/app.js';",
          `application.src = '/assets/app.js?v=${version}';`,
        ),
        'utf8',
      );
    }
  }

  response.statusCode = 200;
  response.setHeader('content-type', contentTypeFor(fileName));
  response.setHeader('cache-control', cacheControlFor(fileName));
  if (request.method === 'HEAD') {
    response.end();
  } else {
    response.end(body);
  }
  return true;
}
