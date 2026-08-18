import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock Fixtures
const mockUser = { id: "user-admin", name: "Admin", username: "admin", role: "SUPER_ADMIN" };
const mockWarehouse = { id: "wh-main", name: "Main Warehouse", code: "WH-MAIN" };
const mockSupplier = { id: "sup-1", name: "BuildCorp Supplies" };
const mockCustomer = { id: "cust-1", name: "Al-Benaa Construction LLC" };
const mockBin = { id: "bin-a1", code: "A1-01", warehouseId: "wh-main", active: true, locationPath: "Zone A / A1-01" };

const mockProductTiles = {
  id: "prod-tiles-60",
  name: "Porcelain Tiles 60x60",
  sku: "TILE-PORC-60",
  price: 50.0,
  unitId: "unit-m2",
  quantity: 0,
  minimumStock: 10,
  maximumStock: 1000,
};

let dbStockAllocations: any[] = [];
let dbStockLocationAllocations: any[] = [];
let dbStockMovements: any[] = [];
let dbAdjustments: any[] = [];
let dbAdjustmentItems: any[] = [];
let dbCounts: any[] = [];
let dbCountItems: any[] = [];
let dbProducts: any[] = [];

vi.mock("@/prisma/client", () => {
  const mockTx = {
    user: {
      findUnique: vi.fn(async () => mockUser),
    },
    warehouse: {
      findUnique: vi.fn(async () => mockWarehouse),
    },
    warehouseBin: {
      findUnique: vi.fn(async () => mockBin),
    },
    product: {
      findUnique: vi.fn(async ({ where }: any) => dbProducts.find((p) => p.id === where.id) || null),
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
          sa = { id: "sa-1", ...create };
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
      findMany: vi.fn(async () => dbStockLocationAllocations.map((sla) => ({ ...sla, product: mockProductTiles, bin: mockBin }))),
      findUnique: vi.fn(async ({ where }: any) => dbStockLocationAllocations.find((a) => a.productId === where.productId_binId?.productId) || null),
      upsert: vi.fn(async ({ where, create, update }: any) => {
        let sla = dbStockLocationAllocations.find((a) => a.productId === where.productId_binId.productId);
        if (sla) Object.assign(sla, update);
        else {
          sla = { id: "sla-1", ...create };
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
      findMany: vi.fn(async () => dbStockMovements),
    },
    stockAdjustment: {
      findFirst: vi.fn(async () => dbAdjustments[0] || null),
      findUnique: vi.fn(async ({ where }: any) => {
        const adj = dbAdjustments.find((a) => a.id === where.id);
        if (!adj) return null;
        return {
          ...adj,
          warehouse: mockWarehouse,
          items: dbAdjustmentItems.filter((i) => i.adjustmentId === adj.id).map((i) => ({ ...i, product: mockProductTiles, bin: mockBin })),
        };
      }),
      create: vi.fn(async ({ data }: any) => {
        const adj = { id: `adj-${dbAdjustments.length + 1}`, ...data, createdAt: new Date() };
        delete adj.items;
        dbAdjustments.push(adj);
        if (data.items?.create) {
          for (const item of data.items.create) {
            dbAdjustmentItems.push({ id: `adji-${dbAdjustmentItems.length + 1}`, adjustmentId: adj.id, ...item });
          }
        }
        return mockTx.stockAdjustment.findUnique({ where: { id: adj.id } });
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const adj = dbAdjustments.find((a) => a.id === where.id);
        if (adj) Object.assign(adj, data);
        return mockTx.stockAdjustment.findUnique({ where: { id: where.id } });
      }),
    },
    inventoryCount: {
      findFirst: vi.fn(async () => dbCounts[0] || null),
      findUnique: vi.fn(async ({ where }: any) => {
        const cnt = dbCounts.find((c) => c.id === where.id);
        if (!cnt) return null;
        return {
          ...cnt,
          warehouse: mockWarehouse,
          items: dbCountItems.filter((i) => i.countId === cnt.id).map((i) => ({ ...i, product: mockProductTiles, bin: mockBin })),
        };
      }),
      create: vi.fn(async ({ data }: any) => {
        const cnt = { id: `cnt-${dbCounts.length + 1}`, ...data, createdAt: new Date() };
        delete cnt.items;
        dbCounts.push(cnt);
        return mockTx.inventoryCount.findUnique({ where: { id: cnt.id } });
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const cnt = dbCounts.find((c) => c.id === where.id);
        if (cnt) Object.assign(cnt, data);
        if (data.items?.create) {
          for (const item of data.items.create) {
            dbCountItems.push({ id: `cnti-${dbCountItems.length + 1}`, countId: where.id, ...item });
          }
        }
        return mockTx.inventoryCount.findUnique({ where: { id: where.id } });
      }),
    },
    inventoryCountItem: {
      update: vi.fn(async ({ where, data }: any) => {
        const ci = dbCountItems.find((i) => i.id === where.id);
        if (ci) Object.assign(ci, data);
        return ci;
      }),
    },
    auditLog: {
      create: vi.fn(async () => ({ id: "log-1" })),
    },
  };

  return {
    prisma: {
      ...mockTx,
      $transaction: vi.fn(async (cb: any) => cb(mockTx)),
    },
  };
});

import { executeStockMutation, StockMovementTypes } from "@/lib/inventory/stockService";
import { createInventoryCount, startInventoryCount, recordCountItems, submitInventoryCount, approveInventoryCount, postInventoryCount } from "@/lib/inventory/countingService";

describe("Phase 6.5 — Full End-to-End Warehouse Lifecycle Verification", () => {
  beforeEach(() => {
    dbStockAllocations = [];
    dbStockLocationAllocations = [];
    dbStockMovements = [];
    dbAdjustments = [];
    dbAdjustmentItems = [];
    dbCounts = [];
    dbCountItems = [];
    dbProducts = [JSON.parse(JSON.stringify(mockProductTiles))];
  });

  it("Executes full lifecycle: Receipt -> Dispatch -> Cycle Count -> Adjustment -> Post", async () => {
    // 1. GOODS RECEIPT (POST) -> Physical stock +500
    await executeStockMutation({
      productId: mockProductTiles.id,
      warehouseId: mockWarehouse.id,
      binId: mockBin.id,
      quantity: 500,
      movementType: StockMovementTypes.PURCHASE,
      performedBy: mockUser.id,
    });
    expect(dbStockAllocations[0].quantity).toBe(500);

    // 2. DISPATCH (POST) -> Physical stock -200 (Remaining = 300)
    await executeStockMutation({
      productId: mockProductTiles.id,
      warehouseId: mockWarehouse.id,
      binId: mockBin.id,
      quantity: 200,
      movementType: StockMovementTypes.SALE,
      performedBy: mockUser.id,
    });
    expect(dbStockAllocations[0].quantity).toBe(300);

    // 3. CYCLE COUNT -> Counted 310 (Variance = +10)
    const count = await createInventoryCount({ warehouseId: mockWarehouse.id, scopeType: "BIN", scopeId: mockBin.id }, mockUser.id);
    await startInventoryCount(count.id, mockUser.id);
    await recordCountItems(count.id, { items: [{ productId: mockProductTiles.id, binId: mockBin.id, countedQuantity: 310 }] }, mockUser.id);
    await submitInventoryCount(count.id, mockUser.id);
    await approveInventoryCount(count.id, mockUser.id);

    // Prior to posting count, physical stock is still 300
    expect(dbStockAllocations[0].quantity).toBe(300);

    // 4. POST COUNT -> Generates adjustment & posts +10 stock
    await postInventoryCount(count.id, mockUser.id);

    // Reconciled Physical Stock = 310
    expect(dbStockAllocations[0].quantity).toBe(310);
    expect(dbStockLocationAllocations[0].quantity).toBe(310);

    // Verify StockMovements ledger math
    expect(dbStockMovements.length).toBe(3); // PURCHASE (+500), SALE (-200), ADJUSTMENT_IN (+10)
    const purchaseMov = dbStockMovements.find((m) => m.movementType === StockMovementTypes.PURCHASE);
    const saleMov = dbStockMovements.find((m) => m.movementType === StockMovementTypes.SALE);
    const adjMov = dbStockMovements.find((m) => m.movementType === "FOUND" || m.movementType === StockMovementTypes.ADJUSTMENT_IN);

    expect(purchaseMov.quantity).toBe(500);
    expect(saleMov.quantity).toBe(200);
    expect(adjMov.quantity).toBe(10);
  });
});
