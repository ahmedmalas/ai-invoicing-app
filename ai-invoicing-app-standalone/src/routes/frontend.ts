import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyPluginAsync } from 'fastify';

const tracedAssets = {
  'index.html': new URL('../../public/index.html', import.meta.url),
  'styles.css': new URL('../../public/styles.css', import.meta.url),
  'app.js': new URL('../../public/app.js', import