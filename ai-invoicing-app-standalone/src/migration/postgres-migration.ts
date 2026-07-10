import { readFile, stat } from 'node:fs/promises';

import { z } from 'zod';

import {
  PLATFORM_SNAPSHOT_TABLES,
  PLATFORM_SNAPSHOT_VERSION,
  createDatabase,
  type PlatformSnapshot,
} from '../db/database.js';
import { createPostgresDatabase } from '../db/postgres-database.js';

type PlatformTable = (typeof PLATFORM_SNAPSHOT_TABLES)[number];
type SnapshotRow = Record<string, unknown>;

const snapshotSchema = z.object({
  version: z.literal(PLATFORM_SNAPSHOT_VERSION),
  products: z.array(z.record(z.string(), z.unknown())),
  derived: z.object({
    customerStatements: z.array(
      z.object({
        customerId: z.string().uuid(),
        statement: z.unknown(),
      }),
    ),
  }),
  entities: z.record(z.string(), z.array(z.record(z.string(), z.unknown()))),
});

interface Relationship {
  name: string;
  childTable: PlatformTable;
  childColumn: string;
  parentTable: PlatformTable;
  parentColumn?: string;
  nullable?: boolean;
}

const RELATIONSHIPS: readonly Relationship[] = [
  {
    name: 'invoice/customer',
    childTable: 'invoices',
    childColumn: 'customer_id',
    parentTable: 'customers',
  },
  {
    name: 'credit/invoice',
    childTable: 'credit_notes',
    childColumn: 'linked_invoice_id',
    parentTable: 'invoices',
  },
  {
    name: 'credit/customer',
    childTable: 'credit_notes',
    childColumn: 'customer_id',
    parentTable: 'customers',
  },
  {
    name: 'payment/customer',
    childTable: 'customer_payments',
    childColumn: 'customer_id',
    parentTable: 'customers',
  },
  {
    name: 'payment allocation/payment',
    childTable: 'payment_allocations',
    childColumn: 'payment_id',
    parentTable: 'customer_payments',
  },
  {
    name: 'payment allocation/invoice',
    childTable: 'payment_allocations',
    childColumn: 'invoice_id',
    parentTable: 'invoices',
  },
  {
    name: 'purchase order/supplier',
    childTable: 'purchase_orders',
    childColumn: 'supplier_id',
    parentTable: 'suppliers',
  },
  {
    name: 'purchase order line/purchase order',
    childTable: 'purchase_order_line_items',
    childColumn: 'purchase_order_id',
    parentTable: 'purchase_orders',
  },
  {
    name: 'supplier bill/supplier',
    childTable: 'supplier_bills',
    childColumn: 'supplier_id',
    parentTable: 'suppliers',
  },
  {
    name: 'supplier bill/purchase order',
    childTable: 'supplier_bills',
    childColumn: 'source_purchase_order_id',
    parentTable: 'purchase_orders',
    nullable: true,
  },
  {
    name: 'supplier bill line/bill',
    childTable: 'supplier_bill_line_items',
    childColumn: 'supplier_bill_id',
    parentTable: 'supplier_bills',
  },
  {
    name: 'supplier bill line/purchase order line',
    childTable: 'supplier_bill_line_items',
    childColumn: 'source_purchase_order_line_item_id',
    parentTable: 'purchase_order_line_items',
    nullable: true,
  },
  {
    name: 'supplier payment/supplier',
    childTable: 'supplier_payments',
    childColumn: 'supplier_id',
    parentTable: 'suppliers',
  },
  {
    name: 'supplier payment allocation/payment',
    childTable: 'supplier_payment_allocations',
    childColumn: 'supplier_payment_id',
    parentTable: 'supplier_payments',
  },
  {
    name: 'supplier payment allocation/bill',
    childTable: 'supplier_payment_allocations',
    childColumn: 'supplier_bill_id',
    parentTable: 'supplier_bills',
  },
] as const;

