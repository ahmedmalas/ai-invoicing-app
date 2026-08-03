#!/usr/bin/env node
/**
 * Audit + fix Preview database env for ai-invoicing-app.
 *
 * - Lists DATABASE_URL / POSTGRES_* hostnames for Production vs Preview (masked)
 * - Detects stale project refs (ntkctiqyvjcjokclkmll, bmfpclozzmeekazmoaxw)
 * - Copies Production DATABASE_URL (or POSTGRES_URL) onto Preview only
 * - Never modifies Production env values
 * - Optionally redeploys a specific git commit / existing deployment
 *
 * Requires: VERCEL_TOKEN
 * Optional:
 *   VERCEL_TEAM_ID / VERCEL_PROJECT_ID
 *   REDEPLOY_COMMIT (default: 18f40076bf42ebcf13f0e37e82b65b6951ca2c4a)
 *   REDEPLOY_BRANCH (default: cursor/initial-load-performance-7128)
 *   SKIP_REDEPLOY=1
 *   DRY_RUN=1
 */
const TEAM_ID = process.env.VERCEL_TEAM_ID || 'team_oV08U3snaxnxaI70873bYDka';
const PROJECT_ID = process.env.VERCEL_PROJECT_ID || 'prj_o3Kmm3okLf1jo4LHNVdIJqsUQAV9';
const TOKEN = process.env.VERCEL_TOKEN;
const REDEPLOY_COMMIT =
  process.env.REDEPLOY_COMMIT || '18f40076bf42ebcf13f0e37e82b65b6951ca2c4a';
const REDEPLOY_BRANCH = process.env.REDEPLOY_BRANCH || 'cursor/initial-load-performance-7128';
const SKIP_REDEPLOY = process.env.SKIP_REDEPLOY === '1';
const DRY_RUN = process.env.DRY_RUN === '1';

const STALE_MARKERS = ['ntkctiqyvjcjokclkmll', 'bmfpclozzmeekazmoaxw'];
const DB_KEYS = [
  'DATABASE_URL',
  'POSTGRES_URL',
  'POSTGRES_PRISMA_URL',
  'POSTGRES_URL_NON_POOLING',
  'POSTGRES_HOST',
  'DB_POOL_MAX',
  'DB_PATH',
];

if (!TOKEN) {
  console.error('VERCEL_TOKEN is required');
  process.exit(1);
}

async function api(path, init = {}) {
  const url = new URL(`https://api.vercel.com${path}`);
  if (!url.searchParams.has('teamId')) url.searchParams.set('teamId', TEAM_ID);
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
    throw new Error(`${init.method || 'GET'} ${path} -> ${response.status}: ${text.slice(0, 500)}`);
  }
  return body;
}

function maskHostFromValue(value) {
  if (typeof value !== 'string' || !value) return { host: null, complete: false, stale: false };
  let host = null;
  try {
    const normalized = value.includes('://') ? value : `postgresql://${value}`;
    host = new URL(normalized).hostname || null;
  } catch {
    const m = value.match(/@([^:/?]+)/);
    host = m ? m[1] : null;
  }
  const stale = STALE_MARKERS.some((marker) => (value.includes(marker) || (host || '').includes(marker)));
  const complete = Boolean(host && host.includes('.') && !/^postgres\.[a-z0-9]+$/i.test(host));
  return { host, complete, stale };
}

async function listEnvs() {
  // Prefer CLI-style decrypt for encrypted (non-sensitive) values.
  try {
    const listed = await api(
      `/v10/projects/${PROJECT_ID}/env?decrypt=true&source=vercel-cli:pull`,
    );
    return listed.envs || [];
  } catch {
    const listed = await api(`/v9/projects/${PROJECT_ID}/env?decrypt=true`);
    return listed.envs || [];
  }
}

