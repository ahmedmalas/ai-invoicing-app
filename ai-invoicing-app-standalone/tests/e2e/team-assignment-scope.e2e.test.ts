import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { buildApp } from '../../src/app.js';

const idSchema = z.object({ id: z.string().uuid() });

describe('team assignment scope e2e', () => {
  it('enforces team member scope and team deletion lifecycle', async () => {
    const app = await buildApp({ dbPath: ':memory:' });

    const roleRes = await app.inject({
      method: 'POST',
      url: '/roles',
      payload: {
        name: 'Team Assignable',
        canBeAssigned: true,
      },
    });
    expect(roleRes.statusCode).toBe(201);
    const role = idSchema.parse(roleRes.json());

    const teamUserRes = await app.inject({
      method: 'POST',
      url: '/users',
      payload: {
        displayName: 'Team Member User',
        roleIds: [role.id],
      },
    });
    expect(teamUserRes.statusCode).toBe(201);
    const teamUser = idSchema.parse(teamUserRes.json());

    const outsideUserRes = await app.inject({
      method: 'POST',
      url: '/users',
      payload: {
        displayName: 'Outside User',
        roleIds: [role.id],
      },
    });
    expect(outsideUserRes.statusCode).toBe(201);
    const outsideUser = idSchema.parse(outsideUserRes.json());

    const teamRes = await app.inject({
      method: 'POST',
      url: '/teams',
      payload: {
        name: 'Install Team',
      },
    });
    expect(teamRes.statusCode).toBe(201);
    const team = idSchema.parse(teamRes.json());

    const addMemberRes = await app.inject({
      method: 'POST',
      url: `/teams/${team.id}/members`,
      payload: {
        userId: teamUser.id,
        role: 'manager',
      },
    });
    expect(addMemberRes.statusCode).toBe(201);
    expect(addMemberRes.json()).toMatchObject({
      userId: teamUser.id,
      role: 'manager',
    });

    const addMemberInvalidRoleRes = await app.inject({
      method: 'POST',
      url: `/teams/${team.id}/members`,
      payload: {
        userId: outsideUser.id,
        role: 'invalid-role',
      },
    });
    expect(addMemberInvalidRoleRes.statusCode).toBe(400);

    const deleteTeamBlockedByMemberRes = await app.inject({
      method: 'DELETE',
      url: `/teams/${team.id}`,
    });
    expect(deleteTeamBlockedByMemberRes.statusCode).toBe(409);
    expect(deleteTeamBlockedByMemberRes.json()).toMatchObject({
      message: 'TEAM_HAS_MEMBERS',
    });

    const customerRes = await app.inject({
      method: 'POST',
      url: '/customers',
      payload: {
        displayName: 'Team Scoped Customer',
      },
    });
    expect(customerRes.statusCode).toBe(201);
    const customer = idSchema.parse(customerRes.json());

    const scopedJobRes = await app.inject({
      method: 'POST',
      url: '/jobs',
      payload: {
        title: 'Scoped install',
        customerId: customer.id,
        status: 'Draft',
        priority: 'Normal',
        teamId: team.id,
        assignedUserId: teamUser.id,
      },
    });
    expect(scopedJobRes.statusCode).toBe(201);
    const job = z.object({ id: z.string().uuid() }).parse(scopedJobRes.json());

    const outOfScopeUpdateRes = await app.inject({
      method: 'PUT',
      url: `/jobs/${job.id}`,
      payload: {
        title: 'Scoped install',
        status: 'Scheduled',
        priority: 'Normal',
        teamId: team.id,
        assignedUserId: outsideUser.id,
      },
    });
    expect(outOfScopeUpdateRes.statusCode).toBe(409);

    const deleteMemberBlockedRes = await app.inject({
      method: 'DELETE',
      url: `/teams/${team.id}/members/${teamUser.id}`,
    });
    expect(deleteMemberBlockedRes.statusCode).toBe(409);
    expect(deleteMemberBlockedRes.json()).toMatchObject({
      message: 'TEAM_MEMBER_HAS_SCOPED_ASSIGNMENTS',
    });

    const unassignJobRes = await app.inject({
      method: 'PUT',
      url: `/jobs/${job.id}`,
      payload: {
        title: 'Scoped install',
        status: 'Draft',
        priority: 'Normal',
        teamId: team.id,
        assignedUserId: null,
      },
    });
    expect(unassignJobRes.statusCode).toBe(200);

    const deleteMemberRes = await app.inject({
      method: 'DELETE',
      url: `/teams/${team.id}/members/${teamUser.id}`,
    });
    expect(deleteMemberRes.statusCode).toBe(204);

    const deleteTeamBlockedByJobRes = await app.inject({
      method: 'DELETE',
      url: `/teams/${team.id}`,
    });
    expect(deleteTeamBlockedByJobRes.statusCode).toBe(409);
    expect(deleteTeamBlockedByJobRes.json()).toMatchObject({
      message: 'TEAM_HAS_JOBS',
    });

    const removeJobScopeRes = await app.inject({
      method: 'PUT',
      url: `/jobs/${job.id}`,
      payload: {
        title: 'Scoped install',
        status: 'Draft',
        priority: 'Normal',
        teamId: null,
        assignedUserId: null,
      },
    });
    expect(removeJobScopeRes.statusCode).toBe(200);

    const deleteTeamRes = await app.inject({
      method: 'DELETE',
      url: `/teams/${team.id}`,
    });
    expect(deleteTeamRes.statusCode).toBe(204);

    const timelineRes = await app.inject({
      method: 'GET',
      url: `/timeline/team/${team.id}`,
    });
    expect(timelineRes.statusCode).toBe(200);
    const timelineBody = z.object({ events: z.array(z.object({ eventKey: z.string() })) }).parse(
      timelineRes.json(),
    );
    expect(timelineBody.events.some((event) => event.eventKey === 'team.deleted')).toBe(true);

    await app.close();
  });
});
