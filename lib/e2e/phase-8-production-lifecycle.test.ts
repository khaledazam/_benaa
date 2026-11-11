import { describe, it, expect, beforeEach, vi } from "vitest";

const mockUser = { id: "user-mgr", name: "Warehouse Manager", username: "mgr", role: "WAREHOUSE_MANAGER" };
const mockWarehouse = { id: "wh-main", name: "Central Construction Yard", code: "WH-MAIN" };
const mockBin = { id: "bin-a1", code: "BIN-A1", warehouseId: "wh-main", active: true, locationPath: "Zone A / A1" };

const mockProductTile = {
  id: "prod-tile-porcelain",
  name: "Spanish Porcelain Floor Tile 60x60",
  sku: "TILE-SP-60",
  barcode: "8410000998877",
  trackingMode: "BATCH",
  price: 45.0,
  unitId: "unit-sqm",
  quantity: 0,
  expirationDate: null,
};

let dbStockAllocations: any[] = [];
let dbStockLocationAllocations: any[] = [];
let dbStockMovements: any[] = [];
let dbBatches: any[] = [];
let dbProducts: any[] = [];
let dbReservations: any[] = [];
let dbPickLists: any[] = [];
let dbDispatches: any[] = [];
let dbCounts: any[] = [];

vi.mock("@/prisma/client", () => {
  const mockTx = {
    // Explicit fixture tables for the authoritative availability/unit contract.
    unit: { findUnique: vi.fn(async ({ where }: any) => [{ id: "unit-sqm", active: true, type: "area" }].find(u => u.id === where.id) || null) },
    projectMaterialIssueItem: { findMany: vi.fn(async () => []) },

    user: { findUnique: vi.fn(async () => mockUser) },
    warehouse: {
      findUnique: vi.fn(async () => mockWarehouse),
      findMany: vi.fn(async () => [mockWarehouse]),
    },
    warehouseBin: { findUnique: vi.fn(async () => mockBin) },
    product: {
      findMany: vi.fn(async () => dbProducts),
      findUnique: vi.fn(async ({ where }: any) => dbProducts.find((p) => p.id === where.id) || null),
      findFirst: vi.fn(async ({ where }: any) => {
        return dbProducts.find((p) => p.barcode === where.OR?.[0]?.barcode || p.sku === where.OR?.[1]?.sku) || null;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const p = dbProducts.find((prod) => prod.id === where.id);
        if (p) Object.assign(p, data);
        return p;
      }),
    },
    stockAllocation: {
      findMany: vi.fn(async () => dbStockAllocations),
      findUnique: vi.fn(async ({ where }: any) => dbStockAllocations.find((a) => a.productId === where.productId_warehouseId?.productId) || null),
      upsert: vi.fn(async ({ where, create, update }: any) => {
        let sa = dbStockAllocations.find((a) => a.productId === where.productId_warehouseId.productId);
        if (sa) Object.assign(sa, update);
        else {
          sa = { id: "sa-1", reservedQuantity: 0, ...create };
          dbStockAllocations.push(sa);
        }
        return sa;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const sa = dbStockAllocations.find((a) => a.productId === where.productId_warehouseId?.productId);
        if (sa) Object.assign(sa, data);
        return sa;
      }),
    },
    stockLocationAllocation: {
      count: vi.fn(async ({ where }: any) => dbStockLocationAllocations.filter(a =>
        (!where.productId || a.productId === where.productId) && (!where.warehouseId || a.warehouseId === where.warehouseId)).length),
      findMany: vi.fn(async () => dbStockLocationAllocations.map((sla) => ({ ...sla, product: mockProductTile, bin: mockBin }))),
      findUnique: vi.fn(async ({ where }: any) => dbStockLocationAllocations.find((a) => a.productId === where.productId_binId?.productId) || null),
      upsert: vi.fn(async ({ where, create, update }: any) => {
        let sla = dbStockLocationAllocations.find((a) => a.productId === where.productId_binId.productId);
        if (sla) Object.assign(sla, update);
        else {
          sla = { id: "sla-1", reservedQuantity: 0, ...create };
          dbStockLocationAllocations.push(sla);
        }
        return sla;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const sla = dbStockLocationAllocations.find((a) => a.productId === where.productId_binId?.productId);
        if (sla) Object.assign(sla, data);
        return sla;
      }),
    },
    stockMovement: {
      create: vi.fn(async ({ data }: any) => {
        const sm = { id: `sm-${dbStockMovements.length + 1}`, createdAt: new Date(), ...data };
        dbStockMovements.push(sm);
        return sm;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const sm = dbStockMovements.find((m) => m.id === where.id);
        if (sm) Object.assign(sm, data);
        return sm;
      }),
      findMany: vi.fn(async () => dbStockMovements),
    },
    inventoryBatch: {
      findFirst: vi.fn(async () => dbBatches[0] || null),
      findUnique: vi.fn(async ({ where }: any) => {
        if (where.id) return dbBatches.find((b) => b.id === where.id) || null;
        if (where.batchNumber_productId_warehouseId) {
          const { batchNumber, productId, warehouseId } = where.batchNumber_productId_warehouseId;
          return dbBatches.find((b) => b.batchNumber === batchNumber && b.productId === productId && b.warehouseId === warehouseId) || null;
        }
        return null;
      }),
      findMany: vi.fn(async () => dbBatches),
      create: vi.fn(async ({ data }: any) => {
        const b = { id: `bat-${dbBatches.length + 1}`, createdAt: new Date(), ...data };
        dbBatches.push(b);
        return b;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const b = dbBatches.find((batch) => batch.id === where.id);
        if (b) {
          if (data.quantity?.increment) b.quantity += data.quantity.increment;
          else if (typeof data.quantity === "number") b.quantity = data.quantity;
          if (data.reservedQuantity?.increment) b.reservedQuantity += data.reservedQuantity.increment;
          else if (typeof data.reservedQuantity === "number") b.reservedQuantity = data.reservedQuantity;
          if (data.status) b.status = data.status;
        }
        return b;
      }),
    },
    stockReservationItem: {
      findMany: vi.fn(async () => []),
      update: vi.fn(async () => ({})),
    },
    stockReservation: {
      findMany: vi.fn(async () => dbReservations),
      findUnique: vi.fn(async () => dbReservations[0] || null),
      create: vi.fn(async ({ data }: any) => {
        const res = { id: `res-${dbReservations.length + 1}`, ...data };
        dbReservations.push(res);
        return res;
      }),
    },
    inventoryCount: {
      create: vi.fn(async ({ data }: any) => {
        const cnt = { id: `cnt-${dbCounts.length + 1}`, ...data };
        dbCounts.push(cnt);
        return cnt;
      }),
      findUnique: vi.fn(async ({ where }: any) => dbCounts.find((c) => c.id === where.id) || null),
    },
    auditLog: { create: vi.fn(async () => ({ id: "log-1" })) },
  };

  return {
    prisma: {
      ...mockTx,
      $transaction: vi.fn(async (cb: any) => cb(mockTx)),
    },
  };
});