function summarize(envs) {
  const rows = [];
  for (const item of envs) {
    if (!DB_KEYS.includes(item.key)) continue;
    const targets = item.target || [];
    const { host, complete, stale } = maskHostFromValue(item.value);
    rows.push({
      key: item.key,
      id: item.id,
      targets,
      gitBranch: item.gitBranch || null,
      type: item.type,
      host,
      complete,
      stale,
      hasValue: typeof item.value === 'string' && item.value.length > 0,
      valueLen: typeof item.value === 'string' ? item.value.length : 0,
    });
  }
  return rows;
}

function printAudit(rows) {
  console.log('=== Database env audit (hostnames only) ===');
  for (const row of rows) {
    console.log(
      [
        `key=${row.key}`,
        `targets=${(row.targets || []).join('|') || 'none'}`,
        `gitBranch=${row.gitBranch || '-'}`,
        `type=${row.type}`,
        `host=${row.host || '(unavailable)'}`,
        `completeDomain=${row.complete}`,
        `staleMarker=${row.stale}`,
        `hasValue=${row.hasValue}`,
      ].join(' '),
    );
  }
}

function pickSourceUrl(envs) {
  const production = envs.filter(
    (item) =>
      !item.gitBranch &&
      (item.target || []).includes('production') &&
      typeof item.value === 'string' &&
      item.value.length > 0,
  );
  const databaseUrl = production.find((item) => item.key === 'DATABASE_URL');
  if (databaseUrl) return { key: 'DATABASE_URL', value: databaseUrl.value, id: databaseUrl.id };
  const postgresUrl = production.find((item) => item.key === 'POSTGRES_URL');
  if (postgresUrl) return { key: 'POSTGRES_URL', value: postgresUrl.value, id: postgresUrl.id };
  return null;
}

