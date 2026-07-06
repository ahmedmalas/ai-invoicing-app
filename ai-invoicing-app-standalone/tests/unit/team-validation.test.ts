import { describe, expect, it } from 'vitest';

import { assertAssignmentInTeamScopeOrThrow } from '../../src/domain/teams/assignment-scope.js';
import {
  addTeamMemberSchema,
  createTeamSchema,
  deleteTeamParamsSchema,
  removeTeamMemberParamsSchema,
  teamMembershipRoleSchema,
} from '../../src/domain/teams/validation.js';

describe('team validation', () => {
  it('accepts create team payload', () => {
    const parsed = createTeamSchema.parse({
      name: 'Operations',
    });
    expect(parsed.name).toBe('Operations');
  });

  it('rejects empty team name', () => {
    expect(() => createTeamSchema.parse({ name: '' })).toThrow();
  });

  it('accepts team membership payload', () => {
    const parsed = addTeamMemberSchema.parse({
      userId: '550e8400-e29b-41d4-a716-446655440230',
      role: 'manager',
    });
    expect(parsed.userId).toBe('550e8400-e29b-41d4-a716-446655440230');
    expect(parsed.role).toBe('manager');
  });

  it('rejects invalid team membership role', () => {
    expect(() =>
      addTeamMemberSchema.parse({
        userId: '550e8400-e29b-41d4-a716-446655440230',
        role: 'invalid-role',
      }),
    ).toThrow();
  });

  it('accepts canonical team membership role values', () => {
    expect(teamMembershipRoleSchema.parse('owner')).toBe('owner');
    expect(teamMembershipRoleSchema.parse('manager')).toBe('manager');
    expect(teamMembershipRoleSchema.parse('member')).toBe('member');
  });

  it('accepts remove member route params payload', () => {
    const parsed = removeTeamMemberParamsSchema.parse({
      teamId: '550e8400-e29b-41d4-a716-446655440230',
      userId: '550e8400-e29b-41d4-a716-446655440231',
    });
    expect(parsed.teamId).toBe('550e8400-e29b-41d4-a716-446655440230');
    expect(parsed.userId).toBe('550e8400-e29b-41d4-a716-446655440231');
  });

  it('accepts delete team route params payload', () => {
    const parsed = deleteTeamParamsSchema.parse({
      teamId: '550e8400-e29b-41d4-a716-446655440230',
    });
    expect(parsed.teamId).toBe('550e8400-e29b-41d4-a716-446655440230');
  });
});

describe('team assignment scope guard', () => {
  it('allows assignment when no team scope is set', () => {
    expect(() => assertAssignmentInTeamScopeOrThrow(null, 'u1', false)).not.toThrow();
  });

  it('allows assignment when user is inside team scope', () => {
    expect(() => assertAssignmentInTeamScopeOrThrow('team1', 'user1', true)).not.toThrow();
  });

  it('rejects assignment when user is outside team scope', () => {
    expect(() => assertAssignmentInTeamScopeOrThrow('team1', 'user1', false)).toThrow(
      'ASSIGNED_USER_OUTSIDE_TEAM_SCOPE',
    );
  });
});
