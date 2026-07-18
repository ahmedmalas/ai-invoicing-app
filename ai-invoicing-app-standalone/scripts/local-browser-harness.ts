/**
 * Local browser regression harness for Aleya Invoicing.
 * Serves the frontend with auth bypass (no Supabase) for UI validation.
 */
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { buildApp } from '../src/app.js';

const BYPASS_USER_ID = '00000000-0000-0000-0000-000000000001';
const port = Number(process.env.PORT || 4310);
const dbPath = resolve(process.cwd(), process.env.DB_PATH || './data/local-browser-harness.db');
mkdirSync(dirname(dbPath), { recursive: true });

const app = await buildApp({
  dbPath,
  nodeEnv: 'test',
  authBypassForTesting: true,
  serveFrontend: true,
  corsOrigin: `http://127.0.0.1:${port}`,
  publicAppUrl: `http://127.0.0.1:${port}`,
  enableStructuredLogging: false,
  logLevel: 'warn',
});

await app.db.provisionWorkspaceOwner({
  authUserId: BYPASS_USER_ID,
  displayName: 'Local Harness Owner',
  email: 'harness@local.test',
  workspaceName: 'Local Harness Workspace',
});

await app.db.upsertBusinessProfile({
  companyName: 'Aleya Hire Co',
  address: '1 Hire Road, Sydney NSW',
  abnTaxId: '12345678901',
  email: 'accounts@aleya.test',
  phone: '0400111222',
  primaryColor: '#173f35',
  secondaryColor: '#c4f36b',
});

await app.listen({ port, host: '127.0.0.1' });
console.log(`ALEYA_HARNESS_READY http://127.0.0.1:${port}`);
