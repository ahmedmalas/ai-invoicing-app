import { randomUUID } from 'node:crypto';

import { buildDefaultQrPayload } from '../domain/inventory/barcode.js';
import {
  evaluateStockIntelligence,
  profitMarginPercent,
} from '../domain/inventory/stock-intelligence.js';
import type {
  InventoryAlert,
  InventoryReportBundle,
  Product,
  ProductBundleComponent,
  ProductStockSummary,
  PurchaseOrderReceiptStatus,
  StockMovement,
  Stocktake,
  StocktakeLine,
  StockBucket,
  StockMovementType,
} from '../domain/inventory/types.js';
import type { TimelineEventKey } from '../domain/timeline/taxonomy.js';

export interface PostgresInventoryDb {
  prepare(sql: string): {
    get: (...values: unknown[]) => Promise<unknown>;
    all: (...values: unknown[]) => Promise<unknown[]>;
    run: (...values: unknown[]) => Promise<void>;
  };
}

export interface InventoryTimelineWriterAsync {
  (eventKey: TimelineEventKey, entityId: string, payload: unknown): Promise<void>;
}

export interface InventoryNumberAllocatorAsync {
  (table: 'goods_receipt_sequences' | 'stocktake_sequences', prefix: string): Promise<string>;
}

function nowIso(): string {
  return new Date().toISOString();
}

function assertNoInjectedFailure(failpoint: string): void {
  if (process.env.AI_BUSINESS_OS_FAILPOINT === failpoint) {
    throw new Error(`INJECTED_FAILURE_${failpoint}`);
  }
}

function asText(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  return fallback;
}

function asOptionalText(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  return null;
}

