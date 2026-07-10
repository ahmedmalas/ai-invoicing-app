import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { buildApp } from '../../src/app.js';

const idSchema = z.object({ id: z.string().uuid() });

const errorSchema = z.object({
  status: z.number().int(),
  code: z.string().min(1),
  message: z.string().min(1),
  details: z.unknown().optional(),
});

describe('global api contract integrity and error determinism', () => {
  it('returns deterministic error structures and deterministic repeated read payloads', async () => {
    const app = await buildApp({ dbPath: ':memory:' });

    const validationRes = await app.inject({
      method: 'POST',
      url: '/customers',
      payload: {},
    });
    expect(validationRes.statusCode).toBe(400);
    const validationPayload = errorSchema.parse(validationRes.json());
    expect(validationPayload.code).toBe('VALIDATION_FAILED');

    const missingUserRes = await app.inject({
      method: 'GET',
      url: '/users/550e8400-e29b-41d4-a716-446655440099',
    });
    expect(missingUserRes.statusCode).toBe(404);
    const missingUserPayload = errorSchema.parse(missingUserRes.json());
    expect(missingUserPayload.code).toBe('USER_NOT_FOUND');

    const customer = idSchema.parse(
      (
        await app.inject({
          method: 'POST',
          url: '/customers',
          payload: { displayName: 'API Contract Customer' },
        })
      ).json(),
    );

    const invoiceDraft = idSchema.parse(
      (
        await app.inject({
          method: 'POST',
          url: '/invoices',
          payload: {
            customerId: customer.id,
            title: 'API Contract Invoice',
            issueDate: '2026-07-08',
            dueDate: '2026-07-22',
            lineItems: [{ description: 'Line', quantity: 1, unitPrice: 100, gstApplicable: true }],
          },
        })
      ).json(),
    );
    expect((await app.inject({ method: 'POST', url: `/invoices/${invoiceDraft.id}/finalise` })).statusCode).toBe(200);

    const duplicateFinaliseRes = await app.inject({
      method: 'POST',
      url: `/invoices/${invoiceDraft.id}/finalise`,
    });
    expect(duplicateFinaliseRes.statusCode).toBe(409);
    const duplicateFinalisePayload = errorSchema.parse(duplicateFinaliseRes.json());
    expect(duplicateFinalisePayload.code).toBe('INVOICE_ALREADY_FINALISED');

    const searchA = await app.inject({
      method: 'GET',
      url: '/search?q=contract&limit=20&offset=0',
    });
    const searchB = await app.inject({
      method: 'GET',
      url: '/search?q=contract&limit=20&offset=0',
    });
    expect(searchA.statusCode).toBe(200);
    expect(searchB.statusCode).toBe(200);
    expect(searchA.json()).toEqual(searchB.json());

    const timelineA = await app.inject({
      method: 'GET',
      url: `/timeline/invoice/${invoiceDraft.id}?limit=20&offset=0`,
    });
    const timelineB = await app.inject({
      method: 'GET',
      url: `/timeline/invoice/${invoiceDraft.id}?limit=20&offset=0`,
    });
    expect(timelineA.statusCode).toBe(200);
    expect(timelineB.statusCode).toBe(200);
    expect(timelineA.json()).toEqual(timelineB.json());

    const reportA = await app.inject({
      method: 'GET',
      url: '/reports/read-model?from=2026-07-01&to=2026-07-31&limit=20&offset=0',
    });
    const reportB = await app.inject({
      method: 'GET',
      url: '/reports/read-model?from=2026-07-01&to=2026-07-31&limit=20&offset=0',
    });
    expect(reportA.statusCode).toBe(200);
    expect(reportB.statusCode).toBe(200);
    expect(reportA.json()).toEqual(reportB.json());

    const statementA = await app.inject({
      method: 'GET',
      url: `/statements/customers/${customer.id}?from=2026-07-01&to=2026-07-31`,
    });
    const statementB = await app.inject({
      method: 'GET',
      url: `/statements/customers/${customer.id}?from=2026-07-01&to=2026-07-31`,
    });
    expect(statementA.statusCode).toBe(200);
    expect(statementB.statusCode).toBe(200);
    expect(statementA.json()).toEqual(statementB.json());

    await app.close();
  });

  it('keeps pagination/filtering/empty contract deterministic across list endpoints and concurrent reads', async () => {
    const app = await buildApp({ dbPath: ':memory:' });

    const emptyUsers = await app.inject({ method: 'GET', url: '/users?limit=10&offset=0' });
    const emptySuppliers = await app.inject({ method: 'GET', url: '/suppliers?limit=10&offset=0' });
    expect(emptyUsers.statusCode).toBe(200);
    expect(emptySuppliers.statusCode).toBe(200);
    expect(z.object({ users: z.array(z.unknown()) }).parse(emptyUsers.json()).users).toEqual([]);
    expect(z.object({ suppliers: z.array(z.unknown()) }).parse(emptySuppliers.json()).suppliers).toEqual([]);

    const roleA = idSchema.parse(
      (
        await app.inject({
          method: 'POST',
          url: '/roles',
          payload: { name: 'Agent', canBeAssigned: true, canManageAssignments: false },
        })
      ).json(),
    );
    const roleB = idSchema.parse(
      (
        await app.inject({
          method: 'POST',
          url: '/roles',
          payload: { name: 'Manager', canBeAssigned: true, canManageAssignments: true },
        })
      ).json(),
    );

    const users = await Promise.all(
      Array.from({ length: 4 }, (_, index) =>
        app.inject({
          method: 'POST',
          url: '/users',
          payload: {
            displayName: `Deterministic User ${index + 1}`,
            email: `user${index + 1}@example.test`,
            roleIds: [index % 2 === 0 ? roleA.id : roleB.id],
          },
        }),
      ),
    );
    for (const res of users) {
      expect(res.statusCode).toBe(201);
    }

    const supplierIds = await Promise.all(
      Array.from({ length: 4 }, (_, index) =>
        app.inject({
          method: 'POST',
          url: '/suppliers',
          payload: { displayName: `Deterministic Supplier ${index + 1}` },
        }),
      ),
    );
    for (const res of supplierIds) {
      expect(res.statusCode).toBe(201);
    }

    const usersPage0 = z.object({ users: z.array(z.object({ id: z.string().uuid() })) }).parse(
      (await app.inject({ method: 'GET', url: '/users?limit=2&offset=0' })).json(),
    );
    const usersPage1 = z.object({ users: z.array(z.object({ id: z.string().uuid() })) }).parse(
      (await app.inject({ method: 'GET', url: '/users?limit=2&offset=2' })).json(),
    );
    const usersFull = z.object({ users: z.array(z.object({ id: z.string().uuid() })) }).parse(
      (await app.inject({ method: 'GET', url: '/users?limit=4&offset=0' })).json(),
    );
    expect([...usersPage0.users, ...usersPage1.users].map((row) => row.id)).toEqual(
      usersFull.users.map((row) => row.id),
    );

    const supplierPage0 = z.object({ suppliers: z.array(z.object({ id: z.string().uuid() })) }).parse(
      (await app.inject({ method: 'GET', url: '/suppliers?limit=2&offset=0' })).json(),
    );
    const supplierPage1 = z.object({ suppliers: z.array(z.object({ id: z.string().uuid() })) }).parse(
      (await app.inject({ method: 'GET', url: '/suppliers?limit=2&offset=2' })).json(),
    );
    const supplierFull = z.object({ suppliers: z.array(z.object({ id: z.string().uuid() })) }).parse(
      (await app.inject({ method: 'GET', url: '/suppliers?limit=4&offset=0' })).json(),
    );
    expect([...supplierPage0.suppliers, ...supplierPage1.suppliers].map((row) => row.id)).toEqual(
      supplierFull.suppliers.map((row) => row.id),
    );

    const teams = await Promise.all(
      Array.from({ length: 4 }, (_, index) =>
        app.inject({
          method: 'POST',
          url: '/teams',
          payload: { name: `Deterministic Team ${index + 1}` },
        }),
      ),
    );
    for (const response of teams) {
      expect(response.statusCode).toBe(201);
    }
    const teamIds = teams.map((response) => z.object({ id: z.string().uuid() }).parse(response.json()).id);

    const teamsPage0 = z.object({ teams: z.array(z.object({ id: z.string().uuid() })) }).parse(
      (await app.inject({ method: 'GET', url: '/teams?limit=2&offset=0' })).json(),
    );
    const teamsPage1 = z.object({ teams: z.array(z.object({ id: z.string().uuid() })) }).parse(
      (await app.inject({ method: 'GET', url: '/teams?limit=2&offset=2' })).json(),
    );
    const teamsFull = z.object({ teams: z.array(z.object({ id: z.string().uuid() })) }).parse(
      (await app.inject({ method: 'GET', url: '/teams?limit=4&offset=0' })).json(),
    );
    expect([...teamsPage0.teams, ...teamsPage1.teams].map((row) => row.id)).toEqual(
      teamsFull.teams.map((row) => row.id),
    );

    const firstUserId = z.object({ id: z.string().uuid() }).parse(users[0]!.json()).id;
    for (const teamId of teamIds) {
      const addMemberResponse = await app.inject({
        method: 'POST',
        url: `/teams/${teamId}/members`,
        payload: { userId: firstUserId, role: 'owner' },
      });
      expect(addMemberResponse.statusCode).toBe(201);
    }
    const teamMembersPage = z.object({ members: z.array(z.object({ id: z.string().uuid() })) }).parse(
      (await app.inject({ method: 'GET', url: `/teams/${teamIds[0]}/members?limit=1&offset=0` })).json(),
    );
    expect(teamMembersPage.members).toHaveLength(1);

    const customerForJobs = idSchema.parse(
      (
        await app.inject({
          method: 'POST',
          url: '/customers',
          payload: { displayName: 'Deterministic Job Customer' },
        })
      ).json(),
    );
    const jobs = await Promise.all(
      Array.from({ length: 4 }, (_, index) =>
        app.inject({
          method: 'POST',
          url: '/jobs',
          payload: {
            title: `Deterministic Job ${index + 1}`,
            customerId: customerForJobs.id,
            status: 'Draft',
            priority: 'Normal',
          },
        }),
      ),
    );
    for (const response of jobs) {
      expect(response.statusCode).toBe(201);
    }
    const jobIds = jobs.map((response) => z.object({ id: z.string().uuid() }).parse(response.json()).id);

    const jobsPage0 = z.object({ jobs: z.array(z.object({ id: z.string().uuid() })) }).parse(
      (await app.inject({ method: 'GET', url: '/jobs?limit=2&offset=0' })).json(),
    );
    const jobsPage1 = z.object({ jobs: z.array(z.object({ id: z.string().uuid() })) }).parse(
      (await app.inject({ method: 'GET', url: '/jobs?limit=2&offset=2' })).json(),
    );
    const jobsFull = z.object({ jobs: z.array(z.object({ id: z.string().uuid() })) }).parse(
      (await app.inject({ method: 'GET', url: '/jobs?limit=4&offset=0' })).json(),
    );
    expect([...jobsPage0.jobs, ...jobsPage1.jobs].map((row) => row.id)).toEqual(jobsFull.jobs.map((row) => row.id));

    const documentsPage = z.object({ documents: z.array(z.object({ id: z.string().uuid() })) }).parse(
      (
        await app.inject({
          method: 'GET',
          url: `/jobs/${jobIds[0]}/documents?limit=2&offset=0`,
        })
      ).json(),
    );
    expect(documentsPage.documents).toEqual([]);

    const concurrentReads = await Promise.all(
      Array.from({ length: 6 }, () => app.inject({ method: 'GET', url: '/roles?limit=50&offset=0' })),
    );
    for (const response of concurrentReads) {
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual(concurrentReads[0]?.json());
    }

    await app.close();
  });
});
