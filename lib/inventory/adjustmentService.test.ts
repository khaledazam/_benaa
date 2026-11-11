import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock Fixtures
const mockWarehouseA = { id: "wh-a", name: "Warehouse Alpha", code: "WH-A" };
const mockWarehouseB = { id: "wh-b", name: "Warehouse Beta", code: "WH-B" };
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

const mockProductMarble = {
  id: "prod-marble",
  name: "Marble Slab",
  sku: "MRBL-LUX-100",
  price: 120.0,
  unitId: "unit-m2",
  quantity: 20,
  minimumStock: 5,
  maximumStock: 500,
};

const dbBins = [
  { id: "bin-a", code: "BIN-A", warehouseId: "wh-a", active: true, locationPath: "Zone A / Bin A" },
  { id: "bin-b", code: "BIN-B", warehouseId: "wh-a", active: true, locationPath: "Zone A / Bin B" },
  { id: "bin-c", code: "BIN-C", warehouseId: "wh-b", active: true, locationPath: "Zone B / Bin C" },
  { id: "bin-inactive", code: "BIN-INACTIVE", warehouseId: "wh-a", active: false, locationPath: "Zone A / Bin Inactive" },
];

let dbStockAllocations: any[] = [];
let dbStockLocationAllocations: any[] = [];
let dbStockMovements: any[] = [];
let dbAdjustments: any[] = [];
let dbAdjustmentItems: any[] = [];
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
      findUnique: vi.fn(async ({ where }: any) => [mockWarehouseA, mockWarehouseB].find((w) => w.id === where.id) || null),
    },
    warehouseBin: {
      findUnique: vi.fn(async ({ where }: any) => dbBins.find((b) => b.id === where.id) || null),
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
          return matchProd && matchWh;
        }).map((a) => ({
          ...a,
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
      findMany: vi.fn(async ({ where }: any) => {
        return dbStockMovements.filter((m) => {
          const matchProd = !where?.productId || m.productId === where.productId;
          const matchWh = !where?.warehouseId || m.warehouseId === where.warehouseId;
          return matchProd && matchWh;
        });
      }),
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
          dbAuditLogs = snapshot.dbAuditLogs;
          dbProducts = snapshot.dbProducts;
          throw err;
        }
      }),
    },
  };
});

import {
  createAdjustment,
  submitAdjustment,
  approveAdjustment,
  postAdjustment,
} from "@/lib/inventory/adjustmentService";
import { executeStockMutation, StockMovementTypes } from "@/lib/inventory/stockService";

