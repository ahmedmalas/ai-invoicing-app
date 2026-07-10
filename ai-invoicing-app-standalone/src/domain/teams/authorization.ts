import type { TeamMembershipRole } from '../../types/entities.js';

export type TeamAuthorizationAction = 'add_member' | 'remove_member' | 'change_member_role' | 'delete_team';

export interface TeamAuthorizationInput {
  action: TeamAuthorizationAction;
  actorRole: TeamMembershipRole | null;
  targetRole?: TeamMembershipRole | null;
  nextRole?: TeamMembershipRole | null;
}

export function assertTeamActionAuthorizedOrThrow(input: TeamAuthorizationInput): void {
  const { action, actorRole, targetRole = null, nextRole = null } = input;

  if (actorRole === 'owner') {
    return;
  }

  if (actorRole === 'manager') {
    if (action === 'delete_team') {
      throw new Error('TEAM_PERMISSION_DENIED');
    }
    if (
      action === 'change_member_role' &&
      (targetRole === 'owner' || nextRole === 'owner')
    ) {
      throw new Error('TEAM_OWNER_MODIFICATION_FORBIDDEN');
    }
    if (action === 'add_member' && nextRole === 'owner') {
      throw new Error('TEAM_OWNER_MODIFICATION_FORBIDDEN');
    }
    if (action === 'remove_member' && targetRole === 'owner') {
      throw new Error('TEAM_OWNER_MODIFICATION_FORBIDDEN');
    }
    return;
  }

  throw new Error('TEAM_PERMISSION_DENIED');
}
