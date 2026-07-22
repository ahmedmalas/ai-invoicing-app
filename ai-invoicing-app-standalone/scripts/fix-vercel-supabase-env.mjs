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
 *
 * Also removes gitBranch-specific overrides for Auth keys so Preview/Production
 * scopes are not shadowed by stale branch env pointing at old hosts.
 */
const TEAM_ID = process.env.VERCEL_TEAM_ID || 'team_oV08U3snaxnxaI70873bYDka';
const PROJECT_ID = process.env.VERCEL_PROJECT_ID || 'prj_o3Kmm3okLf1jo4LHNVdIJqsUQAV9';
const TOKEN = process.env.VERCEL_TOKEN;
const SUPABASE_URL =
  process.env.SUPABASE_URL || 'https://jsrxhisdjvwsufbqqtir.supabase.co';
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || '';

const TARGET_KEYS = [
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_PUBLISHABLE_KEY',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
];

const STALE_HOST_MARKERS = ['ntkctiqyvjcjokclkmll', 'bmfpclozzmeekazmoaxw'];

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

async function listEnvs({ decrypt = false } = {}) {
  const path = decrypt
    ? `/v9/projects/${PROJECT_ID}/env?decrypt=true`
    : `/v9/projects/${PROJECT_ID}/env`;
  const listed = await api(path);
  return listed.envs || [];
}

async function removeBranchOverrides() {
  const envs = await listEnvs();
  for (const item of envs) {
    if (!TARGET_KEYS.includes(item.key)) continue;
    if (!item.gitBranch) continue;
    await api(`/v9/projects/${PROJECT_ID}/env/${item.id}`, { method: 'DELETE' });
    console.log(`deleted branch override ${item.key} gitBranch=${item.gitBranch}`);
  }
}

async function upsertEnv(key, target) {
  const desired = valueFor(key);
  const envs = await listEnvs();
  const existing = envs.filter(
    (item) => item.key === key && !item.gitBranch && (item.target || []).includes(target),
  );

  for (const item of existing) {
    // If this env row also covers other targets, rewrite only via PATCH keeping shared targets.
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

async function auditEnv() {
  let envs;
  try {
    envs = await listEnvs({ decrypt: true });
  } catch {
    envs = await listEnvs({ decrypt: false });
  }

  for (const item of envs) {
    if (!TARGET_KEYS.includes(item.key)) continue;
    const targets = (item.target || []).join('|') || 'none';
    const branch = item.gitBranch || '-';
    let valueNote = `(${item.type || 'encrypted'})`;
    if (item.key === 'SUPABASE_URL' && typeof item.value === 'string' && item.value) {
      valueNote = item.value;
      for (const stale of STALE_HOST_MARKERS) {
        if (item.value.includes(stale)) {
          valueNote += '  << STALE HOST';
        }
      }
    }
    console.log(`env ${item.key} targets=${targets} gitBranch=${branch} value=${valueNote}`);
  }
}

async function main() {
  await removeBranchOverrides();
  for (const target of ['production', 'preview']) {
    for (const key of TARGET_KEYS) {
      if (key === 'SUPABASE_URL' || key.endsWith('ANON_KEY') || key.endsWith('PUBLISHABLE_KEY')) {
        await upsertEnv(key, target);
      }
    }
  }
  console.log(
    `Supabase Auth env patch complete (URL=${SUPABASE_URL}). Redeploy Preview/Production to pick up values.`,
  );
  await auditEnv();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
