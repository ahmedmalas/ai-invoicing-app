import { describe, expect, it } from 'vitest';

import { assertTeamActionAuthorizedOrThrow } from '../../src/domain/teams/authorization.js';

describe('team authorization helper', () => {
  it('allows owner to perform all management actions', () => {
    expect(() =>
      assertTeamActionAuthorizedOrThrow({
        action: 'add_member',
        actorRole: 'owner',
        nextRole: 'owner',
      }),
    ).not.toThrow();
    expect(() =>
      assertTeamActionAuthorizedOrThrow({
        action: 'remove_member',
        actorRole: 'owner',
        targetRole: 'owner',
      }),
    ).not.toThrow();
    expect(() =>
      assertTeamActionAuthorizedOrThrow({
        action: 'change_member_role',
        actorRole: 'owner',
        targetRole: 'owner',
        nextRole: 'member',
      }),
    ).not.toThrow();
    expect(() =>
      assertTeamActionAuthorizedOrThrow({
        action: 'delete_team',
        actorRole: 'owner',
      }),
    ).not.toThrow();
  });

  it('enforces manager restrictions', () => {
    expect(() =>
      assertTeamActionAuthorizedOrThrow({
        action: 'add_member',
        actorRole: 'manager',
        nextRole: 'member',
      }),
    ).not.toThrow();
    expect(() =>
      assertTeamActionAuthorizedOrThrow({
        action: 'add_member',
        actorRole: 'manager',
        nextRole: 'owner',
      }),
    ).toThrow('TEAM_OWNER_MODIFICATION_FORBIDDEN');
    expect(() =>
      assertTeamActionAuthorizedOrThrow({
        action: 'remove_member',
        actorRole: 'manager',
        targetRole: 'owner',
      }),
    ).toThrow('TEAM_OWNER_MODIFICATION_FORBIDDEN');
    expect(() =>
      assertTeamActionAuthorizedOrThrow({
        action: 'change_member_role',
        actorRole: 'manager',
        targetRole: 'member',
        nextRole: 'owner',
      }),
    ).toThrow('TEAM_OWNER_MODIFICATION_FORBIDDEN');
    expect(() =>
      assertTeamActionAuthorizedOrThrow({
        action: 'delete_team',
        actorRole: 'manager',
      }),
    ).toThrow('TEAM_PERMISSION_DENIED');
  });

  it('denies member and non-member management actions', () => {
    expect(() =>
      assertTeamActionAuthorizedOrThrow({
        action: 'add_member',
        actorRole: 'member',
        nextRole: 'member',
      }),
    ).toThrow('TEAM_PERMISSION_DENIED');
    expect(() =>
      assertTeamActionAuthorizedOrThrow({
        action: 'remove_member',
        actorRole: null,
        targetRole: 'member',
      }),
    ).toThrow('TEAM_PERMISSION_DENIED');
  });
});
