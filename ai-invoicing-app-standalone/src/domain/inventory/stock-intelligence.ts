import type { InventoryAlertKind, Product, ProductStockSummary } from './types.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface StockIntelligenceInput {
  product: Product;
  stock: ProductStockSummary;
  lastMovementAt: string | null;
  unitsSoldLast90Days: number;
  now?: Date;
}

export interface StockIntelligenceFinding {
  kind: InventoryAlertKind;
  message: string;
  suggestedReorderQuantity: number | null;
}

export function computeSuggestedReorderQuantity(
  stock: ProductStockSummary,
  minimumStockLevel: number,
  reorderQuantity: number,
): number {
  if (reorderQuantity > 0) return reorderQuantity;
  const deficit = Math.max(0, minimumStockLevel - stock.available);
  return deficit > 0 ? Math.max(deficit, minimumStockLevel) : minimumStockLevel || 1;
}

export function evaluateStockIntelligence(input: StockIntelligenceInput): StockIntelligenceFinding[] {
  const { product, stock } = input;
  const now = input.now ?? new Date();
  const findings: StockIntelligenceFinding[] = [];

  if (!product.trackStock || !product.isActive) {
    return findings;
  }

  if (stock.available <= 0) {
    findings.push({
      kind: 'out_of_stock',
      message: `${product.name} is out of stock`,
      suggestedReorderQuantity: computeSuggestedReorderQuantity(
        stock,
        product.minimumStockLevel,
        product.reorderQuantity,
      ),
    });
  } else if (stock.available <= product.minimumStockLevel) {
    findings.push({
      kind: 'low_stock',
      message: `${product.name} is below minimum stock (${stock.available} available)`,
      suggestedReorderQuantity: computeSuggestedReorderQuantity(
        stock,
        product.minimumStockLevel,
        product.reorderQuantity,
      ),
    });
  }

  const overstockThreshold = Math.max(product.minimumStockLevel * 5, product.reorderQuantity * 3, 50);
  if (stock.onHand >= overstockThreshold && overstockThreshold > 0) {
    findings.push({
      kind: 'overstocked',
      message: `${product.name} appears overstocked (${stock.onHand} on hand)`,
      suggestedReorderQuantity: null,
    });
  }

  const daysSinceMovement = input.lastMovementAt
    ? Math.floor((now.getTime() - new Date(input.lastMovementAt).getTime()) / MS_PER_DAY)
    : null;

  if (stock.onHand > 0 && (daysSinceMovement === null || daysSinceMovement >= 180)) {
    findings.push({
      kind: 'dead_stock',
      message: `${product.name} has no recent movement`,
      suggestedReorderQuantity: null,
    });
  } else if (
    stock.onHand > 0 &&
    input.unitsSoldLast90Days <= 0 &&
    daysSinceMovement !== null &&
    daysSinceMovement >= 90
  ) {
    findings.push({
      kind: 'slow_moving',
      message: `${product.name} is slow-moving`,
      suggestedReorderQuantity: null,
    });
  }

  return findings;
}

export function profitMarginPercent(costPrice: number, sellPrice: number): number {
  if (sellPrice <= 0) return 0;
  return Number((((sellPrice - costPrice) / sellPrice) * 100).toFixed(2));
}
