/**
 * Drop-in ABoss shell patch: Logo Creator module entry.
 *
 * The ABoss source repository is not available in this agent environment.
 * Apply this patch to the ABoss SPA module registry / nav renderer so users can
 * open the shared ALEYA Logo Creator without leaving the ABoss session context.
 *
 * Expected integration points (from production bundle analysis):
 * - Modules loaded from GET /api/v1/platform/modules
 * - Only `id === "invoicing"` is currently rendered
 * - `/aleya` redirects to `/invoicing`
 *
 * After applying:
 * 1. Register module id `logo-creator` in the ABoss modules API response
 * 2. Render a dashboard card + nav item that deep-links to LOGO_CREATOR_PUBLIC_URL
 */

export const ALEYA_LOGO_CREATOR_MODULE = {
  id: 'logo-creator',
  name: 'ALEYA Logo Creator',
  description: 'Create Brand Kits once — use them in ABoss, Invoicing and future modules.',
  enabled: true,
  healthState: 'healthy',
  launchUrlTemplate:
    '{LOGO_CREATOR_PUBLIC_URL}/?source=aboss&returnUrl={encodeURIComponent(origin + "/dashboard")}&businessId={organizationId}',
};

/**
 * Example nav renderer addition:
 *
 * const logoModule = modules.find((m) => m.id === 'logo-creator');
 * if (logoModule?.enabled) {
 *   html += `<a class="nav-item" href="${launchUrl}" target="_blank" rel="noopener">Logo Creator</a>`;
 * }
 */
export function buildLogoCreatorLaunchUrl({
  logoCreatorPublicUrl,
  organizationId,
  returnUrl,
}) {
  const base = String(logoCreatorPublicUrl || '').replace(/\/$/, '');
  const params = new URLSearchParams({
    source: 'aboss',
    returnUrl: returnUrl || '',
    businessId: organizationId || '',
  });
  return `${base}/?${params.toString()}`;
}
