export function assertAssignmentInTeamScopeOrThrow(
  teamId: string | null,
  assignedUserId: string | null,
  isMemberOfTeam: boolean,
): void {
  if (!teamId || !assignedUserId) {
    return;
  }

  if (!isMemberOfTeam) {
    throw new Error('ASSIGNED_USER_OUTSIDE_TEAM_SCOPE');
  }
}
