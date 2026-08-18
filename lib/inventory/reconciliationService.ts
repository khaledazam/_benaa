import { prisma } from "@/prisma/client";

export type ReconciliationHealthStatus = "HEALTHY" | "WARNING" | "CRITICAL";

export interface StockDiscrepancy {
  category: "PHYSICAL_STOCK" | "AVAILABLE_STOCK" | "RESERVATION" | "LEDGER_BALANCE" | "BIN_ALLOCATION" | "PICKING" | "DISPATCH";
  severity: "WARNING" | "CRITICAL";
  productId: string;
  productName?: string;
  productSku?: string | null;
  warehouseId: string;
  warehouseName?: string;
  expectedValue: number | string;
  actualValue: number | string;
  difference?: number;
  reason: string;
}

export interface InventoryReconciliationResult {
  productId: string;
  productName: string;
  productSku?: string | null;
  warehouseId: string;
  warehouseName: string;
  physicalStock: number;
  binStock: number;
  unassignedStock: number;
  reservedStock: number;
  availableStock: number;
  ledgerStock: number;
  discrepancies: StockDiscrepancy[];
  status: ReconciliationHealthStatus;
}

export interface ReconciliationOptions {
  warehouseId?: string;
  productId?: string;
  status?: ReconciliationHealthStatus;
  page?: number;
  limit?: number;
}

/**
 * Utility helper to round numbers safely to 2 decimals
 */
function roundQty(val: number): number {
  return Math.round((val + Number.EPSILON) * 100) / 100;
}

/**
 * Calculates stock balance from StockMovement ledger for a Product + Warehouse.
 * OPENING_BALANCE + PURCHASE + TRANSFER_IN + CUSTOMER_RETURN + ADJUSTMENT_IN
 * - TRANSFER_OUT - SALE - SUPPLIER_RETURN - ADJUSTMENT_OUT - DAMAGE - LOSS
 */
export function calculateLedgerStockBalance(movements: any[]): number {
  const incomingTypes = ["OPENING_BALANCE", "PURCHASE", "TRANSFER_IN", "CUSTOMER_RETURN", "ADJUSTMENT_IN"];
  const outgoingTypes = ["TRANSFER_OUT", "SALE", "SUPPLIER_RETURN", "ADJUSTMENT_OUT", "DAMAGE", "LOSS"];
  let total = 0;

  for (const m of movements) {
    const qty = Number(m.quantityInBaseUnit || m.quantity || 0);
    if (incomingTypes.includes(m.movementType)) {
      total += qty;
    } else if (outgoingTypes.includes(m.movementType)) {
      total -= qty;
    }
    // RELOCATION intra-warehouse movement has net 0 delta on overall warehouse stock
  }

  return roundQty(total);
}

/**
 * READ-ONLY Engine: Reconciles inventory for a single Product + Warehouse pair against Master Invariants A-F.
 * NEVER mutates database state.
 */
