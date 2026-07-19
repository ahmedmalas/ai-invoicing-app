import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';

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

type SqliteDb = Database.Database;

export interface InventoryTimelineWriter {
  (eventKey: TimelineEventKey, entityId: string, payload: unknown): void;
}

export interface InventoryNumberAllocator {
  (table: 'goods_receipt_sequences' | 'stocktake_sequences', prefix: string): string;
}

function nowIso(): string {
  return new Date().toISOString();
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

function getBalance(db: SqliteDb, productId: string): ProductStockSummary {
  const row = db
    .prepare(
      `SELECT on_hand, reserved, incoming, damaged, returned
       FROM inventory_balances WHERE product_id = ?`,
    )
    .get(productId) as
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

function ensureBalanceRow(db: SqliteDb, productId: string): void {
  db.prepare(
    `INSERT OR IGNORE INTO inventory_balances
      (product_id, on_hand, reserved, incoming, damaged, returned, updated_at)
     VALUES (?, 0, 0, 0, 0, 0, ?)`,
  ).run(productId, nowIso());
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

function applyBucketDelta(
  db: SqliteDb,
  productId: string,
  bucket: StockBucket,
  delta: number,
  options: { allowNegative?: boolean } = {},
): ProductStockSummary {
  ensureBalanceRow(db, productId);
  const column = balanceColumn(bucket);
  const now = nowIso();

  if (options.allowNegative) {
    db.prepare(
      `UPDATE inventory_balances
       SET ${column} = ${column} + ?, updated_at = ?
       WHERE product_id = ?`,
    ).run(delta, now, productId);
    return getBalance(db, productId);
  }

  // Atomic guard: never write an invalid on_hand/reserved balance.
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
  const updated = db
    .prepare(
      `UPDATE inventory_balances
       SET ${column} = ${column} + ?, updated_at = ?
       WHERE product_id = ?
         ${guardSql}
       RETURNING on_hand, reserved, incoming, damaged, returned`,
    )
    .get(...params) as
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

export function ensureInventorySchemaSqlite(db: SqliteDb): void {
  const supplierCols = db
    .prepare("SELECT name FROM pragma_table_info('suppliers')")
    .all() as Array<{ name: string }>;
  const supplierSet = new Set(supplierCols.map((c) => c.name));
  for (const [column, ddl] of [
    ['contact_person', 'ALTER TABLE suppliers ADD COLUMN contact_person TEXT'],
    ['website', 'ALTER TABLE suppliers ADD COLUMN website TEXT'],
    ['payment_terms', 'ALTER TABLE suppliers ADD COLUMN payment_terms TEXT'],
  ] as const) {
    if (!supplierSet.has(column)) db.exec(ddl);
  }

  for (const table of [
    'purchase_order_line_items',
    'invoice_line_items',
    'quote_line_items',
  ] as const) {
    const cols = db.prepare(`SELECT name FROM pragma_table_info('${table}')`).all() as Array<{
      name: string;
    }>;
    const set = new Set(cols.map((c) => c.name));
    if (!set.has('product_id')) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN product_id TEXT`);
    }
  }

  const poLineCols = db
    .prepare("SELECT name FROM pragma_table_info('purchase_order_line_items')")
    .all() as Array<{ name: string }>;
  const poLineSet = new Set(poLineCols.map((c) => c.name));
  if (!poLineSet.has('quantity_received')) {
    db.exec(
      'ALTER TABLE purchase_order_line_items ADD COLUMN quantity_received REAL NOT NULL DEFAULT 0',
    );
  }

  // Allow goods-receipt updates to quantity_received / product_id on non-draft POs.
  db.exec('DROP TRIGGER IF EXISTS trg_purchase_order_line_items_non_draft_update');
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_purchase_order_line_items_non_draft_update
    BEFORE UPDATE ON purchase_order_line_items
    WHEN (
      EXISTS (
        SELECT 1 FROM purchase_orders p
        WHERE p.id = OLD.purchase_order_id AND p.status <> 'Draft'
      )
      OR EXISTS (
        SELECT 1 FROM purchase_orders p
        WHERE p.id = NEW.purchase_order_id AND p.status <> 'Draft'
      )
    )
    AND (
      NEW.id <> OLD.id
      OR NEW.purchase_order_id <> OLD.purchase_order_id
      OR NEW.description <> OLD.description
      OR NEW.quantity <> OLD.quantity
      OR NEW.unit_price <> OLD.unit_price
      OR NEW.gst_applicable <> OLD.gst_applicable
      OR NEW.line_subtotal <> OLD.line_subtotal
      OR NEW.line_gst <> OLD.line_gst
      OR NEW.line_total <> OLD.line_total
    )
    BEGIN
      SELECT RAISE(ABORT, 'IMMUTABLE_NON_DRAFT_PURCHASE_ORDER_LINE_ITEMS');
    END;
  `);
}

export function createInventoryStore(
  db: SqliteDb,
  deps: {
    timeline: InventoryTimelineWriter;
    allocateNumber: InventoryNumberAllocator;
  },
) {
  function refreshAlertsForProduct(productId: string): void {
    const productRow = db.prepare('SELECT * FROM products WHERE id = ?').get(productId) as
      Record<string, unknown> | undefined;
    if (!productRow) return;
    const stock = getBalance(db, productId);
    const lastMovement = db
      .prepare(
        `SELECT created_at FROM stock_movements
         WHERE product_id = ?
         ORDER BY created_at DESC, id DESC LIMIT 1`,
      )
      .get(productId) as { created_at: string } | undefined;
    const sold = db
      .prepare(
        `SELECT COALESCE(SUM(CASE WHEN quantity_delta < 0 THEN -quantity_delta ELSE 0 END), 0) AS units
         FROM stock_movements
         WHERE product_id = ?
           AND movement_type IN ('invoice_issue', 'job_consume')
           AND created_at >= ?`,
      )
      .get(productId, new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()) as {
      units: number;
    };
    const findings = evaluateStockIntelligence({
      product: mapProduct(productRow, stock),
      stock,
      lastMovementAt: lastMovement?.created_at ?? null,
      unitsSoldLast90Days: Number(sold.units ?? 0),
    });
    db.prepare(
      `UPDATE inventory_alerts SET is_dismissed = 1, updated_at = ?
       WHERE product_id = ? AND is_dismissed = 0`,
    ).run(nowIso(), productId);
    const insert = db.prepare(
      `INSERT INTO inventory_alerts
        (id, product_id, kind, message, suggested_reorder_quantity, is_dismissed, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
    );
    const now = nowIso();
    for (const finding of findings) {
      insert.run(
        randomUUID(),
        productId,
        finding.kind,
        finding.message,
        finding.suggestedReorderQuantity,
        now,
        now,
      );
      deps.timeline('inventory.alert_raised', productId, {
        kind: finding.kind,
        message: finding.message,
      });
    }
  }

  function postMovement(input: {
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
  }): StockMovement {
    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(input.productId) as
      Record<string, unknown> | undefined;
    if (!product) throw new Error('PRODUCT_NOT_FOUND');
    if (!asBool(product.track_stock as number)) {
      throw new Error('PRODUCT_DOES_NOT_TRACK_STOCK');
    }

    if (input.referenceType && input.referenceId && input.referenceLineId) {
      const existing = db
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
        ) as { id: string } | undefined;
      if (existing) {
        const row = db
          .prepare('SELECT * FROM stock_movements WHERE id = ?')
          .get(existing.id) as Record<string, unknown>;
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
    applyBucketDelta(db, input.productId, bucket, input.quantityDelta, {
      allowNegative: input.allowNegative === true,
    });

    const id = randomUUID();
    const createdAt = nowIso();
    db.prepare(
      `INSERT INTO stock_movements (
        id, product_id, movement_type, quantity_delta, unit_cost, bucket,
        reference_type, reference_id, reference_line_id, notes, created_at, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
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

    deps.timeline('inventory.stock_moved', input.productId, {
      movementId: id,
      movementType: input.movementType,
      quantityDelta: input.quantityDelta,
      referenceType: input.referenceType ?? null,
      referenceId: input.referenceId ?? null,
    });
    refreshAlertsForProduct(input.productId);
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

  function listBundleComponents(bundleProductId: string): ProductBundleComponent[] {
    const rows = db
      .prepare(
        `SELECT id, bundle_product_id, component_product_id, quantity
         FROM product_bundle_components WHERE bundle_product_id = ?`,
      )
      .all(bundleProductId) as Array<{
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

  function consumeProductOrBundle(input: {
    productId: string;
    quantity: number;
    movementType: StockMovementType;
    referenceType: string;
    referenceId: string;
    referenceLineId: string;
    notes?: string | null;
  }): StockMovement[] {
    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(input.productId) as
      Record<string, unknown> | undefined;
    if (!product) throw new Error('PRODUCT_NOT_FOUND');
    const movements: StockMovement[] = [];
    if (asBool(product.is_bundle as number)) {
      const components = listBundleComponents(input.productId);
      if (components.length === 0) throw new Error('BUNDLE_HAS_NO_COMPONENTS');
      for (const component of components) {
        movements.push(
          postMovement({
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
      postMovement({
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
    createProduct(input: Record<string, unknown>): Product {
      const id = randomUUID();
      const now = nowIso();
      const sku = asText(input.sku);
      const qrPayload = asOptionalText(input.qrPayload) ?? buildDefaultQrPayload({ id, sku });
      try {
        db.prepare(
          `INSERT INTO products (
            id, sku, barcode, qr_payload, name, description, category, brand, supplier_id,
            unit_of_measure, cost_price, sell_price, gst_status, track_stock,
            minimum_stock_level, reorder_quantity, storage_location, weight,
            length_mm, width_mm, height_mm, image_url, notes, is_active, is_bundle, bundle_kind,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
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

      ensureBalanceRow(db, id);
      const opening = Number(input.openingStock ?? 0);
      if (opening > 0 && input.trackStock !== false) {
        postMovement({
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
        insertComponent.run(randomUUID(), id, component.componentProductId, component.quantity);
      }

      deps.timeline('inventory.product_created', id, { sku, name: input.name });
      refreshAlertsForProduct(id);
      return this.getProductById(id)!;
    },

    updateProduct(id: string, input: Record<string, unknown>): Product {
      const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(id) as
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
        db.prepare(
          `UPDATE products SET
            sku = ?, barcode = ?, qr_payload = ?, name = ?, description = ?, category = ?, brand = ?,
            supplier_id = ?, unit_of_measure = ?, cost_price = ?, sell_price = ?, gst_status = ?,
            track_stock = ?, minimum_stock_level = ?, reorder_quantity = ?, storage_location = ?,
            weight = ?, length_mm = ?, width_mm = ?, height_mm = ?, image_url = ?, notes = ?,
            is_active = ?, is_bundle = ?, bundle_kind = ?, updated_at = ?
           WHERE id = ?`,
        ).run(
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
        db.prepare('DELETE FROM product_bundle_components WHERE bundle_product_id = ?').run(id);
        const insertComponent = db.prepare(
          `INSERT INTO product_bundle_components (id, bundle_product_id, component_product_id, quantity)
           VALUES (?, ?, ?, ?)`,
        );
        for (const component of input.bundleComponents as Array<{
          componentProductId: string;
          quantity: number;
        }>) {
          insertComponent.run(randomUUID(), id, component.componentProductId, component.quantity);
        }
      }

      deps.timeline('inventory.product_updated', id, { sku: next.sku });
      refreshAlertsForProduct(id);
      return this.getProductById(id)!;
    },

    archiveProduct(id: string): Product {
      return this.updateProduct(id, { isActive: false });
    },

    getProductById(id: string): Product | null {
      const row = db.prepare('SELECT * FROM products WHERE id = ?').get(id) as
        Record<string, unknown> | undefined;
      if (!row) return null;
      return mapProduct(row, getBalance(db, id));
    },

    listProducts(
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
    ): Product[] {
      const clauses: string[] = [];
      const params: unknown[] = [];
      if (filter.q) {
        clauses.push(
          "(p.name LIKE ? OR p.sku LIKE ? OR IFNULL(p.barcode, '') LIKE ? OR IFNULL(p.description, '') LIKE ?)",
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
          `(IFNULL(b.on_hand, 0) - IFNULL(b.reserved, 0)) <= p.minimum_stock_level AND p.track_stock = 1`,
        );
      }
      const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
      const limit = filter.limit ?? 200;
      const offset = filter.offset ?? 0;
      const rows = db
        .prepare(
          `SELECT p.* FROM products p
           LEFT JOIN inventory_balances b ON b.product_id = p.id
           ${where}
           ORDER BY p.name ASC, p.sku ASC
           LIMIT ? OFFSET ?`,
        )
        .all(...params, limit, offset) as Array<Record<string, unknown>>;
      return rows.map((row) => mapProduct(row, getBalance(db, String(row.id))));
    },

    lookupProductByCode(code: string): Product | null {
      const row = db
        .prepare(
          `SELECT * FROM products
           WHERE barcode = ? OR sku = ? OR qr_payload = ?
           LIMIT 1`,
        )
        .get(code, code, code) as Record<string, unknown> | undefined;
      if (!row) return null;
      return mapProduct(row, getBalance(db, String(row.id)));
    },

    adjustStock(input: {
      productId: string;
      quantityDelta: number;
      movementType?: StockMovementType;
      bucket?: StockBucket;
      unitCost?: number | null;
      notes?: string | null;
      referenceType?: string | null;
      referenceId?: string | null;
    }): StockMovement {
      return postMovement({
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

    transferStock(input: {
      productId: string;
      quantity: number;
      fromBucket: StockBucket;
      toBucket: StockBucket;
      notes?: string | null;
    }): { out: StockMovement; in: StockMovement } {
      if (input.fromBucket === input.toBucket) {
        throw new Error('TRANSFER_BUCKETS_MUST_DIFFER');
      }
      const referenceId = randomUUID();
      const out = postMovement({
        productId: input.productId,
        quantityDelta: -input.quantity,
        movementType: 'transfer',
        bucket: input.fromBucket === 'available' ? 'on_hand' : input.fromBucket,
        notes: input.notes ?? null,
        referenceType: 'transfer',
        referenceId,
        referenceLineId: 'out',
      });
      const inbound = postMovement({
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

    listStockMovements(
      filter: {
        productId?: string;
        limit?: number;
        offset?: number;
      } = {},
    ): StockMovement[] {
      const clauses: string[] = [];
      const params: unknown[] = [];
      if (filter.productId) {
        clauses.push('product_id = ?');
        params.push(filter.productId);
      }
      const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
      const rows = db
        .prepare(
          `SELECT * FROM stock_movements ${where}
           ORDER BY created_at DESC, id DESC
           LIMIT ? OFFSET ?`,
        )
        .all(...params, filter.limit ?? 200, filter.offset ?? 0) as Array<Record<string, unknown>>;
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

    receivePurchaseOrder(
      purchaseOrderId: string,
      input: {
        lineItems: Array<{
          purchaseOrderLineItemId: string;
          quantityReceived: number;
          productId?: string | undefined;
        }>;
        notes?: string | null | undefined;
      },
    ): {
      receiptId: string;
      receiptNumber: string;
      movements: StockMovement[];
      receiptStatus: PurchaseOrderReceiptStatus;
    } {
      const order = db
        .prepare('SELECT id, status FROM purchase_orders WHERE id = ?')
        .get(purchaseOrderId) as { id: string; status: string } | undefined;
      if (!order) throw new Error('PURCHASE_ORDER_NOT_FOUND');
      if (!['Approved', 'Sent', 'PartiallyReceived', 'Received'].includes(order.status)) {
        throw new Error('PURCHASE_ORDER_NOT_RECEIVABLE');
      }

      const receiptId = randomUUID();
      const receiptNumber = deps.allocateNumber('goods_receipt_sequences', 'GRN');
      const receivedAt = nowIso();
      db.prepare(
        `INSERT INTO goods_receipts (id, purchase_order_id, receipt_number, notes, received_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(receiptId, purchaseOrderId, receiptNumber, input.notes ?? null, receivedAt, receivedAt);

      const movements: StockMovement[] = [];
      const insertLine = db.prepare(
        `INSERT INTO goods_receipt_line_items
          (id, goods_receipt_id, purchase_order_line_item_id, product_id, quantity_received)
         VALUES (?, ?, ?, ?, ?)`,
      );

      for (const line of input.lineItems) {
        const poLine = db
          .prepare(
            `SELECT id, description, quantity, quantity_received, product_id, unit_price
             FROM purchase_order_line_items WHERE id = ? AND purchase_order_id = ?`,
          )
          .get(line.purchaseOrderLineItemId, purchaseOrderId) as
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
        db.prepare(
          `UPDATE purchase_order_line_items
           SET quantity_received = quantity_received + ?
           WHERE id = ?`,
        ).run(line.quantityReceived, poLine.id);
        if (productId) {
          db.prepare('UPDATE purchase_order_line_items SET product_id = ? WHERE id = ?').run(
            productId,
            poLine.id,
          );
        }
        insertLine.run(randomUUID(), receiptId, poLine.id, productId, line.quantityReceived);
        if (productId) {
          movements.push(
            postMovement({
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
          postMovement({
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

      const receiptStatus = this.getPurchaseOrderReceiptStatus(purchaseOrderId);
      deps.timeline('purchase_order.goods_received', purchaseOrderId, {
        receiptId,
        receiptNumber,
        receiptStatus,
        movementCount: movements.length,
      });
      return { receiptId, receiptNumber, movements, receiptStatus };
    },

    getPurchaseOrderReceiptStatus(purchaseOrderId: string): PurchaseOrderReceiptStatus {
      const order = db
        .prepare('SELECT status FROM purchase_orders WHERE id = ?')
        .get(purchaseOrderId) as { status: string } | undefined;
      if (!order) throw new Error('PURCHASE_ORDER_NOT_FOUND');
      if (order.status === 'Cancelled') return 'cancelled';
      if (order.status === 'Draft') return 'unordered';
      const lines = db
        .prepare(
          `SELECT quantity, quantity_received FROM purchase_order_line_items
           WHERE purchase_order_id = ?`,
        )
        .all(purchaseOrderId) as Array<{ quantity: number; quantity_received: number }>;
      if (lines.length === 0) return 'ordered';
      const totalOrdered = lines.reduce((sum, line) => sum + line.quantity, 0);
      const totalReceived = lines.reduce((sum, line) => sum + (line.quantity_received ?? 0), 0);
      if (totalReceived <= 0) return 'ordered';
      if (totalReceived + 0.0001 >= totalOrdered) return 'received';
      return 'partial';
    },

    markPurchaseOrderIncoming(purchaseOrderId: string): void {
      const lines = db
        .prepare(
          `SELECT id, product_id, quantity, quantity_received
           FROM purchase_order_line_items WHERE purchase_order_id = ?`,
        )
        .all(purchaseOrderId) as Array<{
        id: string;
        product_id: string | null;
        quantity: number;
        quantity_received: number;
      }>;
      for (const line of lines) {
        if (!line.product_id) continue;
        const outstanding = line.quantity - (line.quantity_received ?? 0);
        if (outstanding <= 0) continue;
        postMovement({
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

    applyInvoiceStockOut(invoiceId: string): StockMovement[] {
      const lines = db
        .prepare(
          `SELECT id, product_id, quantity, description
           FROM invoice_line_items WHERE invoice_id = ?`,
        )
        .all(invoiceId) as Array<{
        id: string;
        product_id: string | null;
        quantity: number;
        description: string;
      }>;
      const movements: StockMovement[] = [];
      for (const line of lines) {
        if (!line.product_id) continue;
        movements.push(
          ...consumeProductOrBundle({
            productId: line.product_id,
            quantity: line.quantity,
            movementType: 'invoice_issue',
            referenceType: 'invoice',
            referenceId: invoiceId,
            referenceLineId: line.id,
            notes: line.description,
          }),
        );
      }
      return movements;
    },

    setJobMaterials(
      jobId: string,
      materials: Array<{ productId: string; quantity: number; notes?: string | null | undefined }>,
    ): Array<{
      id: string;
      jobId: string;
      productId: string;
      quantity: number;
      notes: string | null;
    }> {
      const job = db.prepare('SELECT id FROM jobs WHERE id = ?').get(jobId);
      if (!job) throw new Error('JOB_NOT_FOUND');
      db.prepare('DELETE FROM job_materials WHERE job_id = ? AND consumed_at IS NULL').run(jobId);
      const insert = db.prepare(
        `INSERT INTO job_materials (id, job_id, product_id, quantity, notes, consumed_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, NULL, ?, ?)`,
      );
      const now = nowIso();
      const result = [];
      for (const material of materials) {
        const id = randomUUID();
        insert.run(
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

    consumeJobMaterials(jobId: string): StockMovement[] {
      const materials = db
        .prepare(
          `SELECT id, product_id, quantity, notes FROM job_materials
           WHERE job_id = ? AND consumed_at IS NULL`,
        )
        .all(jobId) as Array<{
        id: string;
        product_id: string;
        quantity: number;
        notes: string | null;
      }>;
      const movements: StockMovement[] = [];
      const now = nowIso();
      for (const material of materials) {
        movements.push(
          ...consumeProductOrBundle({
            productId: material.product_id,
            quantity: material.quantity,
            movementType: 'job_consume',
            referenceType: 'job',
            referenceId: jobId,
            referenceLineId: material.id,
            notes: material.notes,
          }),
        );
        db.prepare('UPDATE job_materials SET consumed_at = ?, updated_at = ? WHERE id = ?').run(
          now,
          now,
          material.id,
        );
      }
      return movements;
    },

    createStocktake(input: {
      type: 'full' | 'partial' | 'cycle';
      notes?: string | null;
      productIds?: string[];
    }): Stocktake {
      const id = randomUUID();
      const now = nowIso();
      const stocktakeNumber = deps.allocateNumber('stocktake_sequences', 'STK');
      db.prepare(
        `INSERT INTO stocktakes
          (id, stocktake_number, type, status, notes, started_at, submitted_at, approved_at, approved_by, created_at, updated_at)
         VALUES (?, ?, ?, 'In Progress', ?, ?, NULL, NULL, NULL, ?, ?)`,
      ).run(id, stocktakeNumber, input.type, input.notes ?? null, now, now, now);

      let productIds = input.productIds ?? [];
      if (input.type === 'full' || productIds.length === 0) {
        productIds = (
          db
            .prepare('SELECT id FROM products WHERE is_active = 1 AND track_stock = 1')
            .all() as Array<{ id: string }>
        ).map((row) => row.id);
      }
      const insert = db.prepare(
        `INSERT INTO stocktake_lines
          (id, stocktake_id, product_id, expected_quantity, counted_quantity, notes)
         VALUES (?, ?, ?, ?, NULL, NULL)`,
      );
      for (const productId of productIds) {
        const stock = getBalance(db, productId);
        insert.run(randomUUID(), id, productId, stock.onHand);
      }
      deps.timeline('inventory.stocktake_created', id, { stocktakeNumber, type: input.type });
      return this.getStocktakeById(id)!;
    },

    updateStocktakeCounts(
      id: string,
      lines: Array<{
        productId: string;
        countedQuantity: number;
        notes?: string | null | undefined;
      }>,
    ): Stocktake {
      const stocktake = db.prepare('SELECT status FROM stocktakes WHERE id = ?').get(id) as
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
        const existing = db
          .prepare(
            `SELECT id, expected_quantity FROM stocktake_lines
             WHERE stocktake_id = ? AND product_id = ?`,
          )
          .get(id, line.productId) as { id: string; expected_quantity: number } | undefined;
        const expected = existing?.expected_quantity ?? getBalance(db, line.productId).onHand;
        upsert.run(
          existing?.id ?? randomUUID(),
          id,
          line.productId,
          expected,
          line.countedQuantity,
          line.notes ?? null,
        );
      }
      db.prepare(`UPDATE stocktakes SET status = 'In Progress', updated_at = ? WHERE id = ?`).run(
        nowIso(),
        id,
      );
      return this.getStocktakeById(id)!;
    },

    submitStocktake(id: string): Stocktake {
      const stocktake = this.getStocktakeById(id);
      if (!stocktake) throw new Error('STOCKTAKE_NOT_FOUND');
      if (!['Draft', 'In Progress'].includes(stocktake.status)) {
        throw new Error('STOCKTAKE_NOT_SUBMITTABLE');
      }
      const now = nowIso();
      db.prepare(
        `UPDATE stocktakes SET status = 'Submitted', submitted_at = ?, updated_at = ? WHERE id = ?`,
      ).run(now, now, id);
      deps.timeline('inventory.stocktake_submitted', id, {
        stocktakeNumber: stocktake.stocktakeNumber,
      });
      return this.getStocktakeById(id)!;
    },

    approveStocktake(id: string, approvedBy?: string | null): Stocktake {
      const stocktake = this.getStocktakeById(id);
      if (!stocktake) throw new Error('STOCKTAKE_NOT_FOUND');
      if (stocktake.status !== 'Submitted') throw new Error('STOCKTAKE_NOT_APPROVABLE');
      const lines = stocktake.lines ?? [];
      for (const line of lines) {
        if (line.countedQuantity == null) continue;
        const delta = line.countedQuantity - line.expectedQuantity;
        if (Math.abs(delta) < 0.0001) continue;
        postMovement({
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
      db.prepare(
        `UPDATE stocktakes
         SET status = 'Approved', approved_at = ?, approved_by = ?, updated_at = ?
         WHERE id = ?`,
      ).run(now, approvedBy ?? null, now, id);
      deps.timeline('inventory.stocktake_approved', id, {
        stocktakeNumber: stocktake.stocktakeNumber,
      });
      return this.getStocktakeById(id)!;
    },

    getStocktakeById(id: string): Stocktake | null {
      const row = db.prepare('SELECT * FROM stocktakes WHERE id = ?').get(id) as
        Record<string, unknown> | undefined;
      if (!row) return null;
      const lines = db
        .prepare('SELECT * FROM stocktake_lines WHERE stocktake_id = ?')
        .all(id) as Array<Record<string, unknown>>;
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

    listStocktakes(limit = 100, offset = 0): Stocktake[] {
      const rows = db
        .prepare(`SELECT * FROM stocktakes ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`)
        .all(limit, offset) as Array<Record<string, unknown>>;
      return rows.map((row) => this.getStocktakeById(String(row.id))!);
    },

    listInventoryAlerts(includeDismissed = false): InventoryAlert[] {
      const rows = db
        .prepare(
          `SELECT a.*, p.name AS product_name, p.sku
           FROM inventory_alerts a
           JOIN products p ON p.id = a.product_id
           ${includeDismissed ? '' : 'WHERE a.is_dismissed = 0'}
           ORDER BY a.created_at DESC, a.id DESC
           LIMIT 200`,
        )
        .all() as Array<Record<string, unknown>>;
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

    dismissInventoryAlert(id: string): void {
      const result = db
        .prepare(`UPDATE inventory_alerts SET is_dismissed = 1, updated_at = ? WHERE id = ?`)
        .run(nowIso(), id);
      if (result.changes === 0) throw new Error('INVENTORY_ALERT_NOT_FOUND');
    },

    refreshAllInventoryAlerts(): InventoryAlert[] {
      const products = db.prepare('SELECT id FROM products').all() as Array<{ id: string }>;
      for (const product of products) refreshAlertsForProduct(product.id);
      return this.listInventoryAlerts(false);
    },

    getInventoryReports(): InventoryReportBundle {
      const products = this.listProducts({ isActive: true, limit: 1000 });
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
      const stockMovements = this.listStockMovements({ limit: 500 });
      const purchaseHistory = (
        db
          .prepare(
            `SELECT id, purchase_order_number, supplier_id, issue_date, status, total
             FROM purchase_orders
             ORDER BY issue_date DESC, created_at DESC
             LIMIT 200`,
          )
          .all() as Array<Record<string, unknown>>
      ).map((row) => ({
        purchaseOrderId: String(row.id),
        purchaseOrderNumber: String(row.purchase_order_number),
        supplierId: String(row.supplier_id),
        issueDate: String(row.issue_date),
        status: String(row.status),
        total: Number(row.total),
      }));
      const supplierPerformance = (
        db
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
          .all() as Array<Record<string, unknown>>
      ).map((row) => ({
        supplierId: String(row.id),
        displayName: String(row.display_name),
        orderCount: Number(row.order_count),
        totalSpend: Number(row.total_spend),
        outstandingOrders: Number(row.outstanding_orders),
      }));
      const productProfitability = (
        db
          .prepare(
            `SELECT p.id, p.sku, p.name, p.cost_price, p.sell_price,
                    COALESCE(SUM(CASE WHEN m.movement_type = 'invoice_issue' AND m.quantity_delta < 0 THEN -m.quantity_delta ELSE 0 END), 0) AS units_sold
             FROM products p
             LEFT JOIN stock_movements m ON m.product_id = p.id
             GROUP BY p.id
             ORDER BY units_sold DESC`,
          )
          .all() as Array<Record<string, unknown>>
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
        const last = db
          .prepare(
            `SELECT created_at FROM stock_movements WHERE product_id = ?
             ORDER BY created_at DESC LIMIT 1`,
          )
          .get(product.id) as { created_at: string } | undefined;
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
        const unitsMoved = db
          .prepare(
            `SELECT COALESCE(SUM(ABS(quantity_delta)), 0) AS units
             FROM stock_movements
             WHERE product_id = ? AND created_at >= ?`,
          )
          .get(product.id, new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()) as {
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

export type InventoryStore = ReturnType<typeof createInventoryStore>;