async function upsertPreviewEnv(key, value, existingEnvs) {
  const previewRows = existingEnvs.filter(
    (item) => item.key === key && !item.gitBranch && (item.target || []).includes('preview'),
  );

  // Prefer updating a preview-only row. Never PATCH a row that also targets production.
  const previewOnly = previewRows.filter(
    (item) => (item.target || []).length === 1 && item.target[0] === 'preview',
  );
  const sharedWithProduction = previewRows.filter((item) =>
    (item.target || []).includes('production'),
  );

  if (sharedWithProduction.length && !previewOnly.length) {
    throw new Error(
      `${key} is shared across production+preview on the same env row(s). Refusing to PATCH shared row(s) so Production stays untouched. Create a Preview-only ${key} in the dashboard, or split targets first.`,
    );
  }

  if (DRY_RUN) {
    console.log(`DRY_RUN would upsert Preview ${key} (host=${maskHostFromValue(value).host})`);
    return;
  }

  if (previewOnly.length) {
    for (const item of previewOnly) {
      await api(`/v9/projects/${PROJECT_ID}/env/${item.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          value,
          target: ['preview'],
          type: item.type === 'sensitive' ? 'sensitive' : 'encrypted',
        }),
      });
      console.log(`updated Preview-only ${key} id=${item.id}`);
    }
    return;
  }

  await api(`/v10/projects/${PROJECT_ID}/env`, {
    method: 'POST',
    body: JSON.stringify({
      key,
      value,
      type: 'encrypted',
      target: ['preview'],
    }),
  });
  console.log(`created Preview-only ${key}`);
}

async function deleteStalePreviewBranchOverrides(envs) {
  for (const item of envs) {
    if (!DB_KEYS.includes(item.key)) continue;
    if (!item.gitBranch) continue;
    const { stale, host } = maskHostFromValue(item.value || '');
    // Only remove explicit gitBranch overrides that look stale/broken.
    if (!stale && item.gitBranch !== REDEPLOY_BRANCH) continue;
    if (DRY_RUN) {
      console.log(
        `DRY_RUN would delete branch override ${item.key} gitBranch=${item.gitBranch} host=${host}`,
      );
      continue;
    }
    await api(`/v9/projects/${PROJECT_ID}/env/${item.id}`, { method: 'DELETE' });
    console.log(`deleted branch override ${item.key} gitBranch=${item.gitBranch} host=${host}`);
  }
}

async function redeployCommit() {
  if (SKIP_REDEPLOY) {
    console.log('SKIP_REDEPLOY=1 — not redeploying');
    return null;
  }

  // Find an existing deployment for the exact commit to redeploy.
  const listed = await api(
    `/v6/deployments?projectId=${PROJECT_ID}&limit=40&branch=${encodeURIComponent(REDEPLOY_BRANCH)}`,
  );
  const deployments = listed.deployments || [];
  const match =
    deployments.find((d) => d.meta?.githubCommitSha === REDEPLOY_COMMIT) ||
    deployments.find((d) => (d.url || '').includes('initial'));

  if (!match) {
    // Force a new deployment from the git ref via deploy hook style: create deployment
    console.log(
      `No existing deployment found for ${REDEPLOY_COMMIT}; creating deployment from git ref ${REDEPLOY_BRANCH}`,
    );
    if (DRY_RUN) return null;
    const created = await api('/v13/deployments', {
      method: 'POST',
      body: JSON.stringify({
        name: 'ai-invoicing-app',
        project: PROJECT_ID,
        gitSource: {
          type: 'github',
          org: 'ahmedmalas',
          repo: 'ai-invoicing-app',
          ref: REDEPLOY_BRANCH,
          sha: REDEPLOY_COMMIT,
        },
        target: null,
      }),
    });
    console.log(`created deployment id=${created.id} url=${created.url} sha=${REDEPLOY_COMMIT}`);
    return created;
  }

  console.log(`redeploying existing deployment ${match.uid || match.id} commit=${REDEPLOY_COMMIT}`);
  if (DRY_RUN) return match;
  const redeployed = await api(`/v13/deployments/${match.uid || match.id}/redeploy`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
  console.log(
    `redeployed id=${redeployed.id || redeployed.uid} url=${redeployed.url} sha=${REDEPLOY_COMMIT}`,
  );
  return redeployed;
}

async function main() {
  const envs = await listEnvs();
  const rows = summarize(envs);
  printAudit(rows);

  const source = pickSourceUrl(envs);
  if (!source) {
    throw new Error('No readable Production DATABASE_URL or POSTGRES_URL value available');
  }
  const sourceHost = maskHostFromValue(source.value);
  console.log(
    `source=${source.key} host=${sourceHost.host} completeDomain=${sourceHost.complete} staleMarker=${sourceHost.stale}`,
  );
  if (sourceHost.stale || !sourceHost.complete) {
    throw new Error('Production source URL looks stale/incomplete; refusing to copy onto Preview');
  }

  await deleteStalePreviewBranchOverrides(envs);

  // Preview should use the same working Postgres URI as Production for this performance PR
  // (schema remains 47; no migration intentionally triggered beyond normal boot skip).
  await upsertPreviewEnv('DATABASE_URL', source.value, envs);

  // If Preview POSTGRES_URL is stale, align it too so alias fallback cannot regress.
  const previewPostgres = envs.find(
    (item) =>
      item.key === 'POSTGRES_URL' &&
      !item.gitBranch &&
      (item.target || []).includes('preview') &&
      !(item.target || []).includes('production'),
  );
  const previewPostgresHost = maskHostFromValue(previewPostgres?.value || '');
  if (previewPostgres && previewPostgresHost.stale) {
    await upsertPreviewEnv('POSTGRES_URL', source.value, envs);
  }

  const after = summarize(await listEnvs());
  printAudit(after);

  const deployment = await redeployCommit();
  if (deployment) {
    console.log(
      JSON.stringify({
        event: 'preview.redeploy.scheduled',
        deploymentId: deployment.id || deployment.uid,
        url: deployment.url,
        commit: REDEPLOY_COMMIT,
        branch: REDEPLOY_BRANCH,
      }),
    );
  }
  console.log('Preview database env fix complete. Production env values were not modified.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
