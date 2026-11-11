import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock Data Fixtures
const mockWarehouse = { id: "wh-main", name: "Main Logistics Warehouse", code: "WH-MAIN" };
const mockCustomer = { id: "cust-1", code: "CUST-001", name: "BuildStock Client", active: true };
const mockUnit = { id: "unit-m2", name: "Square Meters", symbol: "mآ²" };

const mockProductTile = {
  id: "prod-tile",
  name: "Ceramic Tile Premium",
  sku: "TILE-PORC-6060",
  price: 45.0,
  unitId: "unit-m2",
  quantity: 1000,
  minimumStock: 10,
  maximumStock: 5000,
};

const mockProductMarble = {
  id: "prod-marble",
  name: "Marble Slab Lux",
  sku: "MRBL-LUX-2000",
  price: 120.0,
  unitId: "unit-m2",
  quantity: 1000,
  minimumStock: 0,
  maximumStock: 5000,
};

const dbBins = [
  { id: "bin-a", code: "BIN-A", warehouseId: "wh-main", active: true, locationPath: "Zone A / Rack 01 / Shelf 01 / Bin BIN-A" },
  { id: "bin-b", code: "BIN-B", warehouseId: "wh-main", active: true, locationPath: "Zone A / Rack 01 / Shelf 01 / Bin BIN-B" },
  { id: "bin-c", code: "BIN-C", warehouseId: "wh-main", active: true, locationPath: "Zone A / Rack 01 / Shelf 01 / Bin BIN-C" },
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
let dbDispatches: any[] = [];
let dbDispatchItems: any[] = [];
let dbDispatchBinAllocations: any[] = [];
let dbAuditLogs: any[] = [];
let dbProducts: any[] = [];
let dbPostingActor: any = { id: "user-manager-1", role: "SUPER_ADMIN", status: true, warehouseIds: ["wh-main", "wh-a", "wh-b"] };
let dbInventoryOperations: any[] = [];

vi.mock("@/prisma/client", () => {
  let transactionTail: Promise<any> = Promise.resolve();
  const mockTx = {
    user: {
      findUnique: vi.fn(async ({ where }: any) => where.id === dbPostingActor.id ? dbPostingActor : null),
      update: vi.fn(async ({ where, data }: any) => {
        if (where.id !== dbPostingActor.id) throw new Error("User not found");
        return Object.assign(dbPostingActor, data);
      }),
    },
    inventoryOperation: {
      findUnique: vi.fn(async ({ where }: any) => dbInventoryOperations.find(r => r.operationKey === where.operationKey) || null),
      create: vi.fn(async ({ data }: any) => {
        if (dbInventoryOperations.some(r => r.operationKey === data.operationKey)) throw Object.assign(new Error("Duplicate key"), { code: "P2002" });
        const receipt = { id: `op-${dbInventoryOperations.length + 1}`, ...data }; dbInventoryOperations.push(receipt); return receipt;
      }),
    },
    // Explicit fixture tables for the authoritative availability/unit contract.
    unit: { findUnique: vi.fn(async ({ where }: any) => [{ id: "unit-m2", active: true, type: "area" }].find(u => u.id === where.id) || null) },
    projectMaterialIssueItem: { findMany: vi.fn(async () => []) },

    product: {
      findUnique: vi.fn(async ({ where }: any) => dbProducts.find((p) => p.id === where.id) || null),
      update: vi.fn(async ({ where, data }: any) => {
        const prod = dbProducts.find((p) => p.id === where.id);
        if (prod) Object.assign(prod, data);
        return prod;
      }),
    },
    warehouse: {
      findUnique: vi.fn(async ({ where }: any) => (where.id === mockWarehouse.id ? mockWarehouse : null)),
    },
    warehouseBin: {
      findUnique: vi.fn(async ({ where }: any) => dbBins.find((b) => b.id === where.id) || null),
    },
    stockAllocation: {
      findMany: vi.fn(async ({ where }: any) => dbStockAllocations.filter(a =>
        (!where.productId || a.productId === where.productId) && (!where.warehouseId || a.warehouseId === where.warehouseId))),
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
        if (sa) {
          const { reservedQuantity, ...fields } = data;
          Object.assign(sa, fields);
          if (typeof reservedQuantity === "number") sa.reservedQuantity = reservedQuantity;
          else if (reservedQuantity?.increment !== undefined) sa.reservedQuantity = (sa.reservedQuantity || 0) + reservedQuantity.increment;
        }
        return sa;
      }),
    },
    stockLocationAllocation: {
      count: vi.fn(async ({ where }: any) => dbStockLocationAllocations.filter(a =>
        (!where.productId || a.productId === where.productId) && (!where.warehouseId || a.warehouseId === where.warehouseId)).length),
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
      updateMany: vi.fn(async ({ where, data }: any) => {
        const rows = dbStockMovements.filter(m => (!where.id?.in || where.id.in.includes(m.id)) && (!where.id || typeof where.id !== "string" || m.id === where.id));
        rows.forEach(m => Object.assign(m, data)); return { count: rows.length };
      }),
      create: vi.fn(async ({ data }: any) => {
        const sm = { id: `sm-${dbStockMovements.length + 1}`, createdAt: new Date(), ...data };
        dbStockMovements.push(sm);
        return sm;
      }),
      findMany: vi.fn(async ({ where }: any) => {
        return dbStockMovements.filter((m) => m.referenceType === where?.referenceType && m.referenceId === where?.referenceId);
      }),
    },
    dispatch: {
      updateMany: vi.fn(async ({ where, data }: any) => {
        const rows = dbDispatches.filter(d => (!where.id || d.id === where.id) && (!where.status || d.status === where.status));
        rows.forEach(d => Object.assign(d, data)); return { count: rows.length };
      }),
      findFirst: vi.fn(async ({ where }: any) => {
        return dbDispatches.find((d) => {
          const matchPick = !where.pickListId || d.pickListId === where.pickListId;
          const matchStatus = !where.status?.in || where.status.in.includes(d.status);
          const matchPrefix = !where.dispatchNumber?.startsWith || d.dispatchNumber.startsWith(where.dispatchNumber.startsWith);
          return matchPick && matchStatus && matchPrefix;
        }) || null;
      }),
      findMany: vi.fn(async ({ where }: any) => {
        return dbDispatches.filter((d) => {
          const matchOrder = !where?.salesOrderId || d.salesOrderId === where.salesOrderId;
          const matchStatus = !where?.status || d.status === where.status;
          return matchOrder && matchStatus;
        }).map((d) => ({
          ...d,
          items: dbDispatchItems.filter((di) => di.dispatchId === d.id),
        }));
      }),
      findUnique: vi.fn(async ({ where }: any) => {
        const d = dbDispatches.find((dp) => dp.id === where.id);
        if (!d) return null;
        return {
          ...d,
          salesOrder: dbSalesOrders.find((so) => so.id === d.salesOrderId),
          pickList: dbPickLists.find((pl) => pl.id === d.pickListId),
          warehouse: mockWarehouse,
          items: dbDispatchItems.filter((di) => di.dispatchId === d.id).map((di) => ({
            ...di,
            binAllocations: dbDispatchBinAllocations.filter((dba) => dba.dispatchItemId === di.id).map((dba) => ({
              ...dba,
              bin: dbBins.find((b) => b.id === dba.binId),
            })),
          })),
        };
      }),
      create: vi.fn(async ({ data }: any) => {
        const newDispatch = {
          id: `disp-${dbDispatches.length + 1}`,
          ...data,
          createdAt: new Date(),
        };
        delete newDispatch.items;
        dbDispatches.push(newDispatch);

        if (data.items?.create) {
          for (const itemData of data.items.create) {
            const newItem = {
              id: `di-${dbDispatchItems.length + 1}`,
              dispatchId: newDispatch.id,
              ...itemData,
            };
            delete newItem.binAllocations;
            dbDispatchItems.push(newItem);

            if (itemData.binAllocations?.create) {
              for (const binAllocData of itemData.binAllocations.create) {
                dbDispatchBinAllocations.push({
                  id: `dba-${dbDispatchBinAllocations.length + 1}`,
                  dispatchItemId: newItem.id,
                  ...binAllocData,
                });
              }
            }
          }
        }

        return mockTx.dispatch.findUnique({ where: { id: newDispatch.id } });
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const d = dbDispatches.find((dp) => dp.id === where.id);
        if (d) Object.assign(d, data);
        return mockTx.dispatch.findUnique({ where: { id: where.id } });
      }),
    },
    stockReservation: {
      findUnique: vi.fn(async ({ where }: any) => {
        const res = dbReservations.find((r) => r.id === where.id);
        if (!res) return null;
        return {
          ...res,
          items: dbReservationItems.filter((ri) => ri.reservationId === res.id),
        };
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const res = dbReservations.find((r) => r.id === where.id);
        if (res) Object.assign(res, data);
        return res;
      }),
    },
    stockReservationItem: {
      findMany: vi.fn(async ({ where }: any) => dbReservationItems.filter(i =>
        (!where.productId || i.productId === where.productId) &&
        (!where.warehouseId || i.warehouseId === where.warehouseId) &&
        (!where.reservation?.status?.in || where.reservation.status.in.includes(dbReservations.find(r => r.id === i.reservationId)?.status)))),
      update: vi.fn(async ({ where, data }: any) => {
        const ri = dbReservationItems.find((item) => item.id === where.id);
        if (ri) Object.assign(ri, data);
        return ri;
      }),
    },
    salesOrder: {
      findUnique: vi.fn(async ({ where }: any) => {
        const so = dbSalesOrders.find((s) => s.id === where.id);
        if (!so) return null;
        return {
          ...so,
          customer: mockCustomer,
          items: so.items || [],
        };
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const so = dbSalesOrders.find((s) => s.id === where.id);
        if (so) Object.assign(so, data);
        return so;
      }),
    },
    pickList: {
      findUnique: vi.fn(async ({ where }: any) => {
        const pl = dbPickLists.find((p) => p.id === where.id);
        if (!pl) return null;
        return {
          ...pl,
          salesOrder: dbSalesOrders.find((so) => so.id === pl.salesOrderId),
          warehouse: mockWarehouse,
          items: dbPickListItems.filter((pli) => pli.pickListId === pl.id).map((pli) => ({
            ...pli,
            product: dbProducts.find((prod) => prod.id === pli.productId) || mockProductTile,
            allocations: dbPickAllocations.filter((pa) => pa.pickListItemId === pli.id).map((pa) => ({
              ...pa,
              bin: dbBins.find((b) => b.id === pa.binId),
            })),
          })),
        };
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
      $transaction: vi.fn((cb: any) => {
        const run = transactionTail.then(async () => {
        const snapshot = {
          dbPostingActor: structuredClone(dbPostingActor),
          dbStockAllocations: structuredClone(dbStockAllocations),
          dbStockLocationAllocations: structuredClone(dbStockLocationAllocations),
          dbStockMovements: structuredClone(dbStockMovements),
          dbSalesOrders: structuredClone(dbSalesOrders),
          dbReservations: structuredClone(dbReservations),
          dbReservationItems: structuredClone(dbReservationItems),
          dbPickLists: structuredClone(dbPickLists),
          dbDispatches: structuredClone(dbDispatches),
          dbDispatchItems: structuredClone(dbDispatchItems),
          dbDispatchBinAllocations: structuredClone(dbDispatchBinAllocations),
          dbAuditLogs: structuredClone(dbAuditLogs),
          dbProducts: structuredClone(dbProducts),
          dbInventoryOperations: structuredClone(dbInventoryOperations),
        };
        try {
          return await cb(mockTx);
        } catch (err) {
          dbPostingActor = snapshot.dbPostingActor;
          dbStockAllocations = snapshot.dbStockAllocations;
          dbStockLocationAllocations = snapshot.dbStockLocationAllocations;
          dbStockMovements = snapshot.dbStockMovements;
          dbSalesOrders = snapshot.dbSalesOrders;
          dbReservations = snapshot.dbReservations;
          dbReservationItems = snapshot.dbReservationItems;
          dbPickLists = snapshot.dbPickLists;
          dbDispatches = snapshot.dbDispatches;
          dbDispatchItems = snapshot.dbDispatchItems;
          dbDispatchBinAllocations = snapshot.dbDispatchBinAllocations;
          dbAuditLogs = snapshot.dbAuditLogs;
          dbProducts = snapshot.dbProducts;
          dbInventoryOperations = snapshot.dbInventoryOperations;
          throw err;
        }
        });
        transactionTail = run.catch(() => undefined);
        return run;
      }),
    },
  };
});

import {
  createDispatch,
  postDispatch,
  cancelDispatch,
  getDispatchById,
  previewDispatch,
} from "@/lib/dispatch/dispatchService";

describe("Phase 5D â€” Dispatch & Physical Stock Deduction Engine", () => {
  const userId = "user-manager-1";

  beforeEach(() => {
    dbInventoryOperations = [];
    dbStockAllocations = [];
    dbStockLocationAllocations = [];
    dbStockMovements = [];
    dbSalesOrders = [];
    dbReservations = [];
    dbReservationItems = [];
    dbPickLists = [];
    dbPickListItems = [];
    dbPickAllocations = [];
    dbDispatches = [];
    dbDispatchItems = [];
    dbDispatchBinAllocations = [];
    dbAuditLogs = [];
    dbProducts = [JSON.parse(JSON.stringify(mockProductTile)), JSON.parse(JSON.stringify(mockProductMarble))];
  });

  function setupTestData(options: {
    product?: any;
    initialBins?: { binId: string; qty: number }[];
    requestedQty?: number;
    pickedQty?: number;
  }) {
    const prod = options.product || mockProductTile;
    const bins = options.initialBins || [{ binId: "bin-a", qty: 100 }];
    const reqQty = options.requestedQty || 100;
    const pickQty = options.pickedQty !== undefined ? options.pickedQty : reqQty;

    let totalStock = 0;
    for (const b of bins) {
      dbStockLocationAllocations.push({
        id: `sla-${b.binId}`,
        productId: prod.id,
        warehouseId: mockWarehouse.id,
        binId: b.binId,
        quantity: b.qty,
        quantityInBaseUnit: b.qty,
      });
      totalStock += b.qty;
    }

    dbStockAllocations.push({
      id: `sa-${prod.id}`,
      productId: prod.id,
      warehouseId: mockWarehouse.id,
      quantity: totalStock,
      reservedQuantity: 0,
    });

    const salesOrder = {
      id: "so-1",
      salesOrderNumber: "SO-2026-000001",
      customerId: mockCustomer.id,
      warehouseId: mockWarehouse.id,
      status: "PROCESSING",
      customerNameSnapshot: mockCustomer.name,
      customerCodeSnapshot: mockCustomer.code,
      items: [
        {
          id: "soi-1",
          salesOrderId: "so-1",
          productId: prod.id,
          orderedQuantity: reqQty,
          unitPrice: prod.price,
        },
      ],
    };
    dbSalesOrders.push(salesOrder);

    const reservation = {
      id: "res-1",
      reservationNumber: "RES-2026-000001",
      salesOrderId: salesOrder.id,
      warehouseId: mockWarehouse.id,
      status: "ACTIVE",
    };
    dbReservations.push(reservation);

    const soItemId = salesOrder.items[0]?.id || "soi-1";

    const reservationItem = {
      id: "rsi-1",
      reservationId: reservation.id,
      salesOrderItemId: soItemId,
      productId: prod.id,
      warehouseId: mockWarehouse.id,
      requestedQuantity: reqQty,
      reservedQuantity: reqQty,
      releasedQuantity: 0,
      remainingQuantity: reqQty,
    };
    dbReservationItems.push(reservationItem);

    const pickList = {
      id: "pl-1",
      pickListNumber: "PICK-2026-000001",
      salesOrderId: salesOrder.id,
      reservationId: reservation.id,
      warehouseId: mockWarehouse.id,
      status: "COMPLETED",
      isDispatched: false,
    };
    dbPickLists.push(pickList);

    const pickListItem = {
      id: "pli-1",
      pickListId: pickList.id,
      salesOrderItemId: soItemId,
      reservationItemId: reservationItem.id,
      productId: prod.id,
      unitSymbol: prod.unitId === "unit-m2" ? "mآ²" : "L",
      requestedQuantity: reqQty,
      pickedQuantity: pickQty,
      remainingQuantity: reqQty - pickQty,
      status: pickQty < reqQty ? "SHORT" : "PICKED",
    };
    dbPickListItems.push(pickListItem);

    let remPickQty = pickQty;
    for (const b of bins) {
      if (remPickQty <= 0) break;
      const binPick = Math.min(b.qty, remPickQty);
      dbPickAllocations.push({
        id: `pa-${b.binId}`,
        pickListItemId: pickListItem.id,
        binId: b.binId,
        productId: prod.id,
        requestedQuantity: binPick,
        pickedQuantity: binPick,
        unitId: prod.unitId,
      });
      remPickQty -= binPick;
    }

    return { salesOrder, reservation, pickList };
  }

  it("TEST 1 â€” Basic Dispatch (Physical Deduction, SALE Movement, Order Completed)", async () => {
    setupTestData({ requestedQty: 100, pickedQty: 100 });

    const draft = await createDispatch("pl-1", userId);
    expect(draft.status).toBe("DRAFT");
    expect(dbStockAllocations[0].quantity).toBe(100);

    const posted = await postDispatch(draft.id, userId);
    expect(posted.status).toBe("POSTED");

    expect(dbStockAllocations[0].quantity).toBe(0);
    expect(dbStockLocationAllocations[0].quantity).toBe(0);

    expect(dbStockMovements.length).toBe(1);
    expect(dbStockMovements[0].movementType).toBe("SALE");
    expect(dbStockMovements[0].quantity).toBe(100);
    expect(dbStockMovements[0].referenceType).toBe("DISPATCH");

    expect(dbSalesOrders[0].status).toBe("COMPLETED");
  });

  it("TEST 2 â€” Multi-Bin Dispatch (50 + 40 + 30 = 120)", async () => {
    setupTestData({
      initialBins: [
        { binId: "bin-a", qty: 50 },
        { binId: "bin-b", qty: 40 },
        { binId: "bin-c", qty: 30 },
      ],
      requestedQty: 120,
      pickedQty: 120,
    });

    const draft = await createDispatch("pl-1", userId);
    const posted = await postDispatch(draft.id, userId);

    expect(posted.status).toBe("POSTED");
    expect(dbStockAllocations[0].quantity).toBe(0);
    for (const sla of dbStockLocationAllocations) {
      expect(sla.quantity).toBe(0);
    }
    expect(dbStockMovements.length).toBe(3);
  });

  it("TEST 3 â€” Decimal Precision Dispatch (25.50 mآ², zero drift)", async () => {
    setupTestData({
      initialBins: [{ binId: "bin-a", qty: 50.0 }],
      requestedQty: 25.5,
      pickedQty: 25.5,
    });

    const draft = await createDispatch("pl-1", userId);
    await postDispatch(draft.id, userId);

    expect(dbStockLocationAllocations[0].quantity).toBe(24.5);
    expect(dbStockAllocations[0].quantity).toBe(24.5);
  });

  it("TEST 4 â€” Short Pick Handling (Ordered 100, Picked 80, Dispatched 80)", async () => {
    setupTestData({
      initialBins: [{ binId: "bin-a", qty: 100 }],
      requestedQty: 100,
      pickedQty: 80,
    });

    const draft = await createDispatch("pl-1", userId);
    await postDispatch(draft.id, userId);

    expect(dbStockLocationAllocations[0].quantity).toBe(20);
    expect(dbStockAllocations[0].quantity).toBe(20);
    expect(dbReservations[0].status).toBe("PARTIALLY_FULFILLED");
    expect(dbReservationItems[0].releasedQuantity).toBe(80);
    expect(dbReservationItems[0].remainingQuantity).toBe(20);
  });

  it("TEST 5 â€” Insufficient Bin Stock Rejection", async () => {
    setupTestData({
      initialBins: [{ binId: "bin-a", qty: 100 }],
      requestedQty: 100,
      pickedQty: 100,
    });

    const draft = await createDispatch("pl-1", userId);

    dbStockLocationAllocations[0].quantity = 10;
    dbStockAllocations[0].quantity = 10;

    await expect(postDispatch(draft.id, userId)).rejects.toThrow("Insufficient physical stock");
    expect(dbDispatches[0].status).toBe("DRAFT");
  });

  it("TEST 6 â€” Double Dispatch Protection", async () => {
    setupTestData({ requestedQty: 100, pickedQty: 100 });

    const draft = await createDispatch("pl-1", userId);
    await postDispatch(draft.id, userId, "verified-dispatch-retry");

    const replay = await postDispatch(draft.id, userId, "verified-dispatch-retry");
    expect(replay.id).toBe(draft.id);
    expect(replay.status).toBe("POSTED");
    await expect(postDispatch("different-dispatch", userId, "verified-dispatch-retry")).rejects.toThrow("Idempotency key payload conflict");
    expect(dbInventoryOperations.length).toBe(1);
    expect(dbDispatches.filter(d => d.status === "POSTED").length).toBe(1);
    expect(dbStockAllocations[0].quantity).toBe(0);
    expect(dbStockMovements.length).toBe(1);
  });

  it("TEST 7 â€” Concurrent Dispatch Protection", async () => {
    setupTestData({ requestedQty: 100, pickedQty: 100 });

    const draft = await createDispatch("pl-1", userId);

    const [res1, res2] = await Promise.allSettled([
      postDispatch(draft.id, userId, "verified-dispatch-retry"),
      postDispatch(draft.id, userId, "verified-dispatch-retry"),
    ]);

    const succeeded = [res1, res2].filter((r) => r.status === "fulfilled");
    const rejected = [res1, res2].filter((r) => r.status === "rejected");

    expect(succeeded.length).toBe(2);
    expect(rejected.length).toBe(0);
    expect((succeeded[0] as any).value.id).toBe((succeeded[1] as any).value.id);
    expect(dbInventoryOperations.length).toBe(1);
    expect(dbDispatches.filter(d => d.status === "POSTED").length).toBe(1);
    expect(dbStockAllocations[0].quantity).toBe(0);
    expect(dbStockMovements.length).toBe(1);
    await expect(postDispatch("different-dispatch", userId, "verified-dispatch-retry")).rejects.toThrow("Idempotency key payload conflict");
    expect((succeeded[0] as any).value.status).toBe("POSTED");
  });

  it("TEST 8 â€” Multi-Item Transaction Atomicity (Product B Fails -> Transaction Rolls Back)", async () => {
    dbStockLocationAllocations.push({ id: "sla-a", productId: mockProductTile.id, warehouseId: mockWarehouse.id, binId: "bin-a", quantity: 100, reservedQuantity: 0 });
    dbStockAllocations.push({ id: "sa-a", productId: mockProductTile.id, warehouseId: mockWarehouse.id, quantity: 100, reservedQuantity: 0 });
    dbStockLocationAllocations.push({ id: "sla-b", productId: mockProductMarble.id, warehouseId: mockWarehouse.id, binId: "bin-b", quantity: 0, reservedQuantity: 0 });
    dbStockAllocations.push({ id: "sa-b", productId: mockProductMarble.id, warehouseId: mockWarehouse.id, quantity: 0, reservedQuantity: 0 });

    const salesOrder = {
      id: "so-multi",
      salesOrderNumber: "SO-MULTI-01",
      customerId: mockCustomer.id,
      warehouseId: mockWarehouse.id,
      status: "PROCESSING",
      items: [
        { id: "soi-a", salesOrderId: "so-multi", productId: mockProductTile.id, orderedQuantity: 50, unitPrice: 45 },
        { id: "soi-b", salesOrderId: "so-multi", productId: mockProductMarble.id, orderedQuantity: 50, unitPrice: 120 },
      ],
    };
    dbSalesOrders.push(salesOrder);

    const reservation = { id: "res-multi", reservationNumber: "RES-MULTI-01", salesOrderId: salesOrder.id, warehouseId: mockWarehouse.id, status: "ACTIVE" };
    dbReservations.push(reservation);

    dbReservationItems.push(
      { id: "rsi-a", reservationId: reservation.id, salesOrderItemId: "soi-a", productId: mockProductTile.id, warehouseId: mockWarehouse.id, requestedQuantity: 50, reservedQuantity: 50, releasedQuantity: 0, remainingQuantity: 50 },
      { id: "rsi-b", reservationId: reservation.id, salesOrderItemId: "soi-b", productId: mockProductMarble.id, warehouseId: mockWarehouse.id, requestedQuantity: 50, reservedQuantity: 50, releasedQuantity: 0, remainingQuantity: 50 }
    );

    const pickList = { id: "pl-multi", pickListNumber: "PICK-MULTI-01", salesOrderId: salesOrder.id, reservationId: reservation.id, warehouseId: mockWarehouse.id, status: "COMPLETED", isDispatched: false };
    dbPickLists.push(pickList);

    const pliA = { id: "pli-a", pickListId: pickList.id, salesOrderItemId: "soi-a", reservationItemId: "rsi-a", productId: mockProductTile.id, unitSymbol: "mآ²", requestedQuantity: 50, pickedQuantity: 50, remainingQuantity: 0, status: "PICKED" };
    const pliB = { id: "pli-b", pickListId: pickList.id, salesOrderItemId: "soi-b", reservationItemId: "rsi-b", productId: mockProductMarble.id, unitSymbol: "mآ²", requestedQuantity: 50, pickedQuantity: 50, remainingQuantity: 0, status: "PICKED" };
    dbPickListItems.push(pliA, pliB);

    dbPickAllocations.push(
      { id: "pa-a", pickListItemId: pliA.id, binId: "bin-a", productId: mockProductTile.id, requestedQuantity: 50, pickedQuantity: 50 },
      { id: "pa-b", pickListItemId: pliB.id, binId: "bin-b", productId: mockProductMarble.id, requestedQuantity: 50, pickedQuantity: 50 }
    );

    const draft = await createDispatch(pickList.id, userId);

    await expect(postDispatch(draft.id, userId)).rejects.toThrow("Insufficient physical stock");

    const stockA = dbStockAllocations.find((sa) => sa.productId === mockProductTile.id);
    expect(stockA?.quantity).toBe(100);
    expect(dbStockMovements.length).toBe(0);
  });

  it("TEST 9 â€” Cancel Draft Dispatch (Zero Stock Mutation)", async () => {
    setupTestData({ requestedQty: 50, pickedQty: 50 });

    const draft = await createDispatch("pl-1", userId);
    const cancelled = await cancelDispatch(draft.id, "Customer requested delay", userId);

    expect(cancelled.status).toBe("CANCELLED");
    expect(dbStockAllocations[0].quantity).toBe(100);
    expect(dbStockMovements.length).toBe(0);
  });

  it("TEST 10 â€” Posted Dispatch Immutability", async () => {
    setupTestData({ requestedQty: 50, pickedQty: 50 });

    const draft = await createDispatch("pl-1", userId);
    await postDispatch(draft.id, userId);

    await expect(cancelDispatch(draft.id, "Reason", userId)).rejects.toThrow("Must be DRAFT");
  });

  it("TEST 11 â€” Reservation Reconciliation Invariant", async () => {
    setupTestData({ requestedQty: 100, pickedQty: 100 });

    const draft = await createDispatch("pl-1", userId);
    await postDispatch(draft.id, userId);

    expect(dbReservations[0].status).toBe("FULFILLED");
    expect(dbReservationItems[0].releasedQuantity).toBe(100);
    expect(dbReservationItems[0].remainingQuantity).toBe(0);
  });

  it("TEST 12 â€” Structured Audit Trail Verification", async () => {
    setupTestData({ requestedQty: 50, pickedQty: 50 });

    const draft = await createDispatch("pl-1", userId);
    await postDispatch(draft.id, userId);

    const actions = dbAuditLogs.map((l) => l.action);
    expect(actions).toContain("dispatch_created");
    expect(actions).toContain("dispatch_posted");
    expect(actions).toContain("stock_deducted_by_dispatch");
    expect(actions).toContain("reservation_fulfilled_by_dispatch");
    expect(actions).toContain("sales_order_completed");
  });
});
