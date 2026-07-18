import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { buildApp } from '../../src/app.js';

const dirs: string[] = [];

function tempDb(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ai-jobs-'));
  dirs.push(dir);
  return join(dir, 'test.sqlite');
}

afterEach(() => {
  while (dirs.length) {
    const dir = dirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('jobs scheduling integration', () => {
  it('supports multi-tech assignment, drag reschedule, time, signature, portal', async () => {
    const app = await buildApp({
      dbPath: tempDb(),
      authBypassForTesting: true,
      serveFrontend: false,
    });

    try {
      const customer = await app.inject({
        method: 'POST',
        url: '/api/customers',
        payload: { displayName: 'Harbour Homes', email: 'harbour@example.com' },
      });
      const customerId = customer.json().id as string;

      const role = await app.inject({
        method: 'POST',
        url: '/api/roles',
        payload: { name: 'Technician', canBeAssigned: true },
      });
      const roleId = role.json().id as string;

      const techA = await app.inject({
        method: 'POST',
        url: '/api/users',
        payload: { displayName: 'Alex Tech', roleIds: [roleId] },
      });
      const techB = await app.inject({
        method: 'POST',
        url: '/api/users',
        payload: { displayName: 'Blake Tech', roleIds: [roleId] },
      });
      const techAId = techA.json().id as string;
      const techBId = techB.json().id as string;

      const created = await app.inject({
        method: 'POST',
        url: '/api/jobs',
        payload: {
          title: 'Hot water repair',
          customerId,
          status: 'Scheduled',
          priority: 'High',
          scheduledStartAt: '2026-07-20T09:00:00.000Z',
          scheduledEndAt: '2026-07-20T11:00:00.000Z',
          siteAddress: '12 Pier St',
          suburb: 'Fremantle',
          assigneeUserIds: [techAId, techBId],
        },
      });
      expect(created.statusCode).toBe(201);
      const jobId = created.json().id as string;

      const detail = await app.inject({ method: 'GET', url: `/api/jobs/${jobId}` });
      expect(detail.statusCode).toBe(200);
      expect(detail.json().assignments.length).toBe(2);
      expect(detail.json().suburb).toBe('Fremantle');

      const reschedule = await app.inject({
        method: 'PATCH',
        url: `/api/jobs/${jobId}/schedule`,
        payload: {
          scheduledStartAt: '2026-07-21T10:00:00.000Z',
          scheduledEndAt: '2026-07-21T12:00:00.000Z',
        },
      });
      expect(reschedule.statusCode).toBe(200);
      expect(reschedule.json().scheduledStartAt).toBe('2026-07-21T10:00:00.000Z');

      const enRoute = await app.inject({
        method: 'PATCH',
        url: `/api/jobs/${jobId}/assignments/${techAId}`,
        payload: { responseStatus: 'en_route' },
      });
      expect(enRoute.statusCode).toBe(200);

      const afterEnRoute = await app.inject({ method: 'GET', url: `/api/jobs/${jobId}` });
      expect(afterEnRoute.json().status).toBe('Travelling');

      await app.inject({
        method: 'PUT',
        url: `/api/jobs/${jobId}/checklist`,
        payload: {
          items: [
            { label: 'PPE on', completed: true },
            { label: 'Isolate water', completed: false },
          ],
        },
      });

      const time = await app.inject({
        method: 'POST',
        url: `/api/jobs/${jobId}/time-entries`,
        payload: {
          entryType: 'work',
          startedAt: '2026-07-21T10:05:00.000Z',
          endedAt: '2026-07-21T11:35:00.000Z',
          billable: true,
        },
      });
      expect(time.statusCode).toBe(201);

      const summary = await app.inject({
        method: 'GET',
        url: `/api/jobs/${jobId}/time-summary`,
      });
      expect(summary.json().billableHours).toBeGreaterThan(1);

      const signature = await app.inject({
        method: 'POST',
        url: `/api/jobs/${jobId}/signatures`,
        payload: {
          signerName: 'Sam Customer',
          signatureDataUrl:
            'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64'),
          purpose: 'completion',
        },
      });
      expect(signature.statusCode).toBe(201);

      const calendar = await app.inject({
        method: 'GET',
        url: '/api/jobs/calendar/events?view=week&from=2026-07-20T00:00:00.000Z&to=2026-07-27T00:00:00.000Z',
      });
      expect(calendar.statusCode).toBe(200);
      expect(calendar.json().events.length).toBeGreaterThanOrEqual(1);

      const route = await app.inject({
        method: 'GET',
        url: `/api/jobs/routes/daily?technicianId=${techAId}&day=2026-07-21`,
      });
      expect(route.statusCode).toBe(200);
      expect(route.json().stops.length).toBeGreaterThanOrEqual(1);
      expect(route.json().stops[0].mapsUrl).toContain('google.com/maps');

      const portalToken = await app.inject({
        method: 'POST',
        url: '/api/portal/tokens',
        payload: { customerId, expiresInHours: 24 },
      });
      expect(portalToken.statusCode).toBe(201);
      const token = portalToken.json().token as string;

      const portal = await app.inject({ method: 'GET', url: `/api/portal/${token}` });
      expect(portal.statusCode).toBe(200);
      expect(portal.json().appointments.length).toBeGreaterThanOrEqual(1);

      const confirm = await app.inject({
        method: 'POST',
        url: `/api/portal/${token}/confirm`,
        payload: { jobId },
      });
      expect(confirm.statusCode).toBe(200);

      const statuses = await app.inject({ method: 'GET', url: '/api/job-statuses' });
      expect(statuses.json().statuses.length).toBeGreaterThanOrEqual(14);
    } finally {
      await app.close();
    }
  });
});