export async function reconcileProductWarehouse(productId: string, warehouseId: string): Promise<InventoryReconciliationResult> {
  const [product, warehouse, stockAlloc, binAllocations, reservations, pickLists, dispatches, movements, batches] = await Promise.all([
    prisma.product.findUnique({ where: { id: productId } }),
    prisma.warehouse.findUnique({ where: { id: warehouseId } }),
    prisma.stockAllocation.findUnique({
      where: { productId_warehouseId: { productId, warehouseId } },
    }),
    prisma.stockLocationAllocation.findMany({
      where: { productId, warehouseId },
      include: {
        bin: {
          include: {
            shelf: {
              include: {
                rack: {
                  include: {
                    zone: true,
                  },
                },
              },
            },
          },
        },
      },
    }),
    prisma.stockReservation.findMany({
      where: {
        warehouseId,
        status: { in: ["ACTIVE", "PARTIALLY_FULFILLED"] },
      },
      include: {
        items: {
          where: { productId },
        },
      },
    }),
    prisma.pickList.findMany({
      where: { warehouseId },
      include: {
        items: {
          where: { productId },
          include: { allocations: true },
        },
      },
    }),
    prisma.dispatch.findMany({
      where: { warehouseId },
      include: {
        items: {
          where: { productId },
          include: { binAllocations: true },
        },
      },
    }),
    prisma.stockMovement.findMany({
      where: { productId, warehouseId },
      orderBy: { createdAt: "asc" },
    }),
    prisma.inventoryBatch?.findMany
      ? prisma.inventoryBatch.findMany({ where: { productId, warehouseId } })
      : Promise.resolve([]),
  ]);

  const productName = product?.name || "Unknown Product";
  const productSku = product?.sku || null;
  const warehouseName = warehouse?.name || "Unknown Warehouse";

  const physicalStock = roundQty(stockAlloc ? Number(stockAlloc.quantity) : 0);
  const binStock = roundQty(binAllocations.reduce((sum, b) => sum + Number(b.quantity), 0));
  const unassignedStock = roundQty(Math.max(0, physicalStock - binStock));

  // Invariant C: Active reserved stock calculation
  let reservedStock = 0;
  for (const res of reservations) {
    for (const item of res.items) {
      reservedStock += Number(item.remainingQuantity || 0);
    }
  }
  reservedStock = roundQty(reservedStock);

  // Invariant B: Available Stock formula
  const availableStock = roundQty(physicalStock - reservedStock);

  // Movement Ledger Balance
  const ledgerStock = calculateLedgerStockBalance(movements);

  // Batch Stock Sum
  const batchStock = roundQty((batches || []).reduce((sum: number, b: any) => sum + Number(b.quantity), 0));

  const discrepancies: StockDiscrepancy[] = [];

  // BATCH STOCK CHECK: Batch Stock vs Physical Stock for Tracked Products
  if (product?.trackingMode && product.trackingMode !== "NONE" && Math.abs(batchStock - physicalStock) > 0.001) {
    discrepancies.push({
      category: "BIN_ALLOCATION",
      severity: "WARNING",
      productId,
      productName,
      productSku,
      warehouseId,
      warehouseName,
      expectedValue: physicalStock,
      actualValue: batchStock,
      difference: roundQty(batchStock - physicalStock),
      reason: `Sum of active batch stock (${batchStock}) does not equal warehouse physical stock (${physicalStock}) for batch-tracked product.`,
    });
  }

  // NEGATIVE BATCH & EXPIRED BATCH CHECKS
  const now = new Date();
  for (const batch of batches) {
    if (batch.quantity < 0) {
      discrepancies.push({
        category: "PHYSICAL_STOCK",
        severity: "CRITICAL",
        productId,
        productName,
        productSku,
        warehouseId,
        warehouseName,
        expectedValue: 0,
        actualValue: batch.quantity,
        difference: batch.quantity,
        reason: `Batch '${batch.batchNumber}' has negative stock quantity (${batch.quantity}).`,
      });
    }
    if (batch.status === "ACTIVE" && batch.expiryDate && new Date(batch.expiryDate) < now) {
      discrepancies.push({
        category: "PHYSICAL_STOCK",
        severity: "WARNING",
        productId,
        productName,
        productSku,
        warehouseId,
        warehouseName,
        expectedValue: "UNEXPIRED",
        actualValue: "EXPIRED",
        reason: `Batch '${batch.batchNumber}' has passed its expiry date (${new Date(batch.expiryDate).toLocaleDateString()}) but is still marked ACTIVE.`,
      });
    }
  }

  // INVARIANT B CHECK: Available Stock Non-Negativity
  if (availableStock < 0) {
    discrepancies.push({
      category: "AVAILABLE_STOCK",
      severity: "CRITICAL",
      productId,
      productName,
      productSku,
      warehouseId,
      warehouseName,
      expectedValue: 0,
      actualValue: availableStock,
      difference: availableStock,
      reason: `Available stock is negative (${availableStock}). Active reservations (${reservedStock}) exceed physical stock (${physicalStock}).`,
    });
  }

  // PHYSICAL STOCK NON-NEGATIVITY CHECK
  if (physicalStock < 0) {
    discrepancies.push({
      category: "PHYSICAL_STOCK",
      severity: "CRITICAL",
      productId,
      productName,
      productSku,
      warehouseId,
      warehouseName,
      expectedValue: 0,
      actualValue: physicalStock,
      difference: physicalStock,
      reason: `Warehouse physical stock is negative (${physicalStock}).`,
    });
  }

  // INVARIANT A CHECK: Bin Stock vs Physical Stock
  if (binStock > physicalStock) {
    discrepancies.push({
      category: "BIN_ALLOCATION",
      severity: "CRITICAL",
      productId,
      productName,
      productSku,
      warehouseId,
      warehouseName,
      expectedValue: physicalStock,
      actualValue: binStock,
      difference: roundQty(binStock - physicalStock),
      reason: `Sum of bin allocations (${binStock}) exceeds total warehouse physical stock (${physicalStock}).`,
    });
  }

  // INVARIANT F CHECK: Movement Ledger Balance vs Physical Stock
  if (Math.abs(ledgerStock - physicalStock) > 0.001) {
    discrepancies.push({
      category: "LEDGER_BALANCE",
      severity: "CRITICAL",
      productId,
      productName,
      productSku,
      warehouseId,
      warehouseName,
      expectedValue: physicalStock,
      actualValue: ledgerStock,
      difference: roundQty(ledgerStock - physicalStock),
      reason: `StockMovement ledger calculated stock (${ledgerStock}) does not match physical stock allocation (${physicalStock}).`,
    });
  }

  // BIN SPECIFIC INTEGRITY CHECKS
  for (const bAlloc of binAllocations) {
    const qty = Number(bAlloc.quantity);
    if (qty < 0) {
      discrepancies.push({
        category: "BIN_ALLOCATION",
        severity: "CRITICAL",
        productId,
        productName,
        productSku,
        warehouseId,
        warehouseName,
        expectedValue: 0,
        actualValue: qty,
        difference: qty,
        reason: `Bin '${bAlloc.bin?.code || bAlloc.binId}' has negative stock (${qty}).`,
      });
    }

    if (bAlloc.bin?.warehouseId !== warehouseId) {
      discrepancies.push({
        category: "BIN_ALLOCATION",
        severity: "CRITICAL",
        productId,
        productName,
        productSku,
        warehouseId,
        warehouseName,
        expectedValue: warehouseId,
        actualValue: bAlloc.bin?.warehouseId || "NONE",
        reason: `Bin '${bAlloc.bin?.code}' belongs to warehouse '${bAlloc.bin?.warehouseId}', not target warehouse '${warehouseId}'.`,
      });
    }

    if (bAlloc.bin && !bAlloc.bin.active && qty > 0) {
      discrepancies.push({
        category: "BIN_ALLOCATION",
        severity: "CRITICAL",
        productId,
        productName,
        productSku,
        warehouseId,
        warehouseName,
        expectedValue: 0,
        actualValue: qty,
        reason: `Inactive bin '${bAlloc.bin.code}' contains active stock quantity (${qty}).`,
      });
    }
  }

  // RESERVATION MATHEMATICAL INTEGRITY CHECK
  for (const res of reservations) {
    for (const item of res.items) {
      const req = Number(item.requestedQuantity || 0);
      const resv = Number(item.reservedQuantity || 0);
      const rel = Number(item.releasedQuantity || 0);
      const rem = Number(item.remainingQuantity || 0);

      if (rem < 0 || rel < 0) {
        discrepancies.push({
          category: "RESERVATION",
          severity: "CRITICAL",
          productId,
          productName,
          productSku,
          warehouseId,
          warehouseName,
          expectedValue: 0,
          actualValue: `rem: ${rem}, rel: ${rel}`,
          reason: `Reservation '${res.reservationNumber}' has negative remaining (${rem}) or released (${rel}) quantity.`,
        });
      }

      const expectedRem = roundQty(Math.max(0, resv - rel));
      if (Math.abs(rem - expectedRem) > 0.001) {
        discrepancies.push({
          category: "RESERVATION",
          severity: "WARNING",
          productId,
          productName,
          productSku,
          warehouseId,
          warehouseName,
          expectedValue: expectedRem,
          actualValue: rem,
          difference: roundQty(rem - expectedRem),
          reason: `Reservation '${res.reservationNumber}' remaining quantity (${rem}) does not equal reserved - released (${expectedRem}).`,
        });
      }
    }
  }

  // PICKING INTEGRITY CHECK
  for (const pl of pickLists) {
    for (const pli of pl.items) {
      const pickedSum = roundQty((pli.allocations || []).reduce((sum, a) => sum + Number(a.pickedQuantity || 0), 0));
      if (Math.abs(pickedSum - Number(pli.pickedQuantity || 0)) > 0.001) {
        discrepancies.push({
          category: "PICKING",
          severity: "WARNING",
          productId,
          productName,
          productSku,
          warehouseId,
          warehouseName,
          expectedValue: pli.pickedQuantity,
          actualValue: pickedSum,
          reason: `PickList '${pl.pickListNumber}' sum of bin allocations (${pickedSum}) does not equal item pickedQuantity (${pli.pickedQuantity}).`,
        });
      }
    }
  }

  // DISPATCH & LEDGER SALE MOVEMENT CHECK
  for (const disp of dispatches) {
    if (disp.status === "POSTED") {
      for (const item of disp.items) {
        if (item.dispatchedQuantity > 0) {
          const correspondingMovements = movements.filter(
            (m) => m.referenceType === "DISPATCH" && m.referenceId === disp.id && m.movementType === "SALE"
          );

          if (correspondingMovements.length === 0) {
            discrepancies.push({
              category: "DISPATCH",
              severity: "CRITICAL",
              productId,
              productName,
              productSku,
              warehouseId,
              warehouseName,
              expectedValue: ">=1 SALE StockMovement",
              actualValue: "0 movements",
              reason: `POSTED Dispatch '${disp.dispatchNumber}' has no corresponding SALE StockMovement entries in ledger.`,
            });
          }
        }
      }
    }
  }

  // HEALTH STATUS COMPUTATION
  let status: ReconciliationHealthStatus = "HEALTHY";
  if (discrepancies.some((d) => d.severity === "CRITICAL")) {
    status = "CRITICAL";
  } else if (discrepancies.length > 0) {
    status = "WARNING";
  }

  return {
    productId,
    productName,
    productSku,
    warehouseId,
    warehouseName,
    physicalStock,
    binStock,
    unassignedStock,
    reservedStock,
    availableStock,
    ledgerStock,
    discrepancies,
    status,
  };
}

