import { prisma } from "@/prisma/client";

export type HealthSeverity = "HEALTHY" | "WARNING" | "CRITICAL";

export interface InventoryHealthIssue {
  id: string;
  category:
    | "NEGATIVE_STOCK"
    | "NEGATIVE_BATCH"
    | "BIN_OVERRUN"
    | "BATCH_OVERRUN"
    | "RESERVATION_OVERRUN"
    | "EXPIRED_BATCH"
    | "INACTIVE_BIN_STOCK"
    | "INACTIVE_BATCH_STOCK"
    | "ORPHAN_RECORD";
  severity: "WARNING" | "CRITICAL";
  productId?: string;
  productName?: string;
  productSku?: string | null;
  warehouseId?: string;
  warehouseName?: string;
  binId?: string;
  binCode?: string;
  batchId?: string;
  batchNumber?: string;
  message: string;
  expectedValue?: number | string;
  actualValue?: number | string;
}

export interface InventoryHealthReport {
  healthScore: number; // 0 to 100%
  status: HealthSeverity;
  summary: {
    totalProductsChecked: number;
    totalWarehousesChecked: number;
    totalBinsChecked: number;
    totalBatchesChecked: number;
    criticalIssuesCount: number;
    warningIssuesCount: number;
  };
  issues: InventoryHealthIssue[];
  affectedWarehouses: { id: string; name: string; criticalCount: number; warningCount: number }[];
  lastReconciliationTimestamp: string;
}

/**
 * READ-ONLY Engine: Performs comprehensive WMS health checks.
 * NEVER mutates database state.
 */
