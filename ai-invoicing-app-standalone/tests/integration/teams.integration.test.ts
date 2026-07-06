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

    const membership = db.addTeamMember(team.id, user.id, 'manager');
    expect(membership.teamId).toBe(team.id);
    expect(membership.userId).toBe(user.id);
    expect(membership.role).toBe('manager');
    expect(membership.user.displayName).toBe('Team User');

    const members = db.listTeamMembers(team.id);
    expect(members).toHaveLength(1);
    expect(members[0]?.user.id).toBe(user.id);
    expect(members[0]?.role).toBe('manager');

    expect(() => db.addTeamMember(team.id, user.id)).toThrow('TEAM_MEMBER_EXISTS');
    expect(() => db.addTeamMember(team.id, user.id, 'invalid-role' as never)).toThrow(
      'INVALID_TEAM_MEMBER_ROLE',
    );

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

  it('blocks member removal with scoped assignments and allows removal after unassignment', () => {
    const db = createDatabase(':memory:');

    const customer = db.createCustomer({
      displayName: 'Removal Guard Customer',
    });
    const role = db.createRole({
      name: 'Removal Assignable Worker',
      canBeAssigned: true,
    });
    const user = db.createUser({
      displayName: 'Assigned Team Member',
      roleIds: [role.id],
    });
    const team = db.createTeam({
      name: 'Removal Team',
    });
    db.addTeamMember(team.id, user.id);

    const job = db.createJob({
      title: 'Removal Guard Job',
      customerId: customer.id,
      status: 'Draft',
      priority: 'Normal',
      teamId: team.id,
      assignedUserId: user.id,
    });
    expect(job.assignedUserId).toBe(user.id);

    expect(() => db.removeTeamMember(team.id, user.id)).toThrow('TEAM_MEMBER_HAS_SCOPED_ASSIGNMENTS');

    db.updateJob(job.id, {
      title: 'Removal Guard Job',
      description: 'Unassigned for member removal',
      status: 'Draft',
      priority: 'Normal',
      teamId: team.id,
      assignedUserId: null,
    });

    expect(() => db.removeTeamMember(team.id, user.id)).not.toThrow();
    expect(db.listTeamMembers(team.id)).toHaveLength(0);

    expect(() => db.removeTeamMember(team.id, user.id)).toThrow('TEAM_MEMBER_NOT_FOUND');

    const teamTimeline = db.getTimelineForEntity('team', team.id);
    const timelineEventKeys = teamTimeline.map((event) => String(event.eventKey));
    expect(timelineEventKeys).toContain('team.member_added');
    expect(timelineEventKeys).toContain('team.member_removed');

    db.close();
  });

  it('enforces delete team lifecycle integrity', () => {
    const db = createDatabase(':memory:');

    const deletableTeam = db.createTeam({
      name: 'Deletable Team',
    });
    expect(() => db.deleteTeam(deletableTeam.id)).not.toThrow();
    expect(db.getTeamById(deletableTeam.id)).toBeNull();

    const role = db.createRole({
      name: 'Team Delete Worker',
      canBeAssigned: true,
    });
    const memberUser = db.createUser({
      displayName: 'Team Delete Member',
      roleIds: [role.id],
    });
    const teamWithMember = db.createTeam({
      name: 'Team With Member',
    });
    db.addTeamMember(teamWithMember.id, memberUser.id);
    expect(() => db.deleteTeam(teamWithMember.id)).toThrow('TEAM_HAS_MEMBERS');

    db.removeTeamMember(teamWithMember.id, memberUser.id);
    expect(() => db.deleteTeam(teamWithMember.id)).not.toThrow();

    const customer = db.createCustomer({
      displayName: 'Delete Team Customer',
    });
    const teamWithJob = db.createTeam({
      name: 'Team With Job',
    });
    db.createJob({
      title: 'Team Job',
      customerId: customer.id,
      status: 'Draft',
      priority: 'Normal',
      teamId: teamWithJob.id,
    });

    expect(() => db.deleteTeam(teamWithJob.id)).toThrow('TEAM_HAS_JOBS');

    expect(() => db.deleteTeam('550e8400-e29b-41d4-a716-446655440299')).toThrow('TEAM_NOT_FOUND');

    const teamTimeline = db.getTimelineForEntity('team', teamWithMember.id);
    const timelineEventKeys = teamTimeline.map((event) => String(event.eventKey));
    expect(timelineEventKeys).toContain('team.deleted');

    db.close();
  });
});