describe("Phase 6 — Stock Adjustment Engine & Mandatory Scenarios", () => {
  const userId = mockUser.id;

  beforeEach(() => {
    dbStockAllocations = [];
    dbStockLocationAllocations = [];
    dbStockMovements = [];
    dbAdjustments = [];
    dbAdjustmentItems = [];
    dbAuditLogs = [];
    dbProducts = [JSON.parse(JSON.stringify(mockProductTiles)), JSON.parse(JSON.stringify(mockProductMarble))];
  });

  it("SCENARIO 1 — Create adjustment draft -> stock unchanged", async () => {
    await executeStockMutation({
      productId: mockProductTiles.id,
      warehouseId: mockWarehouseA.id,
      binId: "bin-a",
      quantity: 100,
      movementType: StockMovementTypes.PURCHASE,
      performedBy: userId,
    });

    const draft = await createAdjustment(
      {
        warehouseId: mockWarehouseA.id,
        reason: "Initial Count",
        adjustmentType: "CORRECTION",
        items: [{ productId: mockProductTiles.id, binId: "bin-a", systemQuantity: 100, adjustmentQuantity: 50, resultingQuantity: 150 }],
      },
      userId
    );

    expect(draft.status).toBe("DRAFT");
    expect(dbStockAllocations[0].quantity).toBe(100);
    expect(dbStockLocationAllocations[0].quantity).toBe(100);
    expect(dbStockMovements.length).toBe(1); // Only PURCHASE, zero adjustment movement
  });

  it("SCENARIO 2 — Submit adjustment -> stock unchanged", async () => {
    const draft = await createAdjustment(
      {
        warehouseId: mockWarehouseA.id,
        reason: "Initial Count",
        adjustmentType: "CORRECTION",
        items: [{ productId: mockProductTiles.id, binId: "bin-a", systemQuantity: 0, adjustmentQuantity: 20, resultingQuantity: 20 }],
      },
      userId
    );

    const submitted = await submitAdjustment(draft.id, userId);
    expect(submitted.status).toBe("PENDING_APPROVAL");
    expect(dbStockMovements.length).toBe(0);
  });

  it("SCENARIO 3 — Approve adjustment -> stock unchanged", async () => {
    const draft = await createAdjustment(
      {
        warehouseId: mockWarehouseA.id,
        reason: "Initial Count",
        adjustmentType: "CORRECTION",
        items: [{ productId: mockProductTiles.id, binId: "bin-a", systemQuantity: 0, adjustmentQuantity: 20, resultingQuantity: 20 }],
      },
      userId
    );

    await submitAdjustment(draft.id, userId);
    const approved = await approveAdjustment(draft.id, userId);
    expect(approved.status).toBe("APPROVED");
    expect(dbStockMovements.length).toBe(0);
  });

  it("SCENARIO 4 — Post adjustment -> stock changes exactly once", async () => {
    await executeStockMutation({
      productId: mockProductTiles.id,
      warehouseId: mockWarehouseA.id,
      binId: "bin-a",
      quantity: 100,
      movementType: StockMovementTypes.PURCHASE,
      performedBy: userId,
    });

    const draft = await createAdjustment(
      {
        warehouseId: mockWarehouseA.id,
        reason: "Found Stock",
        adjustmentType: "FOUND",
        items: [{ productId: mockProductTiles.id, binId: "bin-a", systemQuantity: 100, adjustmentQuantity: 30, resultingQuantity: 130 }],
      },
      userId
    );
    await submitAdjustment(draft.id, userId);
    await approveAdjustment(draft.id, userId);

    const posted = await postAdjustment(draft.id, userId);
    expect(posted?.status).toBe("POSTED");

    expect(dbStockAllocations[0].quantity).toBe(130);
    expect(dbStockLocationAllocations[0].quantity).toBe(130);

    const adjMovements = dbStockMovements.filter((m) => m.referenceType === "STOCK_ADJUSTMENT");
    expect(adjMovements.length).toBe(1);
    expect(adjMovements[0].quantity).toBe(30);
  });

  it("SCENARIO 5 — Double post -> rejected", async () => {
    const draft = await createAdjustment(
      {
        warehouseId: mockWarehouseA.id,
        reason: "Found Stock",
        adjustmentType: "FOUND",
        items: [{ productId: mockProductTiles.id, binId: "bin-a", systemQuantity: 0, adjustmentQuantity: 30, resultingQuantity: 30 }],
      },
      userId
    );
    await submitAdjustment(draft.id, userId);
    await approveAdjustment(draft.id, userId);

    await postAdjustment(draft.id, userId);
    await expect(postAdjustment(draft.id, userId)).rejects.toThrow("has already been POSTED");
  });

  it("SCENARIO 7 — Multi-item adjustment atomic rollback", async () => {
    await executeStockMutation({ productId: mockProductTiles.id, warehouseId: mockWarehouseA.id, binId: "bin-a", quantity: 100, movementType: StockMovementTypes.PURCHASE, performedBy: userId });

    const draft = await createAdjustment(
      {
        warehouseId: mockWarehouseA.id,
        reason: "Multi Line",
        adjustmentType: "CORRECTION",
        items: [
          { productId: mockProductTiles.id, binId: "bin-a", systemQuantity: 100, adjustmentQuantity: 50, resultingQuantity: 150 },
          { productId: mockProductMarble.id, binId: "bin-b", systemQuantity: 0, adjustmentQuantity: 10, resultingQuantity: 10 },
        ],
      },
      userId
    );
    await submitAdjustment(draft.id, userId);
    await approveAdjustment(draft.id, userId);

    // Deactivate bin-b prior to posting to simulate mid-process failure
    const binB = dbBins.find((b) => b.id === "bin-b");
    if (binB) binB.active = false;

    await expect(postAdjustment(draft.id, userId)).rejects.toThrow("inactive bin");

    // Physical stock remains 100 for Product A, zero adjustment movements created
    expect(dbStockAllocations.find((a) => a.productId === mockProductTiles.id).quantity).toBe(100);
    const adjMovements = dbStockMovements.filter((m) => m.referenceType === "STOCK_ADJUSTMENT");
    expect(adjMovements.length).toBe(0);
  });

  it("SCENARIO 8 & 10 — Negative stock prevention & Inactive bin rejection", async () => {
    await expect(
      createAdjustment(
        {
          warehouseId: mockWarehouseA.id,
          reason: "Excess Reduction",
          adjustmentType: "DAMAGE",
          items: [{ productId: mockProductTiles.id, binId: "bin-a", systemQuantity: 10, adjustmentQuantity: -50, resultingQuantity: -40 }],
        },
        userId
      )
    ).rejects.toThrow("cannot be negative");

    await expect(
      createAdjustment(
        {
          warehouseId: mockWarehouseA.id,
          reason: "Inactive Bin Target",
          adjustmentType: "CORRECTION",
          items: [{ productId: mockProductTiles.id, binId: "bin-inactive", systemQuantity: 0, adjustmentQuantity: 10, resultingQuantity: 10 }],
        },
        userId
      )
    ).rejects.toThrow("inactive bin");
  });

  it("SCENARIO 11 — Cross-warehouse bin rejection", async () => {
    await expect(
      createAdjustment(
        {
          warehouseId: mockWarehouseA.id,
          reason: "Wrong Warehouse Bin",
          adjustmentType: "CORRECTION",
          items: [{ productId: mockProductTiles.id, binId: "bin-c", systemQuantity: 0, adjustmentQuantity: 10, resultingQuantity: 10 }],
        },
        userId
      )
    ).rejects.toThrow("does not belong to warehouse");
  });

  it("SCENARIO 17 — Decimal quantities safe handling", async () => {
    await executeStockMutation({ productId: mockProductTiles.id, warehouseId: mockWarehouseA.id, binId: "bin-a", quantity: 10.55, movementType: StockMovementTypes.PURCHASE, performedBy: userId });

    const draft = await createAdjustment(
      {
        warehouseId: mockWarehouseA.id,
        reason: "Decimal Adjustment",
        adjustmentType: "CORRECTION",
        items: [{ productId: mockProductTiles.id, binId: "bin-a", systemQuantity: 10.55, adjustmentQuantity: 4.45, resultingQuantity: 15.0 }],
      },
      userId
    );
    await submitAdjustment(draft.id, userId);
    await approveAdjustment(draft.id, userId);
    await postAdjustment(draft.id, userId);

    expect(dbStockAllocations[0].quantity).toBe(15);
  });
});
