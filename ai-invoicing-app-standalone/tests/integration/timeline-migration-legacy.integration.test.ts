import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';

import { createDatabase } from '../../src/db/database.js';

const createdDirs: string[] = [];

afterEach(() => {
  for (const dir of createdDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('timeline legacy migration safety', () => {
  it('opens legacy timeline table and backfills taxonomy columns safely', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'ai-business-os-timeline-legacy-'));
    createdDirs.push(tempDir);
    const dbPath = join(tempDir, 'legacy.sqlite');

    const legacy = new Database(dbPath);
    legacy.exec(`
      CREATE TABLE timeline_events (
        id TEXT PRIMARY KEY,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        event_payload TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
    legacy.close();

    const appDb = createDatabase(dbPath);
    const customer = appDb.createCustomer({ displayName: 'Legacy Safe Customer' });
    const customerTimeline = appDb.getTimelineForEntity('customer', customer.id);

    expect(customerTimeline).toHaveLength(1);
    expect((customerTimeline[0] as { eventKey: string }).eventKey).toBe('customer.created');
    expect((customerTimeline[0] as { eventVersion: number }).eventVersion).toBe(1);

    appDb.close();
  });
});
