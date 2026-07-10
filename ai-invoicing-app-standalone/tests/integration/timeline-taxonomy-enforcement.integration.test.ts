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

describe('timeline taxonomy enforcement', () => {
  it('rejects invalid event key writes at persistence layer', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'ai-business-os-timeline-taxonomy-'));
    createdDirs.push(tempDir);
    const dbPath = join(tempDir, 'timeline.sqlite');

    const appDb = createDatabase(dbPath);
    const raw = new Database(dbPath);

    expect(() =>
      raw
        .prepare(
          `INSERT INTO timeline_events
            (id, event_key, event_version, category, entity_type, entity_id, actor_type, source, event_type, event_payload, payload_schema, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          'bad-event',
          'invoice.not_real',
          1,
          'invoice',
          'invoice',
          'entity',
          'system',
          'api',
          'Bad Event',
          '{}',
          'timeline.bad.v1',
          new Date().toISOString(),
        ),
    ).toThrow(/INVALID_TIMELINE_EVENT_TAXONOMY/);

    expect(() =>
      raw
        .prepare(
          `INSERT INTO timeline_events
            (id, event_key, event_version, category, entity_type, entity_id, actor_type, source, event_type, event_payload, payload_schema, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          'bad-version',
          'invoice.finalised',
          2,
          'invoice',
          'invoice',
          'entity',
          'system',
          'api',
          'Invoice Finalised',
          '{}',
          'timeline.invoice.finalised.v2',
          new Date().toISOString(),
        ),
    ).toThrow(/INVALID_TIMELINE_EVENT_TAXONOMY/);

    raw.close();
    appDb.close();
  });
});
