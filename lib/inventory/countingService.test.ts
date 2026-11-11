import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock Fixtures
const mockWarehouseA = { id: "wh-a", name: "Warehouse Alpha", code: "WH-A" };
const mockUser = { id: "user-mgr-1", name: "Manager User", username: "mgr", role: "SUPER_ADMIN", status: true, warehouseIds: ["wh-a", "wh-b"] };

const mockProductTiles = {
  id: "prod-tiles",
  name: "Ceramic Tiles",
  sku: "TILE-CERAMIC-60",
  price: 45.0,
  unitId: "unit-m2",
  quantity: 0,
  minimumStock: 10,
  maximumStock: 5000,
};

const dbBins = [
  { id: "bin-a", code: "BIN-A", warehouseId: "wh-a", active: true, locationPath: "Zone A / Bin A" },
];

let dbStockAllocations: any[] = [];
let dbStockLocationAllocations: any[] = [];
let dbStockMovements: any[] = [];
let dbAdjustments: any[] = [];
let dbAdjustmentItems: any[] = [];
let dbCounts: any[] = [];
let dbCountItems: any[] = [];
let dbAuditLogs: any[] = [];
let dbProducts: any[] = [];

vi.mock("@/prisma/client", () => {
  const mockTx = {
    // Explicit fixture tables for the authoritative availability/unit contract.
    unit: { findUnique: vi.fn(async ({ where }: any) => [{ id: "unit-m2", active: true, type: "area" }].find(u => u.id === where.id) || null) },
    projectMaterialIssueItem: { findMany: vi.fn(async () => []) },
    stockReservationItem: { findMany: vi.fn(async () => []) },

    user: {
      update: vi.fn(async ({ data }: any) => Object.assign(mockUser, data)),
      findUnique: vi.fn(async ({ where }: any) => (where.id === mockUser.id ? mockUser : null)),
    },
    product: {
      findUnique: vi.fn(async ({ where }: any) => dbProducts.find((p) => p.id === where.id) || null),
      update: vi.fn(async ({ where, data }: any) => {
        const prod = dbProducts.find((p) => p.id === where.id);
        if (prod) Object.assign(prod, data);
        return prod;
      }),
    },
    warehouse: {
      findUnique: vi.fn(async ({ where }: any) => (where.id === mockWarehouseA.id ? mockWarehouseA : null)),
    },
    warehouseBin: {
      findUnique: vi.fn(async ({ where }: any) => dbBins.find((b) => b.id === where.id) || null),
    },
    warehouseZone: {
      findUnique: vi.fn(async () => null),
    },
    category: {
      findUnique: vi.fn(async () => null),
    },
    stockAllocation: {
      findMany: vi.fn(async ({ where }: any) => {
        return dbStockAllocations.filter((a) => {
          const matchProd = !where?.productId || a.productId === where.productId;
          const matchWh = !where?.warehouseId || a.warehouseId === where.warehouseId;
          return matchProd && matchWh;
        });
      }),
      findUnique: vi.fn(async ({ where }: any) => {
        return dbStockAllocations.find((a) => a.productId === where.productId_warehouseId?.productId && a.warehouseId === where.productId_warehouseId?.warehouseId) || null;
      }),
      upsert: vi.fn(async ({ where, create, update }: any) => {
        let existing = dbStockAllocations.find((a) => a.productId === where.productId_warehouseId.productId && a.warehouseId === where.productId_warehouseId.warehouseId);
        if (existing) {
          Object.assign(existing, update);
        } else {
          existing = { id: `sa-${dbStockAllocations.length + 1}`, reservedQuantity: 0, ...create };
          dbStockAllocations.push(existing);
        }
        return existing;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const sa = dbStockAllocations.find((a) => a.productId === where.productId_warehouseId?.productId && a.warehouseId === where.productId_warehouseId?.warehouseId);
        if (sa) Object.assign(sa, data);
        return sa;
      }),
    },
    stockLocationAllocation: {
      count: vi.fn(async ({ where }: any) => dbStockLocationAllocations.filter(a =>
        (!where.productId || a.productId === where.productId) && (!where.warehouseId || a.warehouseId === where.warehouseId)).length),
      findMany: vi.fn(async ({ where }: any) => {
        return dbStockLocationAllocations.filter((a) => {
          const matchProd = !where?.productId || a.productId === where.productId;
          const matchWh = !where?.warehouseId || a.warehouseId === where.warehouseId;
          const matchBin = !where?.binId || a.binId === where.binId;
          return matchProd && matchWh && matchBin;
        }).map((a) => ({
          ...a,
          product: dbProducts.find((p) => p.id === a.productId) || mockProductTiles,
          bin: dbBins.find((b) => b.id === a.binId),
        }));
      }),
      findUnique: vi.fn(async ({ where }: any) => {
        return dbStockLocationAllocations.find((a) => a.productId === where.productId_binId?.productId && a.binId === where.productId_binId?.binId) || null;
      }),
      upsert: vi.fn(async ({ where, create, update }: any) => {
        let existing = dbStockLocationAllocations.find((a) => a.productId === where.productId_binId.productId && a.binId === where.productId_binId.binId);
        if (existing) {
          Object.assign(existing, update);
        } else {
          existing = { id: `sla-${dbStockLocationAllocations.length + 1}`, reservedQuantity: 0, ...create };
          dbStockLocationAllocations.push(existing);
        }
        return existing;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const sla = dbStockLocationAllocations.find((a) => a.productId === where.productId_binId?.productId && a.binId === where.productId_binId?.binId);
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
      findMany: vi.fn(async ({ where }: any) => dbStockMovements),
    },
    stockAdjustment: {
      findFirst: vi.fn(async ({ where }: any) => {
        return dbAdjustments.find((a) => !where?.adjustmentNumber?.startsWith || a.adjustmentNumber.startsWith(where.adjustmentNumber.startsWith)) || null;
      }),
      findUnique: vi.fn(async ({ where }: any) => {
        const adj = dbAdjustments.find((a) => a.id === where.id);
        if (!adj) return null;
        return {
          ...adj,
          warehouse: mockWarehouseA,
          items: dbAdjustmentItems.filter((i) => i.adjustmentId === adj.id).map((i) => ({
            ...i,
            product: dbProducts.find((p) => p.id === i.productId) || mockProductTiles,
            bin: dbBins.find((b) => b.id === i.binId),
          })),
        };
      }),
      findMany: vi.fn(async ({ where }: any) => dbAdjustments),
      count: vi.fn(async ({ where }: any) => dbAdjustments.length),
      create: vi.fn(async ({ data }: any) => {
        const newAdj = { id: `adj-${dbAdjustments.length + 1}`, ...data, createdAt: new Date() };
        delete newAdj.items;
        dbAdjustments.push(newAdj);
        if (data.items?.create) {
          for (const itemData of data.items.create) {
            dbAdjustmentItems.push({ id: `adji-${dbAdjustmentItems.length + 1}`, adjustmentId: newAdj.id, ...itemData });
          }
        }
        return mockTx.stockAdjustment.findUnique({ where: { id: newAdj.id } });
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const adj = dbAdjustments.find((a) => a.id === where.id);
        if (adj) Object.assign(adj, data);
        return mockTx.stockAdjustment.findUnique({ where: { id: where.id } });
      }),
    },
    inventoryCount: {
      findFirst: vi.fn(async ({ where }: any) => {
        return dbCounts.find((c) => !where?.countNumber?.startsWith || c.countNumber.startsWith(where.countNumber.startsWith)) || null;
      }),
      findUnique: vi.fn(async ({ where }: any) => {
        const cnt = dbCounts.find((c) => c.id === where.id);
        if (!cnt) return null;
        return {
          ...cnt,
          warehouse: mockWarehouseA,
          items: dbCountItems.filter((i) => i.countId === cnt.id).map((i) => ({
            ...i,
            product: dbProducts.find((p) => p.id === i.productId) || mockProductTiles,
            bin: dbBins.find((b) => b.id === i.binId),
          })),
        };
      }),
      findMany: vi.fn(async ({ where }: any) => dbCounts),
      count: vi.fn(async ({ where }: any) => dbCounts.length),
      create: vi.fn(async ({ data }: any) => {
        const newCount = { id: `cnt-${dbCounts.length + 1}`, ...data, createdAt: new Date() };
        delete newCount.items;
        dbCounts.push(newCount);
        return mockTx.inventoryCount.findUnique({ where: { id: newCount.id } });
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const cnt = dbCounts.find((c) => c.id === where.id);
        if (cnt) Object.assign(cnt, data);
        if (data.items?.create) {
          for (const itemData of data.items.create) {
            dbCountItems.push({ id: `cnti-${dbCountItems.length + 1}`, countId: where.id, ...itemData });
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
      create: vi.fn(async ({ data }: any) => {
        const log = { id: `log-${dbAuditLogs.length + 1}`, ...data };
        dbAuditLogs.push(log);
        return log;
      }),
    },
  };

  return {
    prisma: {
      ...mockTx,
      $transaction: vi.fn(async (cb: any) => {
        const snapshot = {
          actor: structuredClone(mockUser),
          dbStockAllocations: structuredClone(dbStockAllocations),
          dbStockLocationAllocations: structuredClone(dbStockLocationAllocations),
          dbStockMovements: structuredClone(dbStockMovements),
          dbAdjustments: structuredClone(dbAdjustments),
          dbAdjustmentItems: structuredClone(dbAdjustmentItems),
          dbCounts: structuredClone(dbCounts),
          dbCountItems: structuredClone(dbCountItems),
          dbAuditLogs: structuredClone(dbAuditLogs),
          dbProducts: structuredClone(dbProducts),
        };
        try {
          return await cb(mockTx);
        } catch (err) {
          for (const key of Object.keys(mockUser)) if (!(key in snapshot.actor)) delete (mockUser as any)[key];
          Object.assign(mockUser, snapshot.actor);
          dbStockAllocations = snapshot.dbStockAllocations;
          dbStockLocationAllocations = snapshot.dbStockLocationAllocations;
          dbStockMovements = snapshot.dbStockMovements;
          dbAdjustments = snapshot.dbAdjustments;
          dbAdjustmentItems = snapshot.dbAdjustmentItems;
          dbCounts = snapshot.dbCounts;
          dbCountItems = snapshot.dbCountItems;
          dbAuditLogs = snapshot.dbAuditLogs;
          dbProducts = snapshot.dbProducts;
          throw err;
        }
      }),
    },
  };
});

import {
  createInventoryCount,
  startInventoryCount,
  recordCountItems,
  submitInventoryCount,
  approveInventoryCount,
  postInventoryCount,
} from "@/lib/inventory/countingService";
import { executeStockMutation, StockMovementTypes } from "@/lib/inventory/stockService";

describe("Phase 6 — Inventory Counting Engine & Full E2E Lifecycle", () => {
  const userId = mockUser.id;

  beforeEach(() => {
    dbStockAllocations = [];
    dbStockLocationAllocations = [];
    dbStockMovements = [];
    dbAdjustments = [];
    dbAdjustmentItems = [];
    dbCounts = [];
    dbCountItems = [];
    dbAuditLogs = [];
    dbProducts = [JSON.parse(JSON.stringify(mockProductTiles))];
  });

  it("SCENARIO 12 — Inventory count creation -> stock unchanged", async () => {
    await executeStockMutation({
      productId: mockProductTiles.id,
      warehouseId: mockWarehouseA.id,
      binId: "bin-a",
      quantity: 100,
      movementType: StockMovementTypes.PURCHASE,
      performedBy: userId,
    });

    const count = await createInventoryCount({ warehouseId: mockWarehouseA.id, scopeType: "BIN", scopeId: "bin-a" }, userId);
    expect(count.status).toBe("DRAFT");
    expect(dbStockAllocations[0].quantity).toBe(100);
    expect(dbStockMovements.length).toBe(1);
  });

  it("SCENARIO 13 — Inventory count start & variance calculation", async () => {
    await executeStockMutation({ productId: mockProductTiles.id, warehouseId: mockWarehouseA.id, binId: "bin-a", quantity: 100, movementType: StockMovementTypes.PURCHASE, performedBy: userId });

    const count = await createInventoryCount({ warehouseId: mockWarehouseA.id, scopeType: "BIN", scopeId: "bin-a" }, userId);
    const started = await startInventoryCount(count.id, userId);

    expect(started?.status).toBe("IN_PROGRESS");
    expect(started?.items?.[0]?.systemQuantity).toBe(100);

    const recorded = await recordCountItems(count.id, { items: [{ productId: mockProductTiles.id, binId: "bin-a", countedQuantity: 95 }] }, userId);
    expect(recorded?.items?.[0]?.countedQuantity).toBe(95);
    expect(recorded?.items?.[0]?.varianceQuantity).toBe(-5);
    expect(recorded?.items?.[0]?.variancePercentage).toBe(-5);
  });

  it("SCENARIO 14 & 15 — Count approval & posting -> controlled stock adjustment", async () => {
    await executeStockMutation({ productId: mockProductTiles.id, warehouseId: mockWarehouseA.id, binId: "bin-a", quantity: 100, movementType: StockMovementTypes.PURCHASE, performedBy: userId });

    const count = await createInventoryCount({ warehouseId: mockWarehouseA.id, scopeType: "BIN", scopeId: "bin-a" }, userId);
    await startInventoryCount(count.id, userId);
    await recordCountItems(count.id, { items: [{ productId: mockProductTiles.id, binId: "bin-a", countedQuantity: 90 }] }, userId);

    const submitted = await submitInventoryCount(count.id, userId);
    expect(submitted?.status).toBe("SUBMITTED");

    const approved = await approveInventoryCount(count.id, userId);
    expect(approved?.status).toBe("APPROVED");
    expect(dbStockAllocations[0].quantity).toBe(100); // Stock unchanged until post

    const posted = await postInventoryCount(count.id, userId);
    expect(posted?.status).toBe("POSTED");
    expect(posted?.adjustmentId).toBeDefined();

    // Physical stock updated from 100 -> 90
    expect(dbStockAllocations[0].quantity).toBe(90);
    expect(dbStockLocationAllocations[0].quantity).toBe(90);
  });

  it("SCENARIO 22 — FULL E2E INVENTORY LIFECYCLE", async () => {
    // 1. PROCUREMENT / PURCHASE -> GRN POST -> STOCK INCREASES (100)
    await executeStockMutation({
      productId: mockProductTiles.id,
      warehouseId: mockWarehouseA.id,
      binId: "bin-a",
      quantity: 100,
      movementType: StockMovementTypes.PURCHASE,
      performedBy: userId,
    });
    expect(dbStockAllocations[0].quantity).toBe(100);

    // 2. INVENTORY COUNT -> DISCOVER VARIANCE (Counted 105)
    const count = await createInventoryCount({ warehouseId: mockWarehouseA.id, scopeType: "BIN", scopeId: "bin-a" }, userId);
    await startInventoryCount(count.id, userId);
    await recordCountItems(count.id, { items: [{ productId: mockProductTiles.id, binId: "bin-a", countedQuantity: 105 }] }, userId);
    await submitInventoryCount(count.id, userId);
    await approveInventoryCount(count.id, userId);
    await postInventoryCount(count.id, userId);

    // Physical stock reconciled to 105
    expect(dbStockAllocations[0].quantity).toBe(105);
    expect(dbStockLocationAllocations[0].quantity).toBe(105);
  });
});
