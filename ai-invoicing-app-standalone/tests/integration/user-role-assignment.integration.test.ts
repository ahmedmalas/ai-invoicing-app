import { describe, expect, it } from 'vitest';

import { createDatabase } from '../../src/db/database.js';

describe('user/role foundation and job assignment integrity', () => {
  it('supports role and user create/list/get baseline', () => {
    const db = createDatabase(':memory:');

    const role = db.createRole({
      name: 'Dispatcher',
      canManageAssignments: true,
    });
    expect(role.name).toBe('Dispatcher');

    const user = db.createUser({
      displayName: 'Morgan Dispatcher',
      roleIds: [role.id],
    });
    expect(user.roleIds).toEqual([role.id]);

    const fetchedRole = db.getRoleById(role.id);
    expect(fetchedRole?.id).toBe(role.id);

    const fetchedUser = db.getUserById(user.id);
    expect(fetchedUser?.id).toBe(user.id);

    expect(db.listRoles()).toHaveLength(1);
    expect(db.listUsers()).toHaveLength(1);

    db.close();
  });

  it('enforces assignment references and assignable role policy', () => {
    const db = createDatabase(':memory:');

    const customer = db.createCustomer({
      displayName: 'Assignment Integrity Customer',
    });
    const nonAssignableRole = db.createRole({
      name: 'Back Office',
      canBeAssigned: false,
    });
    const assignableRole = db.createRole({
      name: 'Field Worker',
      canBeAssigned: true,
    });
    const nonAssignableUser = db.createUser({
      displayName: 'Pat Office',
      roleIds: [nonAssignableRole.id],
    });
    const assignableUser = db.createUser({
      displayName: 'Riley Field',
      roleIds: [assignableRole.id],
    });

    expect(() =>
      db.createJob({
        title: 'Assignment check',
        customerId: customer.id,
        status: 'Draft',
        priority: 'Normal',
        assignedUserId: '550e8400-e29b-41d4-a716-446655440099',
      }),
    ).toThrow('USER_NOT_FOUND');

    expect(() =>
      db.createJob({
        title: 'Assignment check',
        customerId: customer.id,
        status: 'Draft',
        priority: 'Normal',
        assignedUserName: 'Manual Name',
      }),
    ).toThrow('ASSIGNED_USER_REQUIRES_ID');

    expect(() =>
      db.createJob({
        title: 'Assignment check',
        customerId: customer.id,
        status: 'Draft',
        priority: 'Normal',
        assignedUserId: nonAssignableUser.id,
      }),
    ).toThrow('ASSIGNED_USER_ROLE_REQUIRED');

    expect(() =>
      db.createJob({
        title: 'Assignment check',
        customerId: customer.id,
        status: 'Draft',
        priority: 'Normal',
        assignedUserId: assignableUser.id,
        assignedUserName: 'Wrong Name',
      }),
    ).toThrow('ASSIGNED_USER_NAME_MISMATCH');

    const job = db.createJob({
      title: 'Assignment check',
      customerId: customer.id,
      status: 'Draft',
      priority: 'Normal',
      assignedUserId: assignableUser.id,
    });
    expect(job.assignedUserId).toBe(assignableUser.id);
    expect(job.assignedUserName).toBe(assignableUser.displayName);

    db.close();
  });
});
