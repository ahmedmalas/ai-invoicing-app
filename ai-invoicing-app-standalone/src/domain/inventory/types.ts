export type ProductGstStatus = 'gst' | 'gst_free';

export type StockBucket =
  | 'on_hand'
  | 'available'
  | 'reserved'
  | 'incoming'
  | 'damaged'
  | 'returned';

export type StockMovementType =
  | 'purchase_receipt'
  | 'invoice_issue'
  | 'job_consume'
  | 'manual_adjustment'
  | 'return'
  | 'transfer'
  | 'write_off'
  | 'stocktake_adjustment'
  | 'bundle_assembly'
  | 'reservation'
  | 'reservation_release';

export type StocktakeType = 'full' | 'partial' | 'cycle';
export type StocktakeStatus = 'Draft' | 'In Progress' | 'Submitted' | 'Approved' | 'Cancelled';

export type InventoryAlertKind =
  | 'low_stock'
  | 'out_of_stock'
  | 'slow_moving'
  | 'dead_stock'
  | 'overstocked';

export type BundleKind = 'kit' | 'service_package' | 'assembly';

export type PurchaseOrderReceiptStatus = 'unordered' | 'ordered' | 'partial' | 'received' | 'cancelled';

export interface Product {
  id: string;
  sku: string;
  barcode: string | null;
  qrPayload: string | null;
  name: string;
  description: string | null;
  category: string | null;
  brand: string | null;
  supplierId: string | null;
  unitOfMeasure: string;
  costPrice: number;
  sellPrice: number;
  gstStatus: ProductGstStatus;
  profitMargin: number;
  trackStock: boolean;
  minimumStockLevel: number;
  reorderQuantity: number;
  storageLocation: string | null;
  weight: number | null;
  lengthMm: number | null;
  widthMm: number | null;
  heightMm: number | null;
  imageUrl: string | null;
  notes: string | null;
  isActive: boolean;
  isBundle: boolean;
  bundleKind: BundleKind | null;
  createdAt: string;
  updatedAt: string;
  stock?: ProductStockSummary;
}

export interface ProductStockSummary {
  onHand: number;
  available: number;
  reserved: number;
  incoming: number;
  damaged: number;
  returned: number;
}

export interface StockMovement {
  id: string;
  productId: string;
  movementType: StockMovementType;
  quantityDelta: number;
  unitCost: number | null;
  bucket: StockBucket;
  referenceType: string | null;
  referenceId: string | null;
  referenceLineId: string | null;
  notes: string | null;
  createdAt: string;
  createdBy: string | null;
}

export interface ProductBundleComponent {
  id: string;
  bundleProductId: string;
  componentProductId: string;
  quantity: number;
}

export interface Stocktake {
  id: string;
  stocktakeNumber: string;
  type: StocktakeType;
  status: StocktakeStatus;
  notes: string | null;
  startedAt: string | null;
  submittedAt: string | null;
  approvedAt: string | null;
  approvedBy: string | null;
  createdAt: string;
  updatedAt: string;
  lines?: StocktakeLine[];
}

export interface StocktakeLine {
  id: string;
  stocktakeId: string;
  productId: string;
  expectedQuantity: number;
  countedQuantity: number | null;
  variance: number | null;
  notes: string | null;
}

export interface InventoryAlert {
  id: string;
  productId: string;
  kind: InventoryAlertKind;
  message: string;
  suggestedReorderQuantity: number | null;
  isDismissed: boolean;
  createdAt: string;
  updatedAt: string;
  productName?: string;
  sku?: string;
}

export interface InventoryReportBundle {
  stockValuation: Array<{
    productId: string;
    sku: string;
    name: string;
    onHand: number;
    costPrice: number;
    valuation: number;
  }>;
  inventoryOnHand: Array<{
    productId: string;
    sku: string;
    name: string;
    onHand: number;
    available: number;
    reserved: number;
    incoming: number;
  }>;
  stockMovements: StockMovement[];
  purchaseHistory: Array<{
    purchaseOrderId: string;
    purchaseOrderNumber: string;
    supplierId: string;
    issueDate: string;
    status: string;
    total: number;
  }>;
  supplierPerformance: Array<{
    supplierId: string;
    displayName: string;
    orderCount: number;
    totalSpend: number;
    outstandingOrders: number;
  }>;
  productProfitability: Array<{
    productId: string;
    sku: string;
    name: string;
    costPrice: number;
    sellPrice: number;
    profitMargin: number;
    unitsSold: number;
    grossProfit: number;
  }>;
  deadStock: Array<{ productId: string; sku: string; name: string; onHand: number; daysSinceMovement: number | null }>;
  fastMoving: Array<{ productId: string; sku: string; name: string; unitsMoved: number }>;
  reorderRecommendations: Array<{
    productId: string;
    sku: string;
    name: string;
    available: number;
    minimumStockLevel: number;
    suggestedReorderQuantity: number;
  }>;
}
