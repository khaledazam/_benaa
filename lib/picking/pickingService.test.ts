import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock fixtures
const mockWarehouse = { id: "wh-main", name: "Main Warehouse", code: "MAIN-WH" };
const mockCustomer = { id: "cust-1", customerCode: "CUS-2026-000001", name: "BuildStock Client", active: true };

const mockProductTile = {
  id: "prod-tile",
  name: "Porcelain Tile",
  sku: "TILE-PORC-6060",
  price: 45.0,
  unitId: "unit-m2",
  unitSymbol: "m²",
};

const mockProductPaint = {
  id: "prod-paint",
  name: "White Wall Paint",
  sku: "PAINT-WHITE-10L",
  price: 30.0,
  unitId: "unit-L",
  unitSymbol: "L",
};

const dbBins = [
  {
    id: "bin-01",
    code: "B-01",
    warehouseId: "wh-main",
    active: true,
    locationPath: "MAIN-WH / ZONE-A / RACK-01 / SHELF-01 / B-01",
  },
  {
    id: "bin-02",
    code: "B-02",
    warehouseId: "wh-main",
    active: true,
    locationPath: "MAIN-WH / ZONE-A / RACK-01 / SHELF-01 / B-02",
  },
  {
    id: "bin-03",
    code: "B-03",
    warehouseId: "wh-main",
    active: true,
    locationPath: "MAIN-WH / ZONE-A / RACK-01 / SHELF-01 / B-03",
  },
];

let dbStockAllocations: any[] = [];
let dbStockLocationAllocations: any[] = [];
let dbStockMovements: any[] = [];
let dbSalesOrders: any[] = [];
let dbReservations: any[] = [];
let dbReservationItems: any[] = [];
let dbPickLists: any[] = [];
let dbPickListItems: any[] = [];
let dbPickAllocations: any[] = [];
let dbAuditLogs: any[] = [];

