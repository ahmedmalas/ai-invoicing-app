#!/usr/bin/env node
/**
 * Patch Vercel Preview + Production Supabase Auth env vars.
 *
 * Requires:
 *   VERCEL_TOKEN
 *   SUPABASE_ANON_KEY (or SUPABASE_PUBLISHABLE_KEY) — never hardcoded
 * Optional:
 *   VERCEL_TEAM_ID / VERCEL_PROJECT_ID / SUPABASE_URL
 *
 * Usage:
 *   VERCEL_TOKEN=... SUPABASE_ANON_KEY=... node scripts/fix-vercel-supabase-env.mjs
 */
const TEAM_ID = process.env.VERCEL_TEAM_ID || 'team_oV08U3snaxnxaI70873bYDka';
const PROJECT_ID = process.env.VERCEL_PROJECT_ID || 'prj_o3Kmm3okLf1jo4LHNVdIJqsUQAV9';
const TOKEN = process.env.VERCEL_TOKEN;
const SUPABASE_URL =
  process.env.SUPABASE_URL || 'https://ntkctiqyvjcjokclkmll.supabase.co';
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || '';

const TARGET_KEYS = [
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_PUBLISHABLE_KEY',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
];

if (!TOKEN) {
  console.error('VERCEL_TOKEN is required');
  process.exit(1);
}

if (!SUPABASE_ANON_KEY) {
  console.error('SUPABASE_ANON_KEY or SUPABASE_PUBLISHABLE_KEY is required (do not hardcode keys in source)');
  process.exit(1);
}

async function api(path, init = {}) {
  const url = new URL(`https://api.vercel.com${path}`);
  url.searchParams.set('teamId', TEAM_ID);
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(`${init.method || 'GET'} ${path} -> ${response.status}: ${text}`);
  }
  return body;
}

function valueFor(key) {
  if (key === 'SUPABASE_URL') return SUPABASE_URL;
  return SUPABASE_ANON_KEY;
}

async function upsertEnv(key, target) {
  const desired = valueFor(key);
  const listed = await api(`/v9/projects/${PROJECT_ID}/env`);
  const existing = (listed.envs || []).filter(
    (item) => item.key === key && (item.target || []).includes(target),
  );

  for (const item of existing) {
    await api(`/v9/projects/${PROJECT_ID}/env/${item.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        value: desired,
        target: item.target,
        type: item.type === 'sensitive' ? 'sensitive' : 'encrypted',
      }),
    });
    console.log(`updated ${key} for ${item.target.join(',')}`);
    return;
  }

  await api(`/v10/projects/${PROJECT_ID}/env`, {
    method: 'POST',
    body: JSON.stringify({
      key,
      value: desired,
      type: 'encrypted',
      target: [target],
    }),
  });
  console.log(`created ${key} for ${target}`);
}

async function main() {
  for (const target of ['production', 'preview']) {
    for (const key of TARGET_KEYS) {
      // Keep URL + public key aliases in sync for Preview/Production.
      if (key === 'SUPABASE_URL' || key.endsWith('ANON_KEY') || key.endsWith('PUBLISHABLE_KEY')) {
        await upsertEnv(key, target);
      }
    }
  }
  console.log(
    `Supabase Auth env patch complete (URL=${SUPABASE_URL}). Redeploy Preview/Production to pick up values.`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