const TIMELINE_ENTITY_TABLES: Readonly<Record<string, PlatformTable>> = {
  business_profile: 'business_profile',
  credit_note: 'credit_notes',
  customer: 'customers',
  document: 'documents',
  invoice: 'invoices',
  job: 'jobs',
  payment: 'customer_payments',
  purchase_order: 'purchase_orders',
  supplier_bill: 'supplier_bills',
  supplier_payment: 'supplier_payments',
  team: 'teams',
};

export class PostgresMigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PostgresMigrationError';
  }
}

export interface MigrationSource {
  sqlitePath?: string;
  snapshotPath?: string;
}

export interface MigrationResult {
  tableCounts: Record<PlatformTable, number>;
  relationshipCount: number;
  timelineReferenceCount: number;
}

export function validateMigrationSnapshot(value: unknown): PlatformSnapshot {
  const parsed = snapshotSchema.safeParse(value);
  if (!parsed.success) {
    throw new PostgresMigrationError('Snapshot shape or version is invalid.');
  }
  for (const table of PLATFORM_SNAPSHOT_TABLES) {
    if (!Array.isArray(parsed.data.entities[table])) {
      throw new PostgresMigrationError(`Snapshot is missing platform table "${table}".`);
    }
  }
  return parsed.data as PlatformSnapshot;
}

function requiredValue(row: SnapshotRow, column: string, context: string): string {
  const value = row[column];
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new PostgresMigrationError(`${context} contains an invalid "${column}" value.`);
  }
  return String(value);
}

function relationshipEdges(snapshot: PlatformSnapshot, relationship: Relationship): string[] {
  return snapshot.entities[relationship.childTable]
    .map((row) => {
      const childId = requiredValue(row, 'id', relationship.name);
      const value = row[relationship.childColumn];
      if (relationship.nullable && value === null) {
        return null;
      }
      return `${childId}\u0000${requiredValue(row, relationship.childColumn, relationship.name)}`;
    })
    .filter((edge): edge is string => edge !== null)
    .sort();
}

function assertRelationshipIntegrity(
  snapshot: PlatformSnapshot,
  relationship: Relationship,
): number {
  const parentColumn = relationship.parentColumn ?? 'id';
  const parentIds = new Set(
    snapshot.entities[relationship.parentTable].map((row) =>
      requiredValue(row, parentColumn, relationship.name),
    ),
  );
  const edges = relationshipEdges(snapshot, relationship);
  for (const edge of edges) {
    const parentId = edge.slice(edge.indexOf('\u0000') + 1);
    if (!parentIds.has(parentId)) {
      throw new PostgresMigrationError(
        `Relationship verification failed for "${relationship.name}".`,
      );
    }
  }
  return edges.length;
}

function timelineEdges(snapshot: PlatformSnapshot): string[] {
  return snapshot.entities.timeline_events
    .map((row) => {
      const id = requiredValue(row, 'id', 'timeline reference');
      const entityType = requiredValue(row, 'entity_type', 'timeline reference');
      const entityId = requiredValue(row, 'entity_id', 'timeline reference');
      return `${id}\u0000${entityType}\u0000${entityId}`;
    })
    .sort();
}

function assertTimelineIntegrity(source: PlatformSnapshot, target: PlatformSnapshot): number {
  const targetEdges = timelineEdges(target);
  const sourceEdges = timelineEdges(source);
  if (JSON.stringify(sourceEdges) !== JSON.stringify(targetEdges)) {
    throw new PostgresMigrationError('Timeline reference verification failed.');
  }

  let checked = 0;
  for (const row of target.entities.timeline_events) {
    const entityType = requiredValue(row, 'entity_type', 'timeline reference');
    const entityId = requiredValue(row, 'entity_id', 'timeline reference');
    const table = TIMELINE_ENTITY_TABLES[entityType];
    if (!table) {
      continue;
    }
    const sourceEntityExists = source.entities[table].some(
      (candidate) => candidate.id === entityId,
    );
    if (!sourceEntityExists) {
      continue;
    }
    const targetEntityExists = target.entities[table].some(
      (candidate) => candidate.id === entityId,
    );
    if (!targetEntityExists) {
      throw new PostgresMigrationError(
        `Timeline reference verification failed for entity type "${entityType}".`,
      );
    }
    checked += 1;
  }
  return checked;
}

