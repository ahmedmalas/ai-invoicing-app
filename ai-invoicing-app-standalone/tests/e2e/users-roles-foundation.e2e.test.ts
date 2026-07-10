import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { buildApp } from '../../src/app.js';

const roleSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
});
const userSchema = z.object({
  id: z.string().uuid(),
  displayName: z.string(),
  roleIds: z.array(z.string().uuid()),
});

describe('users and roles foundation e2e', () => {
  it('supports create/list/get APIs and deterministic assignment integrity errors', async () => {
    const app = await buildApp({ dbPath: ':memory:' });

    const createRoleRes = await app.inject({
      method: 'POST',
      url: '/roles',
      payload: {
        name: 'Assignable Staff',
        canBeAssigned: true,
      },
    });
    expect(createRoleRes.statusCode).toBe(201);
    const role = roleSchema.parse(createRoleRes.json());

    const createUserRes = await app.inject({
      method: 'POST',
      url: '/users',
      payload: {
        displayName: 'Sam Worker',
        roleIds: [role.id],
      },
    });
    expect(createUserRes.statusCode).toBe(201);
    const user = userSchema.parse(createUserRes.json());
    expect(user.roleIds).toEqual([role.id]);

    const listRolesRes = await app.inject({
      method: 'GET',
      url: '/roles',
    });
    expect(listRolesRes.statusCode).toBe(200);

    const listUsersRes = await app.inject({
      method: 'GET',
      url: '/users',
    });
    expect(listUsersRes.statusCode).toBe(200);

    const getRoleRes = await app.inject({
      method: 'GET',
      url: `/roles/${role.id}`,
    });
    expect(getRoleRes.statusCode).toBe(200);

    const getUserRes = await app.inject({
      method: 'GET',
      url: `/users/${user.id}`,
    });
    expect(getUserRes.statusCode).toBe(200);

    const customerRes = await app.inject({
      method: 'POST',
      url: '/customers',
      payload: {
        displayName: 'Assignment Customer',
      },
    });
    expect(customerRes.statusCode).toBe(201);
    const customerId = z.object({ id: z.string().uuid() }).parse(customerRes.json()).id;

    const orphanAssignRes = await app.inject({
      method: 'POST',
      url: '/jobs',
      payload: {
        title: 'Assignment job',
        customerId,
        status: 'Draft',
        priority: 'Normal',
        assignedUserId: '550e8400-e29b-41d4-a716-446655440098',
      },
    });
    expect(orphanAssignRes.statusCode).toBe(404);

    await app.close();
  });
});
