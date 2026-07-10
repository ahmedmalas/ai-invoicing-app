import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { buildApp } from '../../src/app.js';

const idSchema = z.object({ id: z.string().uuid() });

describe('team assignment scope e2e', () => {
  it('enforces team role authorization, assignment scope, and team lifecycle', async () => {
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

    const ownerUserRes = await app.inject({
      method: 'POST',
      url: '/users',
      payload: {
        displayName: 'Owner User',
        roleIds: [role.id],
      },
    });
    expect(ownerUserRes.statusCode).toBe(201);
    const ownerUser = idSchema.parse(ownerUserRes.json());

    const managerUserRes = await app.inject({
      method: 'POST',
      url: '/users',
      payload: {
        displayName: 'Manager User',
        roleIds: [role.id],
      },
    });
    expect(managerUserRes.statusCode).toBe(201);
    const managerUser = idSchema.parse(managerUserRes.json());

    const memberUserRes = await app.inject({
      method: 'POST',
      url: '/users',
      payload: {
        displayName: 'Member User',
        roleIds: [role.id],
      },
    });
    expect(memberUserRes.statusCode).toBe(201);
    const memberUser = idSchema.parse(memberUserRes.json());

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
        userId: ownerUser.id,
        role: 'owner',
      },
    });
    expect(addMemberRes.statusCode).toBe(201);
    expect(addMemberRes.json()).toMatchObject({
      userId: ownerUser.id,
      role: 'owner',
    });

    const addManagerRes = await app.inject({
      method: 'POST',
      url: `/teams/${team.id}/members`,
      headers: {
        'x-actor-user-id': ownerUser.id,
      },
      payload: {
        userId: managerUser.id,
        role: 'manager',
      },
    });
    expect(addManagerRes.statusCode).toBe(201);

    const addMemberResTwo = await app.inject({
      method: 'POST',
      url: `/teams/${team.id}/members`,
      headers: {
        'x-actor-user-id': ownerUser.id,
      },
      payload: {
        userId: memberUser.id,
        role: 'member',
      },
    });
    expect(addMemberResTwo.statusCode).toBe(201);

    const managerDeleteDeniedRes = await app.inject({
      method: 'DELETE',
      url: `/teams/${team.id}`,
      headers: {
        'x-actor-user-id': managerUser.id,
      },
    });
    expect(managerDeleteDeniedRes.statusCode).toBe(403);
    expect(managerDeleteDeniedRes.json()).toMatchObject({
      message: 'TEAM_PERMISSION_DENIED',
    });

    const memberManageDeniedRes = await app.inject({
      method: 'POST',
      url: `/teams/${team.id}/members`,
      headers: {
        'x-actor-user-id': memberUser.id,
      },
      payload: {
        userId: outsideUser.id,
        role: 'member',
      },
    });
    expect(memberManageDeniedRes.statusCode).toBe(403);
    expect(memberManageDeniedRes.json()).toMatchObject({
      message: 'TEAM_PERMISSION_DENIED',
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
        assignedUserId: memberUser.id,
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
      url: `/teams/${team.id}/members/${memberUser.id}`,
      headers: {
        'x-actor-user-id': ownerUser.id,
      },
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
      url: `/teams/${team.id}/members/${memberUser.id}`,
      headers: {
        'x-actor-user-id': ownerUser.id,
      },
    });
    expect(deleteMemberRes.statusCode).toBe(204);

    const managerOwnerDemoteDeniedRes = await app.inject({
      method: 'PATCH',
      url: `/teams/${team.id}/members/${ownerUser.id}/role`,
      headers: {
        'x-actor-user-id': managerUser.id,
      },
      payload: {
        role: 'member',
      },
    });
    expect(managerOwnerDemoteDeniedRes.statusCode).toBe(403);
    expect(managerOwnerDemoteDeniedRes.json()).toMatchObject({
      message: 'TEAM_OWNER_MODIFICATION_FORBIDDEN',
    });

    const ownerPromoteManagerRes = await app.inject({
      method: 'PATCH',
      url: `/teams/${team.id}/members/${managerUser.id}/role`,
      headers: {
        'x-actor-user-id': ownerUser.id,
      },
      payload: {
        role: 'owner',
      },
    });
    expect(ownerPromoteManagerRes.statusCode).toBe(200);
    expect(ownerPromoteManagerRes.json()).toMatchObject({
      userId: managerUser.id,
      role: 'owner',
    });

    const ownerDemoteSelfRes = await app.inject({
      method: 'PATCH',
      url: `/teams/${team.id}/members/${ownerUser.id}/role`,
      headers: {
        'x-actor-user-id': ownerUser.id,
      },
      payload: {
        role: 'member',
      },
    });
    expect(ownerDemoteSelfRes.statusCode).toBe(200);

    const deleteTeamBlockedByJobRes = await app.inject({
      method: 'DELETE',
      url: `/teams/${team.id}`,
      headers: {
        'x-actor-user-id': managerUser.id,
      },
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
      headers: {
        'x-actor-user-id': managerUser.id,
      },
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
