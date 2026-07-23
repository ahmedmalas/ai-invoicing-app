/**
 * Non-sensitive runtime identity for verifying which invoice implementation is live.
 * Values are injected by the server when serving /assets/build-identity.js and /health/build.
 */

export const INVOICE_UI_VERSION = 'canonical-v3';

export type BuildIdentity = {
  appCommitSha: string;
  appBuildId: string;
  invoiceUiVersion: string;
  invoicePathway: string;
};

export function createBuildIdentity(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = {},
): BuildIdentity {
  const commit =
    String(env.VERCEL_GIT_COMMIT_SHA || env.APP_COMMIT_SHA || env.COMMIT_SHA || '').trim() ||
    'local-dev';
  const buildId =
    String(env.VERCEL_DEPLOYMENT_ID || env.APP_BUILD_ID || env.BUILD_ID || '').trim() || 'local-dev';
  return {
    appCommitSha: commit,
    appBuildId: buildId,
    invoiceUiVersion: INVOICE_UI_VERSION,
    invoicePathway: 'canonical-state-payload-api',
  };
}

export function formatBuildIdentityLog(identity: BuildIdentity): string {
  return (
    `[Aleya build] commit=${identity.appCommitSha} build=${identity.appBuildId} ` +
    `invoiceUI=${identity.invoiceUiVersion} pathway=${identity.invoicePathway}`
  );
}
