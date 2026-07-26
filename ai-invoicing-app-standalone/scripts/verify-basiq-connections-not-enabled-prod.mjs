/**
 * Production verification: Connections-not-enabled handling + Hooli health probe.
 * Does not print API keys or full mobiles.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.ALEYA_PROD_URL || 'https://ai-invoicing-app.vercel.app';
const EMAIL = process.env.ALEYA_TEST_EMAIL || 'aleya.launch.validator@cursor.local';
const PASSWORD = process.env.ALEYA_TEST_PASSWORD || 'Guildford1234!';
const OUT =
  process.env.ALEYA_EVIDENCE_DIR ||
  '/opt/cursor/artifacts/basiq-connections-not-enabled';

mkdirSync(OUT, { recursive: true });

async function signIn() {
  const response = await fetch(`${BASE}/api/auth/sign-in`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.access_token) {
    throw new Error(`Sign-in failed: ${response.status}`);
  }
  return body;
}

async function api(token, path, options = {}) {
  const response = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  return { status: response.status, body };
}

async function main() {
  const report = {
    base: BASE,
    email: EMAIL,
    startedAt: new Date().toISOString(),
    steps: [],
    checks: {},
  };

  const session = await signIn();
  report.steps.push({ step: 'sign-in', ok: true });

  const health = await api(session.access_token, '/api/banking/health');
  report.steps.push({
    step: 'health',
    status: health.status,
    configured: health.body.configured,
    authenticated: health.body.authenticated,
    environment: health.body.environment,
    hooliObInstitutionAvailable: health.body.hooliObInstitutionAvailable,
    hooliObOpenBankingMethod: health.body.hooliObOpenBankingMethod,
    errorCategory: health.body.errorCategory,
  });
  writeFileSync(join(OUT, 'health.json'), JSON.stringify(health, null, 2));

  const reported = await api(session.access_token, '/api/banking/basiq/report-hosted-error', {
    method: 'POST',
    body: JSON.stringify({
      error: 'access-denied',
      title: 'Connections not enabled',
      detail: 'Connections not enabled',
      message: 'Connections not enabled — Error: access-denied',
    }),
  });
  report.steps.push({
    step: 'report-hosted-error',
    status: reported.status,
    reason: reported.body.reason,
    code: reported.body.code,
    message: reported.body.message,
  });
  writeFileSync(join(OUT, 'report-hosted-error.json'), JSON.stringify(reported, null, 2));

  const status = await api(session.access_token, '/api/banking/status');
  const errors = Array.isArray(status.body.errors) ? status.body.errors : [];
  const joined = errors.join(' ');
  report.steps.push({
    step: 'status-after-report',
    status: status.status,
    connectionStatus: status.body.status,
    errorCode: status.body.errorCode,
    errors,
    nextAction: status.body.nextAction,
    permissionDenied: status.body.distinction?.permissionDenied,
  });
  writeFileSync(join(OUT, 'status-after-report.json'), JSON.stringify(status, null, 2));

  report.checks = {
    healthOk: health.status === 200 && health.body.authenticated === true,
    reportedConnectionsNotEnabled:
      reported.status === 200 &&
      reported.body.reason === 'connections_not_enabled' &&
      reported.body.code === 'BASIQ_CONNECTIONS_NOT_ENABLED',
    statusSurfacesEnablementMessage:
      status.body.errorCode === 'BASIQ_CONNECTIONS_NOT_ENABLED' &&
      /not enabled for bank connections/i.test(joined) &&
      !/incorrect mobile|invalid api key|\/token/i.test(joined),
    nextActionMentionsDashboard: /basiq dashboard/i.test(String(status.body.nextAction || '')),
    hooliProbePresent: typeof health.body.hooliObInstitutionAvailable === 'boolean',
  };

  report.finishedAt = new Date().toISOString();
  report.ok = Object.values(report.checks).every(Boolean);
  writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(String(error?.stack || error));
  process.exitCode = 1;
});