export async function getInventoryHealthReport(warehouseIdFilter?: string): Promise<InventoryHealthReport> {
  const whWhere = warehouseIdFilter ? { id: warehouseIdFilter } : {};

  const [warehouses, products, stockAllocations, binAllocations, batches, reservations] = await Promise.all([
    prisma.warehouse.findMany({ where: whWhere, select: { id: true, name: true } }),
    prisma.product.findMany({ where: { deletedAt: null }, select: { id: true, name: true, sku: true, trackingMode: true, expirationDate: true } }),
    prisma.stockAllocation.findMany({ where: warehouseIdFilter ? { warehouseId: warehouseIdFilter } : {} }),
    prisma.stockLocationAllocation.findMany({
      where: warehouseIdFilter ? { warehouseId: warehouseIdFilter } : {},
      include: { bin: { select: { id: true, code: true, active: true } } },
    }),
    prisma.inventoryBatch.findMany({ where: warehouseIdFilter ? { warehouseId: warehouseIdFilter } : {} }),
    prisma.stockReservationItem.findMany({
      where: {
        ...(warehouseIdFilter ? { warehouseId: warehouseIdFilter } : {}),
        reservation: { status: { in: ["ACTIVE", "PARTIALLY_FULFILLED"] } },
      },
      select: { productId: true, warehouseId: true, remainingQuantity: true },
    }),
  ]);

  const issues: InventoryHealthIssue[] = [];
  const warehouseMap = new Map(warehouses.map((w) => [w.id, w.name]));
  const productMap = new Map(products.map((p) => [p.id, p]));

  // 1. Warehouse Stock & Reservation Overruns
  const whStockMap = new Map<string, number>(); // `${productId}_${warehouseId}` -> qty
  for (const sa of stockAllocations) {
    const key = `${sa.productId}_${sa.warehouseId}`;
    whStockMap.set(key, sa.quantity);

    if (sa.quantity < 0) {
      const prod = productMap.get(sa.productId);
      issues.push({
        id: `neg-sa-${sa.id}`,
        category: "NEGATIVE_STOCK",
        severity: "CRITICAL",
        productId: sa.productId,
        productName: prod?.name || "Unknown Product",
        productSku: prod?.sku || null,
        warehouseId: sa.warehouseId,
        warehouseName: warehouseMap.get(sa.warehouseId) || "Warehouse",
        message: `Warehouse physical stock is negative (${sa.quantity}).`,
        expectedValue: 0,
        actualValue: sa.quantity,
      });
    }
  }

  // 2. Active Reservation vs Physical Stock Overruns
  const resStockMap = new Map<string, number>();
  for (const resItem of reservations) {
    const key = `${resItem.productId}_${resItem.warehouseId}`;
    resStockMap.set(key, (resStockMap.get(key) || 0) + resItem.remainingQuantity);
  }

  for (const [key, reservedQty] of resStockMap.entries()) {
    const physical = whStockMap.get(key) || 0;
    if (reservedQty > physical) {
      const parts = key.split("_");
      const pId = parts[0] || "";
      const wId = parts[1] || "";
      const prod = productMap.get(pId);
      issues.push({
        id: `res-over-${key}`,
        category: "RESERVATION_OVERRUN",
        severity: "CRITICAL",
        productId: pId,
        productName: prod?.name || "Unknown Product",
        productSku: prod?.sku || null,
        warehouseId: wId,
        warehouseName: warehouseMap.get(wId) || "Warehouse",
        message: `Active reservations (${reservedQty}) exceed physical stock (${physical}).`,
        expectedValue: physical,
        actualValue: reservedQty,
      });
    }
  }

  // 3. Bin Allocations vs Warehouse Stock
  const binSumMap = new Map<string, number>();
  for (const loc of binAllocations) {
    const key = `${loc.productId}_${loc.warehouseId}`;
    binSumMap.set(key, (binSumMap.get(key) || 0) + loc.quantity);

    if (loc.quantity < 0) {
      const prod = productMap.get(loc.productId);
      issues.push({
        id: `neg-bin-${loc.id}`,
        category: "NEGATIVE_STOCK",
        severity: "CRITICAL",
        productId: loc.productId,
        productName: prod?.name || "Unknown Product",
        productSku: prod?.sku || null,
        warehouseId: loc.warehouseId,
        warehouseName: warehouseMap.get(loc.warehouseId) || "Warehouse",
        binId: loc.binId,
        binCode: loc.bin?.code || "BIN",
        message: `Bin '${loc.bin?.code}' has negative stock (${loc.quantity}).`,
        expectedValue: 0,
        actualValue: loc.quantity,
      });
    }

    if (loc.bin && !loc.bin.active && loc.quantity > 0) {
      const prod = productMap.get(loc.productId);
      issues.push({
        id: `inact-bin-${loc.id}`,
        category: "INACTIVE_BIN_STOCK",
        severity: "WARNING",
        productId: loc.productId,
        productName: prod?.name || "Unknown Product",
        productSku: prod?.sku || null,
        warehouseId: loc.warehouseId,
        warehouseName: warehouseMap.get(loc.warehouseId) || "Warehouse",
        binId: loc.binId,
        binCode: loc.bin.code,
        message: `Inactive bin '${loc.bin.code}' holds positive stock (${loc.quantity}).`,
        actualValue: loc.quantity,
      });
    }
  }

  for (const [key, binSum] of binSumMap.entries()) {
    const physical = whStockMap.get(key) || 0;
    if (binSum > physical) {
      const parts = key.split("_");
      const pId = parts[0] || "";
      const wId = parts[1] || "";
      const prod = productMap.get(pId);
      issues.push({
        id: `bin-over-${key}`,
        category: "BIN_OVERRUN",
        severity: "CRITICAL",
        productId: pId,
        productName: prod?.name || "Unknown Product",
        productSku: prod?.sku || null,
        warehouseId: wId,
        warehouseName: warehouseMap.get(wId) || "Warehouse",
        message: `Sum of bin stock (${binSum}) exceeds warehouse physical stock (${physical}).`,
        expectedValue: physical,
        actualValue: binSum,
      });
    }
  }

  // 4. Inventory Batches Checks
  const now = new Date();
  const batchSumMap = new Map<string, number>();

  for (const batch of batches) {
    const key = `${batch.productId}_${batch.warehouseId}`;
    batchSumMap.set(key, (batchSumMap.get(key) || 0) + batch.quantity);

    if (batch.quantity < 0) {
      const prod = productMap.get(batch.productId);
      issues.push({
        id: `neg-bat-${batch.id}`,
        category: "NEGATIVE_BATCH",
        severity: "CRITICAL",
        productId: batch.productId,
        productName: prod?.name || "Unknown Product",
        productSku: prod?.sku || null,
        warehouseId: batch.warehouseId,
        warehouseName: warehouseMap.get(batch.warehouseId) || "Warehouse",
        batchId: batch.id,
        batchNumber: batch.batchNumber,
        message: `Batch '${batch.batchNumber}' has negative quantity (${batch.quantity}).`,
        expectedValue: 0,
        actualValue: batch.quantity,
      });
    }

    if (batch.status === "ACTIVE" && batch.expiryDate && new Date(batch.expiryDate) < now) {
      const prod = productMap.get(batch.productId);
      issues.push({
        id: `exp-bat-${batch.id}`,
        category: "EXPIRED_BATCH",
        severity: "WARNING",
        productId: batch.productId,
        productName: prod?.name || "Unknown Product",
        productSku: prod?.sku || null,
        warehouseId: batch.warehouseId,
        warehouseName: warehouseMap.get(batch.warehouseId) || "Warehouse",
        batchId: batch.id,
        batchNumber: batch.batchNumber,
        message: `Batch '${batch.batchNumber}' is expired (${new Date(batch.expiryDate).toLocaleDateString()}) but marked ACTIVE.`,
      });
    }
  }

  // Summarize warehouse impact
  const whImpactMap = new Map<string, { critical: number; warning: number }>();
  for (const w of warehouses) {
    whImpactMap.set(w.id, { critical: 0, warning: 0 });
  }

  let criticalCount = 0;
  let warningCount = 0;

  for (const issue of issues) {
    if (issue.severity === "CRITICAL") criticalCount++;
    else warningCount++;

    if (issue.warehouseId && whImpactMap.has(issue.warehouseId)) {
      const imp = whImpactMap.get(issue.warehouseId)!;
      if (issue.severity === "CRITICAL") imp.critical++;
      else imp.warning++;
    }
  }

  const affectedWarehouses = warehouses
    .map((w) => {
      const imp = whImpactMap.get(w.id) || { critical: 0, warning: 0 };
      return { id: w.id, name: w.name, criticalCount: imp.critical, warningCount: imp.warning };
    })
    .filter((w) => w.criticalCount > 0 || w.warningCount > 0);

  // Deduct points for health score: -15 per critical issue, -5 per warning issue
  const rawScore = 100 - criticalCount * 15 - warningCount * 5;
  const healthScore = Math.max(0, Math.min(100, rawScore));
  const overallStatus: HealthSeverity = criticalCount > 0 ? "CRITICAL" : warningCount > 0 ? "WARNING" : "HEALTHY";

  return {
    healthScore,
    status: overallStatus,
    summary: {
      totalProductsChecked: products.length,
      totalWarehousesChecked: warehouses.length,
      totalBinsChecked: binAllocations.length,
      totalBatchesChecked: batches.length,
      criticalIssuesCount: criticalCount,
      warningIssuesCount: warningCount,
    },
    issues,
    affectedWarehouses,
    lastReconciliationTimestamp: new Date().toISOString(),
  };
}
