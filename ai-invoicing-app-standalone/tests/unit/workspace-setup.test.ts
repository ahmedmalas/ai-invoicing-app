import { describe, expect, it } from 'vitest';

import {
  WORKSPACE_SETUP_REQUIRED,
  resolveWorkspaceSetupNames,
} from '../../src/domain/auth/workspace-setup.js';

describe('resolveWorkspaceSetupNames', () => {
  it('prefers explicit display and workspace names', () => {
    expect(
      resolveWorkspaceSetupNames({
        displayName: '  Ada Lovelace  ',
        workspaceName: '  Analytical Engines  ',
        email: 'ada@example.com',
        metadataDisplayName: 'Ignored',
      }),
    ).toEqual({
      displayName: 'Ada Lovelace',
      workspaceName: 'Analytical Engines',
    });
  });

  it('uses metadata suggestions when body names are absent', () => {
    expect(
      resolveWorkspaceSetupNames({
        email: 'ada@example.com',
        metadataDisplayName: 'Meta Ada',
        metadataWorkspaceName: 'Meta Workspace',
      }),
    ).toEqual({
      displayName: 'Meta Ada',
      workspaceName: 'Meta Workspace',
    });
  });

  it('derives a safe display name from email when nothing else is provided', () => {
    expect(resolveWorkspaceSetupNames({ email: 'aleya.launch.validator@cursor.local' })).toEqual({
      displayName: 'aleya launch validator',
      workspaceName: "aleya launch validator's workspace",
    });
  });

  it('falls back to defaults when email is unusable', () => {
    expect(resolveWorkspaceSetupNames({})).toEqual({
      displayName: 'Workspace owner',
      workspaceName: "Workspace owner's workspace",
    });
  });

  it('exports the onboarding error code constant', () => {
    expect(WORKSPACE_SETUP_REQUIRED).toBe('WORKSPACE_SETUP_REQUIRED');
  });
});