/**
 * Runs full read-only inventory reconciliation across all Product + Warehouse records or filtered subsets.
 */
export async function runFullInventoryReconciliation(options: ReconciliationOptions = {}) {
  const page = Math.max(1, options.page || 1);
  const limit = Math.min(100, Math.max(1, options.limit || 50));

  const whereAlloc: any = {};
  if (options.warehouseId) whereAlloc.warehouseId = options.warehouseId;
  if (options.productId) whereAlloc.productId = options.productId;

  const stockAllocations = await prisma.stockAllocation.findMany({
    where: whereAlloc,
    select: { productId: true, warehouseId: true },
  });

  const results: InventoryReconciliationResult[] = [];

  for (const alloc of stockAllocations) {
    const res = await reconcileProductWarehouse(alloc.productId, alloc.warehouseId);
    if (!options.status || res.status === options.status) {
      results.push(res);
    }
  }

  const healthyCount = results.filter((r) => r.status === "HEALTHY").length;
  const warningCount = results.filter((r) => r.status === "WARNING").length;
  const criticalCount = results.filter((r) => r.status === "CRITICAL").length;

  const totalDiscrepancies = results.reduce((sum, r) => sum + r.discrepancies.length, 0);

  const paginatedResults = results.slice((page - 1) * limit, page * limit);

  return {
    summary: {
      totalEvaluated: results.length,
      healthyCount,
      warningCount,
      criticalCount,
      totalDiscrepancies,
      overallHealth: criticalCount > 0 ? "CRITICAL" : warningCount > 0 ? "WARNING" : "HEALTHY",
    },
    results: paginatedResults,
    pagination: {
      page,
      limit,
      total: results.length,
      totalPages: Math.ceil(results.length / limit),
    },
  };
}
