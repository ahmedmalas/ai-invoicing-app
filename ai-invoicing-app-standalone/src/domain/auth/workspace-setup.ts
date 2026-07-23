/**
 * Application workspace onboarding for authenticated Supabase users.
 * Display names may come from user input or suggestions; they are never
 * used for authorization decisions.
 */

export const WORKSPACE_SETUP_REQUIRED = 'WORKSPACE_SETUP_REQUIRED';

export type WorkspaceSetupNameInput = {
  displayName?: string | undefined;
  workspaceName?: string | undefined;
  email?: string | undefined;
  metadataDisplayName?: string | undefined;
  metadataWorkspaceName?: string | undefined;
};

function cleanName(value: unknown, max = 120): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim().replace(/\s+/g, ' ');
  if (trimmed.length < 2) return undefined;
  return trimmed.slice(0, max);
}

function displayNameFromEmail(email: string | undefined): string | undefined {
  if (!email) return undefined;
  const local = email.split('@')[0]?.trim() ?? '';
  if (!local) return undefined;
  const readable = local
    .replace(/[._+-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleanName(readable) ?? cleanName(local);
}

/**
 * Resolve display/workspace names for first-time owner provisioning.
 * Preference order: explicit body → metadata suggestion → email local-part → defaults.
 */
export function resolveWorkspaceSetupNames(input: WorkspaceSetupNameInput): {
  displayName: string;
  workspaceName: string;
} {
  const displayName =
    cleanName(input.displayName) ??
    cleanName(input.metadataDisplayName) ??
    displayNameFromEmail(input.email) ??
    'Workspace owner';

  const workspaceName =
    cleanName(input.workspaceName) ??
    cleanName(input.metadataWorkspaceName) ??
    `${displayName}'s workspace`;

  return { displayName, workspaceName };
}