function asOptionalNumber(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function asBool(value: number | boolean | null | undefined): boolean {
  return value === 1 || value === true;
}

function mapStock(
  row: {
    on_hand: number;
    reserved: number;
    incoming: number;
    damaged: number;
    returned: number;
  } | null,
): ProductStockSummary {
  const onHand = row?.on_hand ?? 0;
  const reserved = row?.reserved ?? 0;
  return {
    onHand,
    reserved,
    incoming: row?.incoming ?? 0,
    damaged: row?.damaged ?? 0,
    returned: row?.returned ?? 0,
    available: onHand - reserved,
  };
}

function mapProduct(row: Record<string, unknown>, stock?: ProductStockSummary): Product {
  const costPrice = Number(row.cost_price ?? 0);
  const sellPrice = Number(row.sell_price ?? 0);
  const product: Product = {
    id: String(row.id),
    sku: String(row.sku),
    barcode: (row.barcode as string | null) ?? null,
    qrPayload: (row.qr_payload as string | null) ?? null,
    name: String(row.name),
    description: (row.description as string | null) ?? null,
    category: (row.category as string | null) ?? null,
    brand: (row.brand as string | null) ?? null,
    supplierId: (row.supplier_id as string | null) ?? null,
    unitOfMeasure: asText(row.unit_of_measure, 'ea') || 'ea',
    costPrice,
    sellPrice,
    gstStatus: (row.gst_status as 'gst' | 'gst_free') ?? 'gst',
    profitMargin: profitMarginPercent(costPrice, sellPrice),
    trackStock: asBool(row.track_stock as number),
    minimumStockLevel: Number(row.minimum_stock_level ?? 0),
    reorderQuantity: Number(row.reorder_quantity ?? 0),
    storageLocation: (row.storage_location as string | null) ?? null,
    weight: row.weight == null ? null : Number(row.weight),
    lengthMm: row.length_mm == null ? null : Number(row.length_mm),
    widthMm: row.width_mm == null ? null : Number(row.width_mm),
    heightMm: row.height_mm == null ? null : Number(row.height_mm),
    imageUrl: (row.image_url as string | null) ?? null,
    notes: (row.notes as string | null) ?? null,
    isActive: asBool(row.is_active as number),
    isBundle: asBool(row.is_bundle as number),
    bundleKind: (row.bundle_kind as Product['bundleKind']) ?? null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
  if (stock) product.stock = stock;
  return product;
}

async function getBalance(
  db: PostgresInventoryDb,
  productId: string,
): Promise<ProductStockSummary> {
  const row = (await db
    .prepare(
      `SELECT on_hand, reserved, incoming, damaged, returned
       FROM inventory_balances WHERE product_id = ?`,
    )
    .get(productId)) as
    | {
        on_hand: number;
        reserved: number;
        incoming: number;
        damaged: number;
        returned: number;
      }
    | undefined;
  return mapStock(row ?? null);
}

async function ensureBalanceRow(db: PostgresInventoryDb, productId: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO inventory_balances
      (product_id, on_hand, reserved, incoming, damaged, returned, updated_at)
     VALUES (?, 0, 0, 0, 0, 0, ?)
     ON CONFLICT (product_id) DO NOTHING`,
    )
    .run(productId, nowIso());
}

function balanceColumn(
  bucket: StockBucket,
): 'on_hand' | 'reserved' | 'incoming' | 'damaged' | 'returned' {
  if (bucket === 'on_hand' || bucket === 'available') return 'on_hand';
  if (bucket === 'reserved') return 'reserved';
  if (bucket === 'incoming') return 'incoming';
  if (bucket === 'damaged') return 'damaged';
  return 'returned';
}

async function lockBalanceRow(db: PostgresInventoryDb, productId: string): Promise<void> {
  await ensureBalanceRow(db, productId);
  await db
    .prepare('SELECT product_id FROM inventory_balances WHERE product_id = ? FOR UPDATE')
    .get(productId);
}

async function applyBucketDelta(
  db: PostgresInventoryDb,
  productId: string,
  bucket: StockBucket,
  delta: number,
  options: { allowNegative?: boolean; alreadyLocked?: boolean } = {},
): Promise<ProductStockSummary> {
  if (!options.alreadyLocked) {
    await lockBalanceRow(db, productId);
  } else {
    await ensureBalanceRow(db, productId);
  }

  const column = balanceColumn(bucket);
  const now = nowIso();

  if (options.allowNegative) {
    await db
      .prepare(
        `UPDATE inventory_balances
         SET ${column} = ${column} + ?, updated_at = ?
         WHERE product_id = ?`,
      )
      .run(delta, now, productId);
    return getBalance(db, productId);
  }

  // Atomic guard: never write an invalid on_hand/reserved balance.
  // Conditional UPDATE leaves the row unchanged when stock would go negative.
  const guardSql =
    column === 'on_hand'
      ? 'AND (on_hand + ?) >= -0.0001 AND reserved >= -0.0001'
      : column === 'reserved'
        ? 'AND on_hand >= -0.0001 AND (reserved + ?) >= -0.0001'
        : 'AND on_hand >= -0.0001 AND reserved >= -0.0001';
  const params =
    column === 'on_hand' || column === 'reserved'
      ? [delta, now, productId, delta]
      : [delta, now, productId];
  const updated = (await db
    .prepare(
      `UPDATE inventory_balances
       SET ${column} = ${column} + ?, updated_at = ?
       WHERE product_id = ?
         ${guardSql}
       RETURNING on_hand, reserved, incoming, damaged, returned`,
    )
    .get(...params)) as
    | {
        on_hand: number;
        reserved: number;
        incoming: number;
        damaged: number;
        returned: number;
      }
    | undefined;
  if (!updated) {
    throw new Error('INSUFFICIENT_STOCK');
  }
  return mapStock(updated);
}

export function createPostgresInventoryStore(
  db: PostgresInventoryDb,
  deps: {
    timeline: InventoryTimelineWriterAsync;
    allocateNumber: InventoryNumberAllocatorAsync;
  },
) {
  async function refreshAlertsForProduct(productId: string): Promise<void> {
    const productRow = (await db.prepare('SELECT * FROM products WHERE id = ?').get(productId)) as
      Record<string, unknown> | undefined;
    if (!productRow) return;
    const stock = await getBalance(db, productId);
    const lastMovement = (await db
      .prepare(
        `SELECT created_at FROM stock_movements
         WHERE product_id = ?
         ORDER BY created_at DESC, id DESC LIMIT 1`,
      )
      .get(productId)) as { created_at: string } | undefined;
    const sold = (await db
      .prepare(
        `SELECT COALESCE(SUM(CASE WHEN quantity_delta < 0 THEN -quantity_delta ELSE 0 END), 0) AS units
         FROM stock_movements
         WHERE product_id = ?
           AND movement_type IN ('invoice_issue', 'job_consume')
           AND created_at >= ?`,
      )
      .get(productId, new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString())) as {
      units: number;
    };
    const findings = evaluateStockIntelligence({
      product: mapProduct(productRow, stock),
      stock,
      lastMovementAt: lastMovement?.created_at ?? null,
      unitsSoldLast90Days: Number(sold.units ?? 0),
    });
    await db
      .prepare(
        `UPDATE inventory_alerts SET is_dismissed = 1, updated_at = ?
       WHERE product_id = ? AND is_dismissed = 0`,
      )
      .run(nowIso(), productId);
    const insert = db.prepare(
      `INSERT INTO inventory_alerts
        (id, product_id, kind, message, suggested_reorder_quantity, is_dismissed, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
    );
    const now = nowIso();
    for (const finding of findings) {
      await insert.run(
        randomUUID(),
        productId,
        finding.kind,
        finding.message,
        finding.suggestedReorderQuantity,
        now,
        now,
      );
      await deps.timeline('inventory.alert_raised', productId, {
        kind: finding.kind,
        message: finding.message,
      });
    }
  }

  async function postMovement(input: {
    productId: string;
    movementType: StockMovementType;
    quantityDelta: number;
    bucket?: StockBucket;
    unitCost?: number | null;
    referenceType?: string | null;
    referenceId?: string | null;
    referenceLineId?: string | null;
    notes?: string | null;
    createdBy?: string | null;
    allowNegative?: boolean;
  }): Promise<StockMovement> {
    const product = (await db
      .prepare('SELECT * FROM products WHERE id = ?')
      .get(input.productId)) as Record<string, unknown> | undefined;
    if (!product) throw new Error('PRODUCT_NOT_FOUND');
    if (!asBool(product.track_stock as number)) {
      throw new Error('PRODUCT_DOES_NOT_TRACK_STOCK');
    }

    // Serialize per-product balance mutations, then re-check idempotency under the lock.
    await lockBalanceRow(db, input.productId);

    if (input.referenceType && input.referenceId && input.referenceLineId) {
      const existing = (await db
        .prepare(
          `SELECT id FROM stock_movements
           WHERE product_id = ? AND movement_type = ?
             AND reference_type = ? AND reference_id = ? AND reference_line_id = ?`,
        )
        .get(
          input.productId,
          input.movementType,
          input.referenceType,
          input.referenceId,
          input.referenceLineId,
        )) as { id: string } | undefined;
      if (existing) {
        const row = (await db
          .prepare('SELECT * FROM stock_movements WHERE id = ?')
          .get(existing.id)) as Record<string, unknown>;
        return {
          id: String(row.id),
          productId: String(row.product_id),
          movementType: row.movement_type as StockMovementType,
          quantityDelta: Number(row.quantity_delta),
          unitCost: row.unit_cost == null ? null : Number(row.unit_cost),
          bucket: row.bucket as StockBucket,
          referenceType: (row.reference_type as string | null) ?? null,
          referenceId: (row.reference_id as string | null) ?? null,
          referenceLineId: (row.reference_line_id as string | null) ?? null,
          notes: (row.notes as string | null) ?? null,
          createdAt: String(row.created_at),
          createdBy: (row.created_by as string | null) ?? null,
        };
      }
    }

    const bucket = input.bucket ?? 'on_hand';
    await applyBucketDelta(db, input.productId, bucket, input.quantityDelta, {
      allowNegative: input.allowNegative === true,
      alreadyLocked: true,
    });
    assertNoInjectedFailure('inventory_post_movement_after_balance');

    const id = randomUUID();
    const createdAt = nowIso();
    await db
      .prepare(
        `INSERT INTO stock_movements (
        id, product_id, movement_type, quantity_delta, unit_cost, bucket,
        reference_type, reference_id, reference_line_id, notes, created_at, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.productId,
        input.movementType,
        input.quantityDelta,
        input.unitCost ?? null,
        bucket,
        input.referenceType ?? null,
        input.referenceId ?? null,
        input.referenceLineId ?? null,
        input.notes ?? null,
        createdAt,
        input.createdBy ?? null,
      );

    await deps.timeline('inventory.stock_moved', input.productId, {
      movementId: id,
      movementType: input.movementType,
      quantityDelta: input.quantityDelta,
      referenceType: input.referenceType ?? null,
      referenceId: input.referenceId ?? null,
    });
    await refreshAlertsForProduct(input.productId);
    return {
      id,
      productId: input.productId,
      movementType: input.movementType,
      quantityDelta: input.quantityDelta,
      unitCost: input.unitCost ?? null,
      bucket,
      referenceType: input.referenceType ?? null,
      referenceId: input.referenceId ?? null,
      referenceLineId: input.referenceLineId ?? null,
      notes: input.notes ?? null,
      createdAt,
      createdBy: input.createdBy ?? null,
    };
  }

  async function listBundleComponents(bundleProductId: string): Promise<ProductBundleComponent[]> {
    const rows = (await db
      .prepare(
        `SELECT id, bundle_product_id, component_product_id, quantity
         FROM product_bundle_components WHERE bundle_product_id = ?`,
      )
      .all(bundleProductId)) as Array<{
      id: string;
      bundle_product_id: string;
      component_product_id: string;
      quantity: number;
    }>;
    return rows.map((row) => ({
      id: row.id,
      bundleProductId: row.bundle_product_id,
      componentProductId: row.component_product_id,
      quantity: row.quantity,
    }));
  }

  async function consumeProductOrBundle(input: {
    productId: string;
    quantity: number;
    movementType: StockMovementType;
    referenceType: string;
    referenceId: string;
    referenceLineId: string;
    notes?: string | null;
  }): Promise<StockMovement[]> {
    const product = (await db
      .prepare('SELECT * FROM products WHERE id = ?')
      .get(input.productId)) as Record<string, unknown> | undefined;
    if (!product) throw new Error('PRODUCT_NOT_FOUND');
    const movements: StockMovement[] = [];
    if (asBool(product.is_bundle as number)) {
      const components = await listBundleComponents(input.productId);
      if (components.length === 0) throw new Error('BUNDLE_HAS_NO_COMPONENTS');
      for (const component of components) {
        movements.push(
          await postMovement({
            productId: component.componentProductId,
            movementType: input.movementType,
            quantityDelta: -(component.quantity * input.quantity),
            bucket: 'on_hand',
            referenceType: input.referenceType,
            referenceId: input.referenceId,
            referenceLineId: `${input.referenceLineId}:${component.componentProductId}`,
            notes: input.notes ?? `Bundle ${String(product.sku)} consumption`,
          }),
        );
      }
      return movements;
    }
    movements.push(
      await postMovement({
        productId: input.productId,
        movementType: input.movementType,
        quantityDelta: -input.quantity,
        bucket: 'on_hand',
        referenceType: input.referenceType,
        referenceId: input.referenceId,
        referenceLineId: input.referenceLineId,
        notes: input.notes ?? null,
      }),
    );
    return movements;
  }

  return {
    async createProduct(input: Record<string, unknown>): Promise<Product> {
      const id = randomUUID();
      const now = nowIso();
      const sku = asText(input.sku);
      const qrPayload = asOptionalText(input.qrPayload) ?? buildDefaultQrPayload({ id, sku });
      try {
        await db
          .prepare(
            `INSERT INTO products (
            id, sku, barcode, qr_payload, name, description, category, brand, supplier_id,
            unit_of_measure, cost_price, sell_price, gst_status, track_stock,
            minimum_stock_level, reorder_quantity, storage_location, weight,
            length_mm, width_mm, height_mm, image_url, notes, is_active, is_bundle, bundle_kind,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            id,
            sku,
            asOptionalText(input.barcode),
            qrPayload,
            asText(input.name),
            asOptionalText(input.description),
            asOptionalText(input.category),
            asOptionalText(input.brand),
            asOptionalText(input.supplierId),
            asText(input.unitOfMeasure, 'ea') || 'ea',
            Number(input.costPrice ?? 0),
            Number(input.sellPrice ?? 0),
            asText(input.gstStatus, 'gst') || 'gst',
            input.trackStock === false ? 0 : 1,
            Number(input.minimumStockLevel ?? 0),
            Number(input.reorderQuantity ?? 0),
            asOptionalText(input.storageLocation),
            asOptionalNumber(input.weight),
            asOptionalNumber(input.lengthMm),
            asOptionalNumber(input.widthMm),
            asOptionalNumber(input.heightMm),
            asOptionalText(input.imageUrl),
            asOptionalText(input.notes),
            input.isActive === false ? 0 : 1,
            input.isBundle === true ? 1 : 0,
            asOptionalText(input.bundleKind),
            now,
            now,
          );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (
          message.includes('products.sku') ||
          message.includes('UNIQUE constraint failed: products.sku')
        ) {
          throw new Error('PRODUCT_SKU_EXISTS');
        }
        if (message.includes('products.barcode')) {
          throw new Error('PRODUCT_BARCODE_EXISTS');
        }
        throw error;
      }

      await ensureBalanceRow(db, id);
      const opening = Number(input.openingStock ?? 0);
      if (opening > 0 && input.trackStock !== false) {
        await postMovement({
          productId: id,
          movementType: 'manual_adjustment',
          quantityDelta: opening,
          bucket: 'on_hand',
          notes: 'Opening stock',
          referenceType: 'product',
          referenceId: id,
          referenceLineId: 'opening',
        });
      }

      const components =
        (input.bundleComponents as
          | Array<{
              componentProductId: string;
              quantity: number;
            }>
          | undefined) ?? [];
      const insertComponent = db.prepare(
        `INSERT INTO product_bundle_components (id, bundle_product_id, component_product_id, quantity)
         VALUES (?, ?, ?, ?)`,
      );
      for (const component of components) {
        await insertComponent.run(
          randomUUID(),
          id,
          component.componentProductId,
          component.quantity,
        );
      }

      await deps.timeline('inventory.product_created', id, { sku, name: input.name });
      await refreshAlertsForProduct(id);
      const created = await this.getProductById(id);
      if (!created) throw new Error('PRODUCT_NOT_FOUND');
      return created;
    },

    async updateProduct(id: string, input: Record<string, unknown>): Promise<Product> {
      const existing = (await db.prepare('SELECT * FROM products WHERE id = ?').get(id)) as
        Record<string, unknown> | undefined;
      if (!existing) throw new Error('PRODUCT_NOT_FOUND');
      const now = nowIso();
      const next = {
        sku: input.sku !== undefined ? asText(input.sku) : asText(existing.sku),
        barcode:
          input.barcode !== undefined
            ? ((input.barcode as string | null) ?? null)
            : ((existing.barcode as string | null) ?? null),
        qrPayload:
          input.qrPayload !== undefined
            ? ((input.qrPayload as string | null) ?? null)
            : ((existing.qr_payload as string | null) ?? null),
        name: input.name !== undefined ? asText(input.name) : String(existing.name),
        description:
          input.description !== undefined
            ? ((input.description as string | null) ?? null)
            : ((existing.description as string | null) ?? null),
        category:
          input.category !== undefined
            ? ((input.category as string | null) ?? null)
            : ((existing.category as string | null) ?? null),
        brand:
          input.brand !== undefined
            ? ((input.brand as string | null) ?? null)
            : ((existing.brand as string | null) ?? null),
        supplierId:
          input.supplierId !== undefined
            ? ((input.supplierId as string | null) ?? null)
            : ((existing.supplier_id as string | null) ?? null),
        unitOfMeasure:
          input.unitOfMeasure !== undefined
            ? asText(input.unitOfMeasure, 'ea') || 'ea'
            : asText(existing.unit_of_measure, 'ea') || 'ea',
        costPrice:
          input.costPrice !== undefined ? Number(input.costPrice) : Number(existing.cost_price),
        sellPrice:
          input.sellPrice !== undefined ? Number(input.sellPrice) : Number(existing.sell_price),
        gstStatus:
          input.gstStatus !== undefined
            ? asText(input.gstStatus, 'gst') || 'gst'
            : asText(existing.gst_status, 'gst') || 'gst',
        trackStock:
          input.trackStock !== undefined
            ? Boolean(input.trackStock)
            : asBool(existing.track_stock as number),
        minimumStockLevel:
          input.minimumStockLevel !== undefined
            ? Number(input.minimumStockLevel)
            : Number(existing.minimum_stock_level),
        reorderQuantity:
          input.reorderQuantity !== undefined
            ? Number(input.reorderQuantity)
            : Number(existing.reorder_quantity),
        storageLocation:
          input.storageLocation !== undefined
            ? ((input.storageLocation as string | null) ?? null)
            : ((existing.storage_location as string | null) ?? null),
        weight:
          input.weight !== undefined
            ? ((input.weight as number | null) ?? null)
            : existing.weight == null
              ? null
              : Number(existing.weight),
        lengthMm:
          input.lengthMm !== undefined
            ? ((input.lengthMm as number | null) ?? null)
            : existing.length_mm == null
              ? null
              : Number(existing.length_mm),
        widthMm:
          input.widthMm !== undefined
            ? ((input.widthMm as number | null) ?? null)
            : existing.width_mm == null
              ? null
              : Number(existing.width_mm),
        heightMm:
          input.heightMm !== undefined
            ? ((input.heightMm as number | null) ?? null)
            : existing.height_mm == null
              ? null
              : Number(existing.height_mm),
        imageUrl:
          input.imageUrl !== undefined
            ? ((input.imageUrl as string | null) ?? null)
            : ((existing.image_url as string | null) ?? null),
        notes:
          input.notes !== undefined
            ? ((input.notes as string | null) ?? null)
            : ((existing.notes as string | null) ?? null),
        isActive:
          input.isActive !== undefined
            ? Boolean(input.isActive)
            : asBool(existing.is_active as number),
        isBundle:
          input.isBundle !== undefined
            ? Boolean(input.isBundle)
            : asBool(existing.is_bundle as number),
        bundleKind:
          input.bundleKind !== undefined
            ? ((input.bundleKind as string | null) ?? null)
            : ((existing.bundle_kind as string | null) ?? null),
      };

      try {
        await db
          .prepare(
            `UPDATE products SET
            sku = ?, barcode = ?, qr_payload = ?, name = ?, description = ?, category = ?, brand = ?,
            supplier_id = ?, unit_of_measure = ?, cost_price = ?, sell_price = ?, gst_status = ?,
            track_stock = ?, minimum_stock_level = ?, reorder_quantity = ?, storage_location = ?,
            weight = ?, length_mm = ?, width_mm = ?, height_mm = ?, image_url = ?, notes = ?,
            is_active = ?, is_bundle = ?, bundle_kind = ?, updated_at = ?
           WHERE id = ?`,
          )
          .run(
            next.sku,
            next.barcode,
            next.qrPayload,
            next.name,
            next.description,
            next.category,
            next.brand,
            next.supplierId,
            next.unitOfMeasure,
            next.costPrice,
            next.sellPrice,
            next.gstStatus,
            next.trackStock ? 1 : 0,
            next.minimumStockLevel,
            next.reorderQuantity,
            next.storageLocation,
            next.weight,
            next.lengthMm,
            next.widthMm,
            next.heightMm,
            next.imageUrl,
            next.notes,
            next.isActive ? 1 : 0,
            next.isBundle ? 1 : 0,
            next.bundleKind,
            now,
            id,
          );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('products.sku')) throw new Error('PRODUCT_SKU_EXISTS');
        if (message.includes('products.barcode')) throw new Error('PRODUCT_BARCODE_EXISTS');
        throw error;
      }

      if (input.bundleComponents) {
        await db
          .prepare('DELETE FROM product_bundle_components WHERE bundle_product_id = ?')
          .run(id);
        const insertComponent = db.prepare(
          `INSERT INTO product_bundle_components (id, bundle_product_id, component_product_id, quantity)
           VALUES (?, ?, ?, ?)`,
        );
        for (const component of input.bundleComponents as Array<{
          componentProductId: string;
          quantity: number;
        }>) {
          await insertComponent.run(
            randomUUID(),
            id,
            component.componentProductId,
            component.quantity,
          );
        }
      }

      await deps.timeline('inventory.product_updated', id, { sku: next.sku });
      await refreshAlertsForProduct(id);
      const updated = await this.getProductById(id);
      if (!updated) throw new Error('PRODUCT_NOT_FOUND');
      return updated;
    },

    async archiveProduct(id: string): Promise<Product> {
      return await this.updateProduct(id, { isActive: false });
    },

    async getProductById(id: string): Promise<Product | null> {
      const row = (await db.prepare('SELECT * FROM products WHERE id = ?').get(id)) as
        Record<string, unknown> | undefined;
      if (!row) return null;
      return mapProduct(row, await getBalance(db, id));
    },

    async listProducts(
      filter: {
        q?: string;
        sku?: string;
        barcode?: string;
        category?: string;
        supplierId?: string;
        isActive?: boolean;
        lowStock?: boolean;
        limit?: number;
        offset?: number;
      } = {},
    ): Promise<Product[]> {
      const clauses: string[] = [];
      const params: unknown[] = [];
      if (filter.q) {
        clauses.push(
          "(p.name LIKE ? OR p.sku LIKE ? OR COALESCE(p.barcode, '') LIKE ? OR COALESCE(p.description, '') LIKE ?)",
        );
        const like = `%${filter.q}%`;
        params.push(like, like, like, like);
      }
      if (filter.sku) {
        clauses.push('p.sku = ?');
        params.push(filter.sku);
      }
      if (filter.barcode) {
        clauses.push('p.barcode = ?');
        params.push(filter.barcode);
      }
      if (filter.category) {
        clauses.push('p.category = ?');
        params.push(filter.category);
      }
      if (filter.supplierId) {
        clauses.push('p.supplier_id = ?');
        params.push(filter.supplierId);
      }
      if (filter.isActive !== undefined) {
        clauses.push('p.is_active = ?');
        params.push(filter.isActive ? 1 : 0);
      }
      if (filter.lowStock) {
        clauses.push(
          `(COALESCE(b.on_hand, 0) - COALESCE(b.reserved, 0)) <= p.minimum_stock_level AND p.track_stock = 1`,
        );
      }
      const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
      const limit = filter.limit ?? 200;
      const offset = filter.offset ?? 0;
      const rows = (await db
        .prepare(
          `SELECT p.* FROM products p
           LEFT JOIN inventory_balances b ON b.product_id = p.id
           ${where}
           ORDER BY p.name ASC, p.sku ASC
           LIMIT ? OFFSET ?`,
        )
        .all(...params, limit, offset)) as Array<Record<string, unknown>>;
      const products: Product[] = [];
      for (const row of rows) {
        products.push(mapProduct(row, await getBalance(db, String(row.id))));
      }
      return products;
    },

    async lookupProductByCode(code: string): Promise<Product | null> {
      const row = (await db
        .prepare(
          `SELECT * FROM products
           WHERE barcode = ? OR sku = ? OR qr_payload = ?
           LIMIT 1`,
        )
        .get(code, code, code)) as Record<string, unknown> | undefined;
      if (!row) return null;
      return mapProduct(row, await getBalance(db, String(row.id)));
    },

    async adjustStock(input: {
      productId: string;
      quantityDelta: number;
      movementType?: StockMovementType;
      bucket?: StockBucket;
      unitCost?: number | null;
      notes?: string | null;
      referenceType?: string | null;
      referenceId?: string | null;
    }): Promise<StockMovement> {
      return await postMovement({
        productId: input.productId,
        quantityDelta: input.quantityDelta,
        movementType: input.movementType ?? 'manual_adjustment',
        bucket: input.bucket ?? 'on_hand',
        unitCost: input.unitCost ?? null,
        notes: input.notes ?? null,
        referenceType: input.referenceType ?? 'manual',
        referenceId: input.referenceId ?? randomUUID(),
        referenceLineId: 'adjustment',
      });
    },

    async transferStock(input: {
      productId: string;
      quantity: number;
      fromBucket: StockBucket;
      toBucket: StockBucket;
      notes?: string | null;
    }): Promise<{ out: StockMovement; in: StockMovement }> {
      if (input.fromBucket === input.toBucket) {
        throw new Error('TRANSFER_BUCKETS_MUST_DIFFER');
      }
      const referenceId = randomUUID();
      const out = await postMovement({
        productId: input.productId,
        quantityDelta: -input.quantity,
        movementType: 'transfer',
        bucket: input.fromBucket === 'available' ? 'on_hand' : input.fromBucket,
        notes: input.notes ?? null,
        referenceType: 'transfer',
        referenceId,
        referenceLineId: 'out',
      });
      const inbound = await postMovement({
        productId: input.productId,
        quantityDelta: input.quantity,
        movementType: 'transfer',
        bucket: input.toBucket === 'available' ? 'on_hand' : input.toBucket,
        notes: input.notes ?? null,
        referenceType: 'transfer',
        referenceId,
        referenceLineId: 'in',
      });
      return { out, in: inbound };
    },

    async listStockMovements(
      filter: {
        productId?: string;
        limit?: number;
        offset?: number;
      } = {},
    ): Promise<StockMovement[]> {
      const clauses: string[] = [];
      const params: unknown[] = [];
      if (filter.productId) {
        clauses.push('product_id = ?');
        params.push(filter.productId);
      }
      const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
      const rows = (await db
        .prepare(
          `SELECT * FROM stock_movements ${where}
           ORDER BY created_at DESC, id DESC
           LIMIT ? OFFSET ?`,
        )
        .all(...params, filter.limit ?? 200, filter.offset ?? 0)) as Array<Record<string, unknown>>;
      return rows.map((row) => ({
        id: String(row.id),
        productId: String(row.product_id),
        movementType: row.movement_type as StockMovementType,
        quantityDelta: Number(row.quantity_delta),
        unitCost: row.unit_cost == null ? null : Number(row.unit_cost),
        bucket: row.bucket as StockBucket,
        referenceType: (row.reference_type as string | null) ?? null,
        referenceId: (row.reference_id as string | null) ?? null,
        referenceLineId: (row.reference_line_id as string | null) ?? null,
        notes: (row.notes as string | null) ?? null,
        createdAt: String(row.created_at),
        createdBy: (row.created_by as string | null) ?? null,
      }));
    },

    async receivePurchaseOrder(
      purchaseOrderId: string,
      input: {
        lineItems: Array<{
          purchaseOrderLineItemId: string;
          quantityReceived: number;
          productId?: string | undefined;
        }>;
        notes?: string | null | undefined;
      },
    ): Promise<{
      receiptId: string;
      receiptNumber: string;
      movements: StockMovement[];
      receiptStatus: PurchaseOrderReceiptStatus;
    }> {
      const order = (await db
        .prepare('SELECT id, status FROM purchase_orders WHERE id = ? FOR UPDATE')
        .get(purchaseOrderId)) as { id: string; status: string } | undefined;
      if (!order) throw new Error('PURCHASE_ORDER_NOT_FOUND');
      if (!['Approved', 'Sent', 'PartiallyReceived', 'Received'].includes(order.status)) {
        throw new Error('PURCHASE_ORDER_NOT_RECEIVABLE');
      }

      const receiptId = randomUUID();
      const receiptNumber = await deps.allocateNumber('goods_receipt_sequences', 'GRN');
      const receivedAt = nowIso();
      await db
        .prepare(
          `INSERT INTO goods_receipts (id, purchase_order_id, receipt_number, notes, received_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          receiptId,
          purchaseOrderId,
          receiptNumber,
          input.notes ?? null,
          receivedAt,
          receivedAt,
        );

      const movements: StockMovement[] = [];
      const insertLine = db.prepare(
        `INSERT INTO goods_receipt_line_items
          (id, goods_receipt_id, purchase_order_line_item_id, product_id, quantity_received)
         VALUES (?, ?, ?, ?, ?)`,
      );

      for (const line of input.lineItems) {
        const poLine = (await db
          .prepare(
            `SELECT id, description, quantity, quantity_received, product_id, unit_price
             FROM purchase_order_line_items
             WHERE id = ? AND purchase_order_id = ?
             FOR UPDATE`,
          )
          .get(line.purchaseOrderLineItemId, purchaseOrderId)) as
          | {
              id: string;
              description: string;
              quantity: number;
              quantity_received: number;
              product_id: string | null;
              unit_price: number;
            }
          | undefined;
        if (!poLine) throw new Error('PURCHASE_ORDER_LINE_NOT_FOUND');
        const outstanding = poLine.quantity - (poLine.quantity_received ?? 0);
        if (line.quantityReceived > outstanding + 0.0001) {
          throw new Error('RECEIVE_EXCEEDS_OUTSTANDING');
        }
        const productId = line.productId ?? poLine.product_id;
        const updatedLine = (await db
          .prepare(
            `UPDATE purchase_order_line_items
             SET quantity_received = quantity_received + ?
             WHERE id = ?
               AND quantity_received + ? <= quantity + 0.0001
             RETURNING id`,
          )
          .get(line.quantityReceived, poLine.id, line.quantityReceived)) as
          { id: string } | undefined;
        if (!updatedLine) {
          throw new Error('RECEIVE_EXCEEDS_OUTSTANDING');
        }
        assertNoInjectedFailure('inventory_receive_after_line_update');
        if (productId) {
          await db
            .prepare('UPDATE purchase_order_line_items SET product_id = ? WHERE id = ?')
            .run(productId, poLine.id);
        }
        await insertLine.run(randomUUID(), receiptId, poLine.id, productId, line.quantityReceived);
        if (productId) {
          movements.push(
            await postMovement({
              productId,
              movementType: 'purchase_receipt',
              quantityDelta: line.quantityReceived,
              bucket: 'on_hand',
              unitCost: poLine.unit_price,
              referenceType: 'purchase_order',
              referenceId: purchaseOrderId,
              referenceLineId: `${receiptId}:${poLine.id}`,
              notes: input.notes ?? `Goods receipt ${receiptNumber}`,
            }),
          );
          // Clear any incoming reservation for this PO line.
          await postMovement({
            productId,
            movementType: 'reservation_release',
            quantityDelta: -line.quantityReceived,
            bucket: 'incoming',
            referenceType: 'purchase_order_incoming_clear',
            referenceId: purchaseOrderId,
            referenceLineId: `${receiptId}:${poLine.id}`,
            notes: 'Incoming cleared on receipt',
            allowNegative: true,
          });
        }
      }

      const receiptStatus = await this.getPurchaseOrderReceiptStatus(purchaseOrderId);
      await deps.timeline('purchase_order.goods_received', purchaseOrderId, {
        receiptId,
        receiptNumber,
        receiptStatus,
        movementCount: movements.length,
      });
      return { receiptId, receiptNumber, movements, receiptStatus };
    },

    async getPurchaseOrderReceiptStatus(
      purchaseOrderId: string,
    ): Promise<PurchaseOrderReceiptStatus> {
      const order = (await db
        .prepare('SELECT status FROM purchase_orders WHERE id = ?')
        .get(purchaseOrderId)) as { status: string } | undefined;
      if (!order) throw new Error('PURCHASE_ORDER_NOT_FOUND');
      if (order.status === 'Cancelled') return 'cancelled';
      if (order.status === 'Draft') return 'unordered';
      const lines = (await db
        .prepare(
          `SELECT quantity, quantity_received FROM purchase_order_line_items
           WHERE purchase_order_id = ?`,
        )
        .all(purchaseOrderId)) as Array<{ quantity: number; quantity_received: number }>;
      if (lines.length === 0) return 'ordered';
      const totalOrdered = lines.reduce((sum, line) => sum + line.quantity, 0);
      const totalReceived = lines.reduce((sum, line) => sum + (line.quantity_received ?? 0), 0);
      if (totalReceived <= 0) return 'ordered';
      if (totalReceived + 0.0001 >= totalOrdered) return 'received';
      return 'partial';
    },

    async markPurchaseOrderIncoming(purchaseOrderId: string): Promise<void> {
      const lines = (await db
        .prepare(
          `SELECT id, product_id, quantity, quantity_received
           FROM purchase_order_line_items WHERE purchase_order_id = ?`,
        )
        .all(purchaseOrderId)) as Array<{
        id: string;
        product_id: string | null;
        quantity: number;
        quantity_received: number;
      }>;
      for (const line of lines) {
        if (!line.product_id) continue;
        const outstanding = line.quantity - (line.quantity_received ?? 0);
        if (outstanding <= 0) continue;
        await postMovement({
          productId: line.product_id,
          movementType: 'reservation',
          quantityDelta: outstanding,
          bucket: 'incoming',
          referenceType: 'purchase_order_incoming',
          referenceId: purchaseOrderId,
          referenceLineId: line.id,
          notes: 'Incoming stock on PO approval',
          allowNegative: true,
        });
      }
    },

    async applyInvoiceStockOut(invoiceId: string): Promise<StockMovement[]> {
      const lines = (await db
        .prepare(
          `SELECT id, product_id, quantity, description
           FROM invoice_line_items WHERE invoice_id = ?`,
        )
        .all(invoiceId)) as Array<{
        id: string;
        product_id: string | null;
        quantity: number;
        description: string;
      }>;
      const movements: StockMovement[] = [];
      for (const line of lines) {
        if (!line.product_id) continue;
        movements.push(
          ...(await consumeProductOrBundle({
            productId: line.product_id,
            quantity: line.quantity,
            movementType: 'invoice_issue',
            referenceType: 'invoice',
            referenceId: invoiceId,
            referenceLineId: line.id,
            notes: line.description,
          })),
        );
      }
      return movements;
    },

    async setJobMaterials(
      jobId: string,
      materials: Array<{ productId: string; quantity: number; notes?: string | null | undefined }>,
    ): Promise<
      Array<{
        id: string;
        jobId: string;
        productId: string;
        quantity: number;
        notes: string | null;
      }>
    > {
      const job = await db.prepare('SELECT id FROM jobs WHERE id = ?').get(jobId);
      if (!job) throw new Error('JOB_NOT_FOUND');
      await db
        .prepare('DELETE FROM job_materials WHERE job_id = ? AND consumed_at IS NULL')
        .run(jobId);
      const insert = db.prepare(
        `INSERT INTO job_materials (id, job_id, product_id, quantity, notes, consumed_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, NULL, ?, ?)`,
      );
      const now = nowIso();
      const result = [];
      for (const material of materials) {
        const id = randomUUID();
        await insert.run(
          id,
          jobId,
          material.productId,
          material.quantity,
          material.notes ?? null,
          now,
          now,
        );
        result.push({
          id,
          jobId,
          productId: material.productId,
          quantity: material.quantity,
          notes: material.notes ?? null,
        });
      }
      return result;
    },

    async consumeJobMaterials(jobId: string): Promise<StockMovement[]> {
      const materials = (await db
        .prepare(
          `SELECT id, product_id, quantity, notes FROM job_materials
           WHERE job_id = ? AND consumed_at IS NULL`,
        )
        .all(jobId)) as Array<{
        id: string;
        product_id: string;
        quantity: number;
        notes: string | null;
      }>;
      const movements: StockMovement[] = [];
      const now = nowIso();
      for (const material of materials) {
        movements.push(
          ...(await consumeProductOrBundle({
            productId: material.product_id,
            quantity: material.quantity,
            movementType: 'job_consume',
            referenceType: 'job',
            referenceId: jobId,
            referenceLineId: material.id,
            notes: material.notes,
          })),
        );
        await db
          .prepare('UPDATE job_materials SET consumed_at = ?, updated_at = ? WHERE id = ?')
          .run(now, now, material.id);
      }
      return movements;
    },

    async createStocktake(input: {
      type: 'full' | 'partial' | 'cycle';
      notes?: string | null;
      productIds?: string[];
    }): Promise<Stocktake> {
      const id = randomUUID();
      const now = nowIso();
      const stocktakeNumber = await deps.allocateNumber('stocktake_sequences', 'STK');
      await db
        .prepare(
          `INSERT INTO stocktakes
          (id, stocktake_number, type, status, notes, started_at, submitted_at, approved_at, approved_by, created_at, updated_at)
         VALUES (?, ?, ?, 'In Progress', ?, ?, NULL, NULL, NULL, ?, ?)`,
        )
        .run(id, stocktakeNumber, input.type, input.notes ?? null, now, now, now);

      let productIds = input.productIds ?? [];
      if (input.type === 'full' || productIds.length === 0) {
        productIds = (
          (await db
            .prepare('SELECT id FROM products WHERE is_active = 1 AND track_stock = 1')
            .all()) as Array<{ id: string }>
        ).map((row) => row.id);
      }
      const insert = db.prepare(
        `INSERT INTO stocktake_lines
          (id, stocktake_id, product_id, expected_quantity, counted_quantity, notes)
         VALUES (?, ?, ?, ?, NULL, NULL)`,
      );
      for (const productId of productIds) {
        const stock = await getBalance(db, productId);
        await insert.run(randomUUID(), id, productId, stock.onHand);
      }
      await deps.timeline('inventory.stocktake_created', id, { stocktakeNumber, type: input.type });
      const createdStocktake = await this.getStocktakeById(id);
      if (!createdStocktake) throw new Error('STOCKTAKE_NOT_FOUND');
      return createdStocktake;
    },

    async updateStocktakeCounts(
      id: string,
      lines: Array<{
        productId: string;
        countedQuantity: number;
        notes?: string | null | undefined;
      }>,
    ): Promise<Stocktake> {
      const stocktake = (await db.prepare('SELECT status FROM stocktakes WHERE id = ?').get(id)) as
        { status: string } | undefined;
      if (!stocktake) throw new Error('STOCKTAKE_NOT_FOUND');
      if (!['Draft', 'In Progress'].includes(stocktake.status)) {
        throw new Error('STOCKTAKE_NOT_EDITABLE');
      }
      const upsert = db.prepare(
        `INSERT INTO stocktake_lines (id, stocktake_id, product_id, expected_quantity, counted_quantity, notes)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(stocktake_id, product_id) DO UPDATE SET
           counted_quantity = excluded.counted_quantity,
           notes = excluded.notes`,
      );
      for (const line of lines) {
        const existing = (await db
          .prepare(
            `SELECT id, expected_quantity FROM stocktake_lines
             WHERE stocktake_id = ? AND product_id = ?`,
          )
          .get(id, line.productId)) as { id: string; expected_quantity: number } | undefined;
        const expected =
          existing?.expected_quantity ?? (await getBalance(db, line.productId)).onHand;
        await upsert.run(
          existing?.id ?? randomUUID(),
          id,
          line.productId,
          expected,
          line.countedQuantity,
          line.notes ?? null,
        );
      }
      await db
        .prepare(`UPDATE stocktakes SET status = 'In Progress', updated_at = ? WHERE id = ?`)
        .run(nowIso(), id);
      const counted = await this.getStocktakeById(id);
      if (!counted) throw new Error('STOCKTAKE_NOT_FOUND');
      return counted;
    },

    async submitStocktake(id: string): Promise<Stocktake> {
      const stocktake = await this.getStocktakeById(id);
      if (!stocktake) throw new Error('STOCKTAKE_NOT_FOUND');
      if (!['Draft', 'In Progress'].includes(stocktake.status)) {
        throw new Error('STOCKTAKE_NOT_SUBMITTABLE');
      }
      const now = nowIso();
      await db
        .prepare(
          `UPDATE stocktakes SET status = 'Submitted', submitted_at = ?, updated_at = ? WHERE id = ?`,
        )
        .run(now, now, id);
      await deps.timeline('inventory.stocktake_submitted', id, {
        stocktakeNumber: stocktake.stocktakeNumber,
      });
      const submitted = await this.getStocktakeById(id);
      if (!submitted) throw new Error('STOCKTAKE_NOT_FOUND');
      return submitted;
    },

    async approveStocktake(id: string, approvedBy?: string | null): Promise<Stocktake> {
      const stocktake = await this.getStocktakeById(id);
      if (!stocktake) throw new Error('STOCKTAKE_NOT_FOUND');
      if (stocktake.status !== 'Submitted') throw new Error('STOCKTAKE_NOT_APPROVABLE');
      const lines = stocktake.lines ?? [];
      for (const line of lines) {
        if (line.countedQuantity == null) continue;
        const delta = line.countedQuantity - line.expectedQuantity;
        if (Math.abs(delta) < 0.0001) continue;
        await postMovement({
          productId: line.productId,
          movementType: 'stocktake_adjustment',
          quantityDelta: delta,
          bucket: 'on_hand',
          referenceType: 'stocktake',
          referenceId: id,
          referenceLineId: line.id,
          notes: line.notes ?? 'Stocktake variance adjustment',
          createdBy: approvedBy ?? null,
        });
      }
      const now = nowIso();
      await db
        .prepare(
          `UPDATE stocktakes
         SET status = 'Approved', approved_at = ?, approved_by = ?, updated_at = ?
         WHERE id = ?`,
        )
        .run(now, approvedBy ?? null, now, id);
      await deps.timeline('inventory.stocktake_approved', id, {
        stocktakeNumber: stocktake.stocktakeNumber,
      });
      const approved = await this.getStocktakeById(id);
      if (!approved) throw new Error('STOCKTAKE_NOT_FOUND');
      return approved;
    },

    async getStocktakeById(id: string): Promise<Stocktake | null> {
      const row = (await db.prepare('SELECT * FROM stocktakes WHERE id = ?').get(id)) as
        Record<string, unknown> | undefined;
      if (!row) return null;
      const lines = (await db
        .prepare('SELECT * FROM stocktake_lines WHERE stocktake_id = ?')
        .all(id)) as Array<Record<string, unknown>>;
      return {
        id: String(row.id),
        stocktakeNumber: String(row.stocktake_number),
        type: row.type as Stocktake['type'],
        status: row.status as Stocktake['status'],
        notes: (row.notes as string | null) ?? null,
        startedAt: (row.started_at as string | null) ?? null,
        submittedAt: (row.submitted_at as string | null) ?? null,
        approvedAt: (row.approved_at as string | null) ?? null,
        approvedBy: (row.approved_by as string | null) ?? null,
        createdAt: String(row.created_at),
        updatedAt: String(row.updated_at),
        lines: lines.map((line): StocktakeLine => ({
          id: String(line.id),
          stocktakeId: String(line.stocktake_id),
          productId: String(line.product_id),
          expectedQuantity: Number(line.expected_quantity),
          countedQuantity: line.counted_quantity == null ? null : Number(line.counted_quantity),
          variance:
            line.counted_quantity == null
              ? null
              : Number(line.counted_quantity) - Number(line.expected_quantity),
          notes: (line.notes as string | null) ?? null,
        })),
      };
    },

    async listStocktakes(limit = 100, offset = 0): Promise<Stocktake[]> {
      const rows = (await db
        .prepare(`SELECT * FROM stocktakes ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`)
        .all(limit, offset)) as Array<Record<string, unknown>>;
      const stocktakes: Stocktake[] = [];
      for (const row of rows) {
        const stocktake = await this.getStocktakeById(String(row.id));
        if (stocktake) stocktakes.push(stocktake);
      }
      return stocktakes;
    },

    async listInventoryAlerts(includeDismissed = false): Promise<InventoryAlert[]> {
      const rows = (await db
        .prepare(
          `SELECT a.*, p.name AS product_name, p.sku
           FROM inventory_alerts a
           JOIN products p ON p.id = a.product_id
           ${includeDismissed ? '' : 'WHERE a.is_dismissed = 0'}
           ORDER BY a.created_at DESC, a.id DESC
           LIMIT 200`,
        )
        .all()) as Array<Record<string, unknown>>;
      return rows.map((row) => ({
        id: String(row.id),
        productId: String(row.product_id),
        kind: row.kind as InventoryAlert['kind'],
        message: String(row.message),
        suggestedReorderQuantity:
          row.suggested_reorder_quantity == null ? null : Number(row.suggested_reorder_quantity),
        isDismissed: asBool(row.is_dismissed as number),
        createdAt: String(row.created_at),
        updatedAt: String(row.updated_at),
        productName: String(row.product_name),
        sku: String(row.sku),
      }));
    },

    async dismissInventoryAlert(id: string): Promise<void> {
      const existing = await db.prepare('SELECT id FROM inventory_alerts WHERE id = ?').get(id);
      if (!existing) throw new Error('INVENTORY_ALERT_NOT_FOUND');
      await db
        .prepare(`UPDATE inventory_alerts SET is_dismissed = 1, updated_at = ? WHERE id = ?`)
        .run(nowIso(), id);
    },

    async refreshAllInventoryAlerts(): Promise<InventoryAlert[]> {
      const products = (await db.prepare('SELECT id FROM products').all()) as Array<{ id: string }>;
      for (const product of products) await refreshAlertsForProduct(product.id);
      return await this.listInventoryAlerts(false);
    },

    async getInventoryReports(): Promise<InventoryReportBundle> {
      const products = await this.listProducts({ isActive: true, limit: 1000 });
      const stockValuation = products.map((product) => ({
        productId: product.id,
        sku: product.sku,
        name: product.name,
        onHand: product.stock?.onHand ?? 0,
        costPrice: product.costPrice,
        valuation: Number(((product.stock?.onHand ?? 0) * product.costPrice).toFixed(2)),
      }));
      const inventoryOnHand = products.map((product) => ({
        productId: product.id,
        sku: product.sku,
        name: product.name,
        onHand: product.stock?.onHand ?? 0,
        available: product.stock?.available ?? 0,
        reserved: product.stock?.reserved ?? 0,
        incoming: product.stock?.incoming ?? 0,
      }));
      const stockMovements = await this.listStockMovements({ limit: 500 });
      const purchaseHistory = (
        (await db
          .prepare(
            `SELECT id, purchase_order_number, supplier_id, issue_date, status, total
             FROM purchase_orders
             ORDER BY issue_date DESC, created_at DESC
             LIMIT 200`,
          )
          .all()) as Array<Record<string, unknown>>
      ).map((row) => ({
        purchaseOrderId: String(row.id),
        purchaseOrderNumber: String(row.purchase_order_number),
        supplierId: String(row.supplier_id),
        issueDate: String(row.issue_date),
        status: String(row.status),
        total: Number(row.total),
      }));
      const supplierPerformance = (
        (await db
          .prepare(
            `SELECT s.id, s.display_name,
                    COUNT(p.id) AS order_count,
                    COALESCE(SUM(p.total), 0) AS total_spend,
                    SUM(CASE WHEN p.status IN ('Approved', 'Sent', 'PartiallyReceived') THEN 1 ELSE 0 END) AS outstanding_orders
             FROM suppliers s
             LEFT JOIN purchase_orders p ON p.supplier_id = s.id
             GROUP BY s.id
             ORDER BY total_spend DESC`,
          )
          .all()) as Array<Record<string, unknown>>
      ).map((row) => ({
        supplierId: String(row.id),
        displayName: String(row.display_name),
        orderCount: Number(row.order_count),
        totalSpend: Number(row.total_spend),
        outstandingOrders: Number(row.outstanding_orders),
      }));
      const productProfitability = (
        (await db
          .prepare(
            `SELECT p.id, p.sku, p.name, p.cost_price, p.sell_price,
                    COALESCE(SUM(CASE WHEN m.movement_type = 'invoice_issue' AND m.quantity_delta < 0 THEN -m.quantity_delta ELSE 0 END), 0) AS units_sold
             FROM products p
             LEFT JOIN stock_movements m ON m.product_id = p.id
             GROUP BY p.id
             ORDER BY units_sold DESC`,
          )
          .all()) as Array<Record<string, unknown>>
      ).map((row) => {
        const costPrice = Number(row.cost_price);
        const sellPrice = Number(row.sell_price);
        const unitsSold = Number(row.units_sold);
        return {
          productId: String(row.id),
          sku: String(row.sku),
          name: String(row.name),
          costPrice,
          sellPrice,
          profitMargin: profitMarginPercent(costPrice, sellPrice),
          unitsSold,
          grossProfit: Number((unitsSold * (sellPrice - costPrice)).toFixed(2)),
        };
      });
      const deadStock = [];
      const fastMoving = [];
      for (const product of products) {
        const last = (await db
          .prepare(
            `SELECT created_at FROM stock_movements WHERE product_id = ?
             ORDER BY created_at DESC LIMIT 1`,
          )
          .get(product.id)) as { created_at: string } | undefined;
        const days = last
          ? Math.floor((Date.now() - new Date(last.created_at).getTime()) / (24 * 60 * 60 * 1000))
          : null;
        if ((product.stock?.onHand ?? 0) > 0 && (days === null || days >= 180)) {
          deadStock.push({
            productId: product.id,
            sku: product.sku,
            name: product.name,
            onHand: product.stock?.onHand ?? 0,
            daysSinceMovement: days,
          });
        }
        const unitsMoved = (await db
          .prepare(
            `SELECT COALESCE(SUM(ABS(quantity_delta)), 0) AS units
             FROM stock_movements
             WHERE product_id = ? AND created_at >= ?`,
          )
          .get(product.id, new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())) as {
          units: number;
        };
        if (Number(unitsMoved.units) > 0) {
          fastMoving.push({
            productId: product.id,
            sku: product.sku,
            name: product.name,
            unitsMoved: Number(unitsMoved.units),
          });
        }
      }
      fastMoving.sort((a, b) => b.unitsMoved - a.unitsMoved);
      const reorderRecommendations = products
        .filter(
          (product) =>
            product.trackStock && (product.stock?.available ?? 0) <= product.minimumStockLevel,
        )
        .map((product) => ({
          productId: product.id,
          sku: product.sku,
          name: product.name,
          available: product.stock?.available ?? 0,
          minimumStockLevel: product.minimumStockLevel,
          suggestedReorderQuantity:
            product.reorderQuantity ||
            Math.max(
              product.minimumStockLevel - (product.stock?.available ?? 0),
              product.minimumStockLevel,
              1,
            ),
        }));

      return {
        stockValuation,
        inventoryOnHand,
        stockMovements,
        purchaseHistory,
        supplierPerformance,
        productProfitability,
        deadStock,
        fastMoving: fastMoving.slice(0, 50),
        reorderRecommendations,
      };
    },
  };
}

export type PostgresInventoryStore = ReturnType<typeof createPostgresInventoryStore>;