vi.mock("@/prisma/client", () => {
  const mockTx = {
    stockAllocation: {
      findMany: vi.fn(async ({ where }: any) => {
        return dbStockAllocations.filter((a) => a.productId === where.productId && a.warehouseId === where.warehouseId);
      }),
    },
    stockLocationAllocation: {
      findMany: vi.fn(async ({ where }: any) => {
        return dbStockLocationAllocations.filter((a) => {
          const matchProd = !where.productId || a.productId === where.productId;
          const matchWh = !where.warehouseId || a.warehouseId === where.warehouseId;
          const matchBinActive = !where.bin?.active || dbBins.find((b) => b.id === a.binId)?.active;
          return matchProd && matchWh && matchBinActive;
        }).map((a) => ({
          ...a,
          bin: dbBins.find((b) => b.id === a.binId),
        }));
      }),
    },
    stockMovement: {
      findMany: vi.fn(async () => dbStockMovements),
      create: vi.fn(async ({ data }: any) => {
        const sm = { id: `sm-${dbStockMovements.length + 1}`, ...data };
        dbStockMovements.push(sm);
        return sm;
      }),
    },
    warehouseBin: {
      findUnique: vi.fn(async ({ where }: any) => dbBins.find((b) => b.id === where.id) || null),
    },
    pickList: {
      findFirst: vi.fn(async ({ where }: any) => {
        return dbPickLists.find((pl) => {
          const matchRes = !where.reservationId || pl.reservationId === where.reservationId;
          const matchStatus = !where.status?.in || where.status.in.includes(pl.status);
          return matchRes && matchStatus;
        }) || null;
      }),
      findUnique: vi.fn(async ({ where, include }: any) => {
        const pl = dbPickLists.find((p) => p.id === where.id);
        if (!pl) return null;
        return enrichPickList(pl, include);
      }),
      findMany: vi.fn(async () => dbPickLists.map((pl) => enrichPickList(pl, { items: true }))),
      count: vi.fn(async () => dbPickLists.length),
      create: vi.fn(async ({ data }: any) => {
        const newPl = {
          id: `pl-${dbPickLists.length + 1}`,
          pickListNumber: data.pickListNumber,
          salesOrderId: data.salesOrderId,
          reservationId: data.reservationId,
          warehouseId: data.warehouseId,
          status: data.status,
          createdBy: data.createdBy,
          assignedTo: data.assignedTo || null,
          startedAt: null,
          completedAt: null,
          cancelledAt: null,
          cancellationReason: null,
          createdAt: new Date(),
        };

        dbPickLists.push(newPl);

        if (data.items?.create) {
          data.items.create.forEach((item: any, idx: number) => {
            const newItem = {
              id: `pli-${dbPickListItems.length + idx + 1}`,
              pickListId: newPl.id,
              ...item,
              pickedQuantity: item.pickedQuantity || 0,
              createdAt: new Date(),
            };
            dbPickListItems.push(newItem);
          });
        }

        return enrichPickList(newPl, { items: true });
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const pl = dbPickLists.find((p) => p.id === where.id);
        if (!pl) throw new Error("Pick List not found");
        Object.assign(pl, data);
        return enrichPickList(pl, { items: true });
      }),
    },
    pickListItem: {
      update: vi.fn(async ({ where, data }: any) => {
        const item = dbPickListItems.find((i) => i.id === where.id);
        if (item) Object.assign(item, data);
        return item;
      }),
    },
    pickAllocation: {
      findMany: vi.fn(async ({ where }: any) => {
        return dbPickAllocations.filter((a) => {
          const matchProd = !where.productId || a.productId === where.productId;
          const matchBinWh = !where.bin?.warehouseId || dbBins.find((b) => b.id === a.binId)?.warehouseId === where.bin.warehouseId;
          const pli = dbPickListItems.find((i) => i.id === a.pickListItemId);
          const pl = dbPickLists.find((p) => p.id === pli?.pickListId);

          const matchPlStatus = !where.pickListItem?.pickList?.status?.in || where.pickListItem.pickList.status.in.includes(pl?.status);
          const matchExcl = !where.pickListItem?.pickList?.id?.not || pl?.id !== where.pickListItem.pickList.id.not;

          return matchProd && matchBinWh && matchPlStatus && matchExcl;
        });
      }),
      deleteMany: vi.fn(async ({ where }: any) => {
        dbPickAllocations = dbPickAllocations.filter((a) => a.pickListItemId !== where.pickListItemId);
        return { count: 1 };
      }),
      create: vi.fn(async ({ data }: any) => {
        const alloc = { id: `pa-${dbPickAllocations.length + 1}`, ...data };
        dbPickAllocations.push(alloc);
        return alloc;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const alloc = dbPickAllocations.find((a) => a.id === where.id);
        if (alloc) Object.assign(alloc, data);
        return alloc;
      }),
    },
    stockReservation: {
      findUnique: vi.fn(async ({ where }: any) => {
        const res = dbReservations.find((r) => r.id === where.id);
        if (!res) return null;
        const items = dbReservationItems.filter((i) => i.reservationId === res.id);
        const so = dbSalesOrders.find((s) => s.id === res.salesOrderId);
        return { ...res, items, salesOrder: so, warehouse: mockWarehouse };
      }),
    },
    auditLog: {
      create: vi.fn(async ({ data }: any) => {
        dbAuditLogs.push(data);
        return { id: `audit-${dbAuditLogs.length}`, ...data };
      }),
    },
  };

  function enrichPickList(pl: any, include?: any) {
    const items = dbPickListItems
      .filter((i) => i.pickListId === pl.id)
      .map((item) => {
        const allocs = dbPickAllocations
          .filter((a) => a.pickListItemId === item.id)
          .map((a) => ({
            ...a,
            bin: dbBins.find((b) => b.id === a.binId),
          }));
        const prod = item.productId === mockProductTile.id ? mockProductTile : mockProductPaint;
        return { ...item, product: prod, allocations: allocs };
      });

    const so = dbSalesOrders.find((s) => s.id === pl.salesOrderId) || {
      id: pl.salesOrderId,
      salesOrderNumber: "SO-2026-000001",
      customer: mockCustomer,
    };

    const res = dbReservations.find((r) => r.id === pl.reservationId) || {
      id: pl.reservationId,
      reservationNumber: "RES-2026-000001",
    };

    return {
      ...pl,
      items,
      salesOrder: so,
      warehouse: mockWarehouse,
      reservation: res,
    };
  }

  return {
    prisma: {
      ...mockTx,
      $transaction: vi.fn(async (cb: any) => cb(mockTx)),
    },
  };
});

