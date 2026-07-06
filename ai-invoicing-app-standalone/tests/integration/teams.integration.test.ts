import { describe, expect, it } from 'vitest';

import { createDatabase } from '../../src/db/database.js';

describe('teams integration', () => {
  it('supports create/list/get and membership flows', () => {
    const db = createDatabase(':memory:');

    const role = db.createRole({
      name: 'Assignable Team Worker',
      canBeAssigned: true,
    });
    const user = db.createUser({
      displayName: 'Team User',
      roleIds: [role.id],
    });
    const team = db.createTeam({
      name: 'Field Ops',
    });

    const fetched = db.getTeamById(team.id);
    expect(fetched?.name).toBe('Field Ops');
    expect(db.listTeams()).toHaveLength(1);

    const membership = db.addTeamMember(team.id, user.id);
    expect(membership.teamId).toBe(team.id);
    expect(membership.userId).toBe(user.id);
    expect(membership.user.displayName).toBe('Team User');

    const members = db.listTeamMembers(team.id);
    expect(members).toHaveLength(1);
    expect(members[0]?.user.id).toBe(user.id);

    expect(() => db.addTeamMember(team.id, user.id)).toThrow('TEAM_MEMBER_EXISTS');

    db.close();
  });

  it('enforces team-scoped assignment on create and update', () => {
    const db = createDatabase(':memory:');

    const customer = db.createCustomer({
      displayName: 'Scoped Customer',
    });
    const role = db.createRole({
      name: 'Assignable Scope Worker',
      canBeAssigned: true,
    });
    const inTeamUser = db.createUser({
      displayName: 'In Team User',
      roleIds: [role.id],
    });
    const outOfTeamUser = db.createUser({
      displayName: 'Out Team User',
      roleIds: [role.id],
    });
    const team = db.createTeam({
      name: 'Scoped Team',
    });
    db.addTeamMember(team.id, inTeamUser.id);

    const job = db.createJob({
      title: 'Scoped Job',
      customerId: customer.id,
      status: 'Draft',
      priority: 'Normal',
      teamId: team.id,
      assignedUserId: inTeamUser.id,
    });
    expect(job.teamId).toBe(team.id);
    expect(job.assignedUserId).toBe(inTeamUser.id);

    expect(() =>
      db.createJob({
        title: 'Scoped Job Fail',
        customerId: customer.id,
        status: 'Draft',
        priority: 'Normal',
        teamId: team.id,
        assignedUserId: outOfTeamUser.id,
      }),
    ).toThrow('ASSIGNED_USER_OUTSIDE_TEAM_SCOPE');

    const teamTwo = db.createTeam({
      name: 'Other Team',
    });
    db.addTeamMember(teamTwo.id, outOfTeamUser.id);

    expect(() =>
      db.updateJob(job.id, {
        title: 'Scoped Job',
        description: 'Scope update',
        status: 'Scheduled',
        priority: 'Normal',
        teamId: teamTwo.id,
        assignedUserId: inTeamUser.id,
      }),
    ).toThrow('ASSIGNED_USER_OUTSIDE_TEAM_SCOPE');

    const updated = db.updateJob(job.id, {
      title: 'Scoped Job',
      description: 'Scope update',
      status: 'Scheduled',
      priority: 'Normal',
      teamId: teamTwo.id,
      assignedUserId: outOfTeamUser.id,
    });
    expect(updated.teamId).toBe(teamTwo.id);
    expect(updated.assignedUserId).toBe(outOfTeamUser.id);

    db.close();
  });
});