export function verifyMigratedSnapshot(
  sourceValue: unknown,
  targetValue: unknown,
): MigrationResult {
  const source = validateMigrationSnapshot(sourceValue);
  const target = validateMigrationSnapshot(targetValue);
  const tableCounts = {} as Record<PlatformTable, number>;

  for (const table of PLATFORM_SNAPSHOT_TABLES) {
    const sourceCount = source.entities[table].length;
    const targetCount = target.entities[table].length;
    if (sourceCount !== targetCount) {
      throw new PostgresMigrationError(
        `Table count verification failed for "${table}": expected ${sourceCount}, received ${targetCount}.`,
      );
    }
    tableCounts[table] = targetCount;
  }

  let relationshipCount = 0;
  for (const relationship of RELATIONSHIPS) {
    relationshipCount += assertRelationshipIntegrity(source, relationship);
    relationshipCount += assertRelationshipIntegrity(target, relationship);
    if (
      JSON.stringify(relationshipEdges(source, relationship)) !==
      JSON.stringify(relationshipEdges(target, relationship))
    ) {
      throw new PostgresMigrationError(
        `Relationship verification failed for "${relationship.name}".`,
      );
    }
  }

  return {
    tableCounts,
    relationshipCount,
    timelineReferenceCount: assertTimelineIntegrity(source, target),
  };
}

async function loadSourceSnapshot(source: MigrationSource): Promise<PlatformSnapshot> {
  if (Boolean(source.sqlitePath) === Boolean(source.snapshotPath)) {
    throw new PostgresMigrationError('Specify exactly one of --sqlite or --snapshot.');
  }
  if (source.snapshotPath) {
    let json: unknown;
    try {
      json = JSON.parse(await readFile(source.snapshotPath, 'utf8')) as unknown;
    } catch {
      throw new PostgresMigrationError('Unable to read or parse the snapshot file.');
    }
    return validateMigrationSnapshot(json);
  }

  let sqlite;
  try {
    const sourceStat = await stat(source.sqlitePath!);
    if (!sourceStat.isFile()) {
      throw new PostgresMigrationError('SQLite source is not a regular file.');
    }
    sqlite = createDatabase(source.sqlitePath!);
    return validateMigrationSnapshot(sqlite.exportPlatformSnapshot());
  } catch (error) {
    if (error instanceof PostgresMigrationError) {
      throw error;
    }
    throw new PostgresMigrationError('Unable to read the SQLite database.');
  } finally {
    sqlite?.close();
  }
}

export async function migrateToPostgres(
  source: MigrationSource,
  databaseUrl: string | undefined,
): Promise<MigrationResult> {
  if (!databaseUrl?.trim()) {
    throw new PostgresMigrationError('DATABASE_URL is required.');
  }

  const snapshot = await loadSourceSnapshot(source);
  const target = await createPostgresDatabase(databaseUrl, { maxConnections: 1 });
  try {
    try {
      await target.restorePlatformSnapshot(snapshot);
    } catch (error) {
      if (error instanceof Error && error.message === 'BACKUP_RESTORE_TARGET_NOT_EMPTY') {
        throw new PostgresMigrationError('PostgreSQL target is not empty; migration refused.');
      }
      throw error;
    }
    const exported = await target.exportPlatformSnapshot();
    return verifyMigratedSnapshot(snapshot, exported);
  } finally {
    await target.close();
  }
}