import {
  createPickList,
  assignPickList,
  startPickList,
  getPickingAvailability,
  getPickingSuggestions,
  setPickAllocations,
  completePickList,
  cancelPickList,
} from "./pickingService";

describe("BuildStock — Phase 5C Picking & Pick List Engine", () => {
  beforeEach(() => {
    dbStockAllocations = [
      { id: "sa-1", productId: "prod-tile", warehouseId: "wh-main", quantity: 100.0 },
      { id: "sa-2", productId: "prod-paint", warehouseId: "wh-main", quantity: 50.0 },
    ];

    dbStockLocationAllocations = [
      { id: "sla-1", productId: "prod-tile", warehouseId: "wh-main", binId: "bin-01", quantity: 60.0 },
      { id: "sla-2", productId: "prod-tile", warehouseId: "wh-main", binId: "bin-02", quantity: 40.0 },
      { id: "sla-3", productId: "prod-paint", warehouseId: "wh-main", binId: "bin-03", quantity: 50.0 },
    ];

    dbStockMovements = [];
    dbPickLists = [];
    dbPickListItems = [];
    dbPickAllocations = [];
    dbAuditLogs = [];

    dbSalesOrders = [
      {
        id: "so-1",
        salesOrderNumber: "SO-2026-000001",
        status: "APPROVED",
        warehouseId: "wh-main",
        customer: mockCustomer,
      },
    ];

    dbReservations = [
      {
        id: "res-1",
        reservationNumber: "RES-2026-000001",
        salesOrderId: "so-1",
        warehouseId: "wh-main",
        status: "ACTIVE",
      },
    ];

    dbReservationItems = [
      {
        id: "res-item-1",
        reservationId: "res-1",
        salesOrderItemId: "so-item-1",
        productId: "prod-tile",
        warehouseId: "wh-main",
        unitSymbol: "m²",
        requestedQuantity: 100.0,
        reservedQuantity: 100.0,
        remainingQuantity: 100.0,
      },
    ];
  });

  // STEP 28: Stock Isolation E2E Invariant Test
  it("STEP 28 — Critical Invariant: Completing Pick List MUST leave physical stock, location stock, and StockMovements unchanged", async () => {
    // 1. Create Pick List from active reservation
    const pickList: any = await createPickList({
      reservationId: "res-1",
      userId: "user-1",
    });

    expect(pickList.pickListNumber).toMatch(/^PICK-2026-\d{6}$/);
    expect(pickList.status).toBe("DRAFT");

    // 2. Set Pick Allocations: Bin B-01 (60 m²) + Bin B-02 (40 m²) = 100 m²
    const item = pickList.items[0];
    await setPickAllocations(
      pickList.id,
      [
        { pickListItemId: item.id, binId: "bin-01", requestedQuantity: 60.0, pickedQuantity: 60.0 },
        { pickListItemId: item.id, binId: "bin-02", requestedQuantity: 40.0, pickedQuantity: 40.0 },
      ],
      "user-1"
    );

    // 3. Complete Pick List
    const completed: any = await completePickList(pickList.id, "user-1");

    expect(completed.status).toBe("COMPLETED");

    // CRITICAL VERIFICATION:
    // Physical Stock Allocation quantity MUST remain 100.0
    expect(dbStockAllocations[0].quantity).toBe(100.0);

    // Physical Location Allocations MUST remain B-01 = 60, B-02 = 40
    expect(dbStockLocationAllocations[0].quantity).toBe(60.0);
    expect(dbStockLocationAllocations[1].quantity).toBe(40.0);

    // StockMovements count MUST remain 0 (no SALE movement created during Phase 5C)
    expect(dbStockMovements.length).toBe(0);

    // Audit logs verify lifecycle
    const actionTypes = dbAuditLogs.map((a) => a.action);
    expect(actionTypes).toContain("pick_list_created");
    expect(actionTypes).toContain("pick_allocation_updated");
    expect(actionTypes).toContain("pick_list_completed");
  });

  // STEP 29: Multi-Bin Pick Test
  it("STEP 29 — Multi-Bin Picking: Supports allocating one product across multiple physical bins", async () => {
    dbStockLocationAllocations = [
      { id: "sla-1", productId: "prod-tile", warehouseId: "wh-main", binId: "bin-01", quantity: 50.0 },
      { id: "sla-2", productId: "prod-tile", warehouseId: "wh-main", binId: "bin-02", quantity: 40.0 },
      { id: "sla-3", productId: "prod-tile", warehouseId: "wh-main", binId: "bin-03", quantity: 30.0 },
    ];

    dbReservationItems[0].requestedQuantity = 120.0;
    dbReservationItems[0].reservedQuantity = 120.0;
    dbReservationItems[0].remainingQuantity = 120.0;

    const pickList: any = await createPickList({ reservationId: "res-1", userId: "user-1" });
    const itemId = pickList.items[0].id;

    // Pick allocations across 3 bins: 50 + 40 + 30 = 120
    await setPickAllocations(
      pickList.id,
      [
        { pickListItemId: itemId, binId: "bin-01", requestedQuantity: 50.0 },
        { pickListItemId: itemId, binId: "bin-02", requestedQuantity: 40.0 },
        { pickListItemId: itemId, binId: "bin-03", requestedQuantity: 30.0 },
      ],
      "user-1"
    );

    const completed: any = await completePickList(pickList.id, "user-1");

    expect(completed.items[0].pickedQuantity).toBe(120.0);
    expect(completed.items[0].status).toBe("PICKED");

    // Physical stock remains unchanged
    expect(dbStockLocationAllocations.reduce((sum, a) => sum + a.quantity, 0)).toBe(120.0);
  });

  // STEP 30: Short Pick Test
  it("STEP 30 — Short Pick: Allows picker to record short pick without modifying physical stock or auto-releasing reservation", async () => {
    const pickList: any = await createPickList({ reservationId: "res-1", userId: "user-1" });
    const itemId = pickList.items[0].id;

    // Reserved = 100, but only 80 physically picked
    await setPickAllocations(
      pickList.id,
      [{ pickListItemId: itemId, binId: "bin-01", requestedQuantity: 60.0, pickedQuantity: 60.0 },
       { pickListItemId: itemId, binId: "bin-02", requestedQuantity: 20.0, pickedQuantity: 20.0 }],
      "user-1"
    );

    // Complete with short approval
    const completed: any = await completePickList(pickList.id, "user-1", { allowShort: true });

    expect(completed.status).toBe("COMPLETED");
    expect(completed.items[0].status).toBe("SHORT");
    expect(completed.items[0].pickedQuantity).toBe(80.0);
    expect(completed.items[0].remainingQuantity).toBe(20.0);

    // Audit log records short pick
    const shortAudit = dbAuditLogs.find((a) => a.action === "short_pick_recorded");
    expect(shortAudit).toBeDefined();
    expect(shortAudit.details.shortQuantity).toBe(20.0);

    // Physical stock untouched
    expect(dbStockLocationAllocations[0].quantity).toBe(60.0);
  });

  // STEP 31: Concurrency Guard Test
  it("STEP 31 — Concurrency Guard: Prevents active pick lists from over-committing physical bin stock", async () => {
    // Bin B-01 physical stock = 60 m²
    // Pick List A reserves 50 m² from B-01
    const pickListA: any = await createPickList({ reservationId: "res-1", userId: "user-1" });
    await setPickAllocations(
      pickListA.id,
      [{ pickListItemId: pickListA.items[0].id, binId: "bin-01", requestedQuantity: 50.0 }],
      "user-1"
    );

    // Check pickable availability for B-01 for another pick list
    const availabilities = await getPickingAvailability("prod-tile", "wh-main");
    const bin01Avail = availabilities.find((b) => b.binId === "bin-01");

    expect(bin01Avail?.physicalStock).toBe(60.0);
    expect(bin01Avail?.alreadyCommittedToOtherActivePicks).toBe(50.0);
    expect(bin01Avail?.pickableStock).toBe(10.0); // Only 10 m² remaining pickable!

    // Pick List B attempting to allocate 20 m² from B-01 MUST fail validation
    dbReservations.push({
      id: "res-2",
      reservationNumber: "RES-2026-000002",
      salesOrderId: "so-1",
      warehouseId: "wh-main",
      status: "ACTIVE",
    });
    dbReservationItems.push({
      id: "res-item-2",
      reservationId: "res-2",
      salesOrderItemId: "so-item-2",
      productId: "prod-tile",
      warehouseId: "wh-main",
      requestedQuantity: 30.0,
      reservedQuantity: 30.0,
      remainingQuantity: 30.0,
    });

    const pickListB: any = await createPickList({ reservationId: "res-2", userId: "user-2" });

    await expect(
      setPickAllocations(
        pickListB.id,
        [{ pickListItemId: pickListB.items[0].id, binId: "bin-01", requestedQuantity: 20.0 }],
        "user-2"
      )
    ).rejects.toThrow(/insufficient pickable stock/i);
  });

  // STEP 32: Cancellation Test
  it("STEP 32 — Cancellation: Releases pick allocations without physical stock mutation", async () => {
    const pickList: any = await createPickList({ reservationId: "res-1", userId: "user-1" });
    await setPickAllocations(
      pickList.id,
      [{ pickListItemId: pickList.items[0].id, binId: "bin-01", requestedQuantity: 40.0 }],
      "user-1"
    );

    const cancelled = await cancelPickList(pickList.id, "Picker unavailable", "user-1");

    expect(cancelled.status).toBe("CANCELLED");

    // Availability is fully restored because pick list is cancelled
    const availabilities = await getPickingAvailability("prod-tile", "wh-main");
    const bin01 = availabilities.find((b) => b.binId === "bin-01");

    expect(bin01?.alreadyCommittedToOtherActivePicks).toBe(0);
    expect(bin01?.pickableStock).toBe(60.0);
    expect(dbStockMovements.length).toBe(0);
  });

  // STEP 16: Decimal Quantities Test
  it("STEP 16 — Decimal Quantities: Handles non-integer measurements with floating point precision safety", async () => {
    dbReservationItems[0].requestedQuantity = 25.5;
    dbReservationItems[0].reservedQuantity = 25.5;
    dbReservationItems[0].remainingQuantity = 25.5;

    const pickList: any = await createPickList({ reservationId: "res-1", userId: "user-1" });

    await setPickAllocations(
      pickList.id,
      [{ pickListItemId: pickList.items[0].id, binId: "bin-01", requestedQuantity: 12.75, pickedQuantity: 12.75 },
       { pickListItemId: pickList.items[0].id, binId: "bin-02", requestedQuantity: 12.75, pickedQuantity: 12.75 }],
      "user-1"
    );

    const completed: any = await completePickList(pickList.id, "user-1");

    expect(completed.items[0].pickedQuantity).toBe(25.5);
    expect(completed.items[0].status).toBe("PICKED");
  });

  // STEP 27: Immutability Test
  it("STEP 27 — Immutability: Rejects attempts to modify a COMPLETED Pick List", async () => {
    const pickList: any = await createPickList({ reservationId: "res-1", userId: "user-1" });
    await setPickAllocations(
      pickList.id,
      [{ pickListItemId: pickList.items[0].id, binId: "bin-01", requestedQuantity: 60.0, pickedQuantity: 60.0 },
       { pickListItemId: pickList.items[0].id, binId: "bin-02", requestedQuantity: 40.0, pickedQuantity: 40.0 }],
      "user-1"
    );

    await completePickList(pickList.id, "user-1");

    // Attempting to modify allocations on completed pick list must fail
    await expect(
      setPickAllocations(
        pickList.id,
        [{ pickListItemId: pickList.items[0].id, binId: "bin-01", requestedQuantity: 10.0 }],
        "user-1"
      )
    ).rejects.toThrow(/Cannot modify allocations for Pick List in 'COMPLETED' status/i);

    // Attempting to cancel completed pick list must fail
    await expect(cancelPickList(pickList.id, "Late cancel", "user-1")).rejects.toThrow(
      /Cannot cancel a COMPLETED Pick List/i
    );
  });
});
