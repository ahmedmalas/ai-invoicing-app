import { describe, expect, it } from 'vitest';

import { createRoleSchema, createUserSchema } from '../../src/domain/users/validation.js';

describe('role validation', () => {
  it('accepts minimal role payload', () => {
    const parsed = createRoleSchema.parse({
      name: 'Field Technician',
      canBeAssigned: true,
    });
    expect(parsed.name).toBe('Field Technician');
    expect(parsed.canBeAssigned).toBe(true);
  });

  it('rejects empty role name', () => {
    expect(() =>
      createRoleSchema.parse({
        name: '',
      }),
    ).toThrow();
  });
});

describe('user validation', () => {
  it('accepts user payload with role ids', () => {
    const parsed = createUserSchema.parse({
      displayName: 'Jamie Staff',
      email: 'jamie@example.test',
      roleIds: ['550e8400-e29b-41d4-a716-446655440100'],
    });
    expect(parsed.displayName).toBe('Jamie Staff');
    expect(parsed.roleIds).toHaveLength(1);
  });

  it('rejects invalid role id format', () => {
    expect(() =>
      createUserSchema.parse({
        displayName: 'Jamie Staff',
        roleIds: ['not-a-uuid'],
      }),
    ).toThrow();
  });
});