import { prisma } from "@/prisma/client";
import { lookupProductByBarcode } from "@/lib/inventory/barcodeService";
import { createOrUpdateBatchOnReceiptInTx, deductBatchQuantityInTx, reserveBatchQuantityInTx, releaseBatchReservationInTx } from "@/lib/inventory/batchService";
import { executeStockMutation, executeStockMutationInTx, BATCH_MANAGED_IN_TX, StockMovementTypes } from "@/lib/inventory/stockService";
import { getInventoryHealthReport } from "@/lib/inventory/healthService";

describe("Phase 8 â€” Production WMS End-to-End Lifecycle Suite", () => {
  beforeEach(() => {
    dbStockAllocations = [];
    dbStockLocationAllocations = [];
    dbStockMovements = [];
    dbBatches = [];
    dbReservations = [];
    dbPickLists = [];
    dbDispatches = [];
    dbCounts = [];
    dbProducts = [JSON.parse(JSON.stringify(mockProductTile))];
  });

  it("Executes full Phase 8 lifecycle: Barcode -> GRN Receipt -> Batch -> Reservation Sync -> Dispatch -> Health Report", async () => {
    // 1. BARCODE LOOKUP
    const barcodeResult = await lookupProductByBarcode("8410000998877");
    expect(barcodeResult?.product.id).toBe(mockProductTile.id);
    expect(barcodeResult?.exactMatchField).toBe("barcode");

    // 2. GOODS RECEIPT POST (Physical stock +500, Batch created)
    const batch = await prisma.$transaction(async (tx: any) => {
    const received = await createOrUpdateBatchOnReceiptInTx(tx, {
      productId: mockProductTile.id,
      warehouseId: mockWarehouse.id,
      batchNumber: "BAT-SP-2026-01",
      quantity: 500,
      expiryDate: new Date("2028-01-01"),
    });
    await executeStockMutationInTx(tx, {
      batchId: received.id, batchAccounting: BATCH_MANAGED_IN_TX,
      productId: mockProductTile.id,
      warehouseId: mockWarehouse.id,
      binId: mockBin.id,
      quantity: 500,
      movementType: StockMovementTypes.PURCHASE,
      performedBy: mockUser.id,
    });
      return received;
    });

    expect(dbStockAllocations[0].quantity).toBe(500);
    expect(batch.quantity).toBe(500);
    expect(batch.reservedQuantity).toBe(0);

    // 3. BATCH RESERVATION (Reserve 100 on batch)
    await reserveBatchQuantityInTx(prisma as any, batch.id, 100);
    expect(batch.reservedQuantity).toBe(100);

    // 4. DISPATCH DEDUCTION (Deduct 100 on dispatch POST)
    await prisma.$transaction(async (tx: any) => {
      await releaseBatchReservationInTx(tx, batch.id, 100);
    await executeStockMutationInTx(tx, {
      batchId: batch.id,
      productId: mockProductTile.id,
      warehouseId: mockWarehouse.id,
      binId: mockBin.id,
      quantity: 100,
      movementType: StockMovementTypes.SALE,
      performedBy: mockUser.id,
    });
    });

    expect(dbStockAllocations[0].quantity).toBe(400);
    expect(batch.quantity).toBe(400);
    expect(batch.reservedQuantity).toBe(0);

    // 5. INVENTORY HEALTH REPORT
    const health = await getInventoryHealthReport(mockWarehouse.id);
    expect(health.healthScore).toBe(100);
    expect(health.status).toBe("HEALTHY");
    expect(health.issues.length).toBe(0);
  });
});
