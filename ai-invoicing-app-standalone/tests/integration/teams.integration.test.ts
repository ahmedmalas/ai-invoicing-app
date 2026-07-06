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

    const membership = db.addTeamMember(team.id, user.id, 'owner');
    expect(membership.teamId).toBe(team.id);
    expect(membership.userId).toBe(user.id);
    expect(membership.role).toBe('owner');
    expect(membership.user.displayName).toBe('Team User');

    const secondUser = db.createUser({
      displayName: 'Second Team User',
      roleIds: [role.id],
    });
    const secondMembership = db.addTeamMember(team.id, secondUser.id, 'manager', user.id);
    expect(secondMembership.role).toBe('manager');

    const members = db.listTeamMembers(team.id);
    expect(members).toHaveLength(2);
    const ownerMembership = members.find((member) => member.user.id === user.id);
    const managerMembership = members.find((member) => member.user.id === secondUser.id);
    expect(ownerMembership?.role).toBe('owner');
    expect(managerMembership?.role).toBe('manager');

    expect(() => db.addTeamMember(team.id, user.id, 'member', user.id)).toThrow('TEAM_MEMBER_EXISTS');
    expect(() => db.addTeamMember(team.id, user.id, 'invalid-role' as never)).toThrow(
      'INVALID_TEAM_MEMBER_ROLE',
    );

    db.close();
  });

  it('enforces team authorization and final-owner safeguards', () => {
    const db = createDatabase(':memory:');

    const role = db.createRole({
      name: 'Team Authorization Worker',
      canBeAssigned: true,
    });
    const owner = db.createUser({
      displayName: 'Owner User',
      roleIds: [role.id],
    });
    const manager = db.createUser({
      displayName: 'Manager User',
      roleIds: [role.id],
    });
    const member = db.createUser({
      displayName: 'Member User',
      roleIds: [role.id],
    });
    const team = db.createTeam({
      name: 'Auth Team',
    });
    db.addTeamMember(team.id, owner.id, 'owner');
    db.addTeamMember(team.id, manager.id, 'manager', owner.id);
    db.addTeamMember(team.id, member.id, 'member', owner.id);

    expect(() =>
      db.addTeamMember(
        team.id,
        db.createUser({ displayName: 'Denied Add', roleIds: [role.id] }).id,
        'member',
        member.id,
      ),
    ).toThrow('TEAM_PERMISSION_DENIED');

    expect(() => db.removeTeamMember(team.id, member.id, member.id)).toThrow('TEAM_PERMISSION_DENIED');
    expect(() => db.removeTeamMember(team.id, owner.id, manager.id)).toThrow(
      'TEAM_OWNER_MODIFICATION_FORBIDDEN',
    );
    expect(() => db.deleteTeam(team.id, manager.id)).toThrow('TEAM_PERMISSION_DENIED');

    expect(() =>
      db.updateTeamMemberRole(team.id, member.id, 'owner', manager.id),
    ).toThrow('TEAM_OWNER_MODIFICATION_FORBIDDEN');

    expect(() => db.updateTeamMemberRole(team.id, owner.id, 'member', owner.id)).toThrow(
      'TEAM_LAST_OWNER_REQUIRED',
    );
    expect(() => db.removeTeamMember(team.id, owner.id, owner.id)).toThrow('TEAM_LAST_OWNER_REQUIRED');

    expect(() => db.updateTeamMemberRole(team.id, manager.id, 'owner', owner.id)).not.toThrow();
    expect(() => db.updateTeamMemberRole(team.id, owner.id, 'member', owner.id)).not.toThrow();

    db.close();
  });

  it('enforces team-scoped assignment on create and update', () => {
    const db = createDatabase(':memory:');

    const customer = db.createCustomer({ displayName: 'Scoped Customer' });
    const role = db.createRole({
      name: 'Assignable Scope Worker',
      canBeAssigned: true,
    });
    const ownerUser = db.createUser({
      displayName: 'Owner Team User',
      roleIds: [role.id],
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
    db.addTeamMember(team.id, ownerUser.id, 'owner');
    db.addTeamMember(team.id, inTeamUser.id, 'member', ownerUser.id);

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
    db.addTeamMember(teamTwo.id, outOfTeamUser.id, 'owner');

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
    const managerUser = db.createUser({
      displayName: 'Team Delete Manager',
      roleIds: [role.id],
    });
    const teamWithMember = db.createTeam({
      name: 'Team With Member',
    });
    db.addTeamMember(teamWithMember.id, memberUser.id, 'owner');
    db.addTeamMember(teamWithMember.id, managerUser.id, 'manager', memberUser.id);
    expect(() => db.deleteTeam(teamWithMember.id, managerUser.id)).toThrow('TEAM_PERMISSION_DENIED');
    expect(() => db.deleteTeam(teamWithMember.id, memberUser.id)).not.toThrow();

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
