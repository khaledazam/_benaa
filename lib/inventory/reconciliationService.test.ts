import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock Data Fixtures
const mockWarehouseA = { id: "wh-a", name: "Warehouse Alpha", code: "WH-A" };
const mockWarehouseB = { id: "wh-b", name: "Warehouse Beta", code: "WH-B" };
const mockCustomer = { id: "cust-1", code: "CUST-001", name: "BuildStock Client", active: true };

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
  { id: "bin-a", code: "BIN-A", warehouseId: "wh-a", active: true, locationPath: "Zone A / Rack 01 / Shelf 01 / Bin BIN-A" },
  { id: "bin-b", code: "BIN-B", warehouseId: "wh-a", active: true, locationPath: "Zone A / Rack 01 / Shelf 01 / Bin BIN-B" },
  { id: "bin-c", code: "BIN-C", warehouseId: "wh-b", active: true, locationPath: "Zone B / Rack 01 / Shelf 01 / Bin BIN-C" },
  { id: "bin-inactive", code: "BIN-INACTIVE", warehouseId: "wh-a", active: false, locationPath: "Zone A / Rack 01 / Shelf 01 / Bin INACTIVE" },
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
let dbGoodsReceipts: any[] = [];
let dbGoodsReceiptItems: any[] = [];
let dbPurchaseOrders: any[] = [];
let dbPurchaseOrderItems: any[] = [];
let dbAuditLogs: any[] = [];
let dbProducts: any[] = [];
let dbPostingActor: any = { id: "user-auditor-1", role: "SUPER_ADMIN", status: true, warehouseIds: ["wh-main", "wh-a", "wh-b"] };
let dbInventoryOperations: any[] = [];

vi.mock("@/prisma/client", () => {
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
        return dbStockMovements.filter((m) => {
          const matchProd = !where?.productId || m.productId === where.productId;
          const matchWh = !where?.warehouseId || m.warehouseId === where.warehouseId;
          const matchRefType = !where?.referenceType || m.referenceType === where.referenceType;
          const matchRefId = !where?.referenceId || m.referenceId === where.referenceId;
          return matchProd && matchWh && matchRefType && matchRefId;
        });
      }),
    },
    stockReservation: {
      findFirst: vi.fn(async ({ where }: any) => {
        return dbReservations.find((r) => {
          const matchOrder = !where?.salesOrderId || r.salesOrderId === where.salesOrderId;
          const matchStatus = !where?.status?.in || where.status.in.includes(r.status);
          return matchOrder && matchStatus;
        }) || null;
      }),
      findMany: vi.fn(async ({ where }: any) => {
        return dbReservations.filter((r) => {
          const matchWh = !where?.warehouseId || r.warehouseId === where.warehouseId;
          const matchStatus = !where?.status?.in || where.status.in.includes(r.status);
          return matchWh && matchStatus;
        }).map((r) => ({
          ...r,
          items: dbReservationItems.filter((ri) => ri.reservationId === r.id && (!where?.items?.where?.productId || ri.productId === where.items.where.productId)),
        }));
      }),
      findUnique: vi.fn(async ({ where }: any) => {
        const res = dbReservations.find((r) => r.id === where.id);
        if (!res) return null;
        return {
          ...res,
          items: dbReservationItems.filter((ri) => ri.reservationId === res.id),
        };
      }),
      create: vi.fn(async ({ data }: any) => {
        const newRes = { id: `res-${dbReservations.length + 1}`, ...data, createdAt: new Date() };
        delete newRes.items;
        dbReservations.push(newRes);
        if (data.items?.create) {
          for (const itemData of data.items.create) {
            dbReservationItems.push({ id: `rsi-${dbReservationItems.length + 1}`, reservationId: newRes.id, ...itemData });
          }
        }
        return mockTx.stockReservation.findUnique({ where: { id: newRes.id } });
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const res = dbReservations.find((r) => r.id === where.id);
        if (res) Object.assign(res, data);
        return res;
      }),
    },
    stockReservationItem: {
      findMany: vi.fn(async ({ where }: any) => {
        return dbReservationItems.filter((ri) => {
          const res = dbReservations.find((r) => r.id === ri.reservationId);
          const matchStatus = !where?.reservation?.status?.in || (res && where.reservation.status.in.includes(res.status));
          const matchProd = !where?.productId || ri.productId === where.productId;
          const matchWh = !where?.warehouseId || ri.warehouseId === where.warehouseId;
          return matchStatus && matchProd && matchWh;
        });
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const ri = dbReservationItems.find((item) => item.id === where.id);
        if (ri) Object.assign(ri, data);
        return ri;
      }),
    },
    pickList: {
      findMany: vi.fn(async ({ where }: any) => {
        return dbPickLists.filter((p) => !where?.warehouseId || p.warehouseId === where.warehouseId).map((p) => ({
          ...p,
          items: dbPickListItems.filter((pli) => pli.pickListId === p.id && (!where?.items?.where?.productId || pli.productId === where.items.where.productId)).map((pli) => ({
            ...pli,
            allocations: dbPickAllocations.filter((pa) => pa.pickListItemId === pli.id),
          })),
        }));
      }),
      findUnique: vi.fn(async ({ where }: any) => {
        const pl = dbPickLists.find((p) => p.id === where.id);
        if (!pl) return null;
        return {
          ...pl,
          salesOrder: dbSalesOrders.find((so) => so.id === pl.salesOrderId),
          warehouse: mockWarehouseA,
          items: dbPickListItems.filter((pli) => pli.pickListId === pl.id).map((pli) => ({
            ...pli,
            product: dbProducts.find((prod) => prod.id === pli.productId) || mockProductTiles,
            allocations: dbPickAllocations.filter((pa) => pa.pickListItemId === pli.id).map((pa) => ({
              ...pa,
              bin: dbBins.find((b) => b.id === pa.binId),
            })),
          })),
        };
      }),
    },
    dispatch: {
      updateMany: vi.fn(async ({ where, data }: any) => {
        const rows = dbDispatches.filter(d => (!where.id || d.id === where.id) && (!where.status || d.status === where.status));
        rows.forEach(d => Object.assign(d, data)); return { count: rows.length };
      }),
      findMany: vi.fn(async ({ where }: any) => {
        return dbDispatches.filter((d) => {
          const matchWh = !where?.warehouseId || d.warehouseId === where.warehouseId;
          const matchOrder = !where?.salesOrderId || d.salesOrderId === where.salesOrderId;
          const matchStatus = !where?.status || d.status === where.status;
          return matchWh && matchOrder && matchStatus;
        }).map((d) => ({
          ...d,
          items: dbDispatchItems.filter((di) => di.dispatchId === d.id && (!where?.items?.where?.productId || di.productId === where.items.where.productId)).map((di) => ({
            ...di,
            binAllocations: dbDispatchBinAllocations.filter((dba) => dba.dispatchItemId === di.id),
          })),
        }));
      }),
      findFirst: vi.fn(async ({ where }: any) => {
        return dbDispatches.find((d) => {
          const matchPick = !where.pickListId || d.pickListId === where.pickListId;
          const matchStatus = !where.status?.in || where.status.in.includes(d.status);
          return matchPick && matchStatus;
        }) || null;
      }),
      findUnique: vi.fn(async ({ where }: any) => {
        const d = dbDispatches.find((dp) => dp.id === where.id);
        if (!d) return null;
        return {
          ...d,
          salesOrder: dbSalesOrders.find((so) => so.id === d.salesOrderId),
          pickList: dbPickLists.find((pl) => pl.id === d.pickListId),
          warehouse: mockWarehouseA,
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
        const newDispatch = { id: `disp-${dbDispatches.length + 1}`, ...data, createdAt: new Date() };
        delete newDispatch.items;
        dbDispatches.push(newDispatch);
        if (data.items?.create) {
          for (const itemData of data.items.create) {
            const newItem = { id: `di-${dbDispatchItems.length + 1}`, dispatchId: newDispatch.id, ...itemData };
            delete newItem.binAllocations;
            dbDispatchItems.push(newItem);
            if (itemData.binAllocations?.create) {
              for (const binAllocData of itemData.binAllocations.create) {
                dbDispatchBinAllocations.push({ id: `dba-${dbDispatchBinAllocations.length + 1}`, dispatchItemId: newItem.id, ...binAllocData });
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
    salesOrder: {
      findUnique: vi.fn(async ({ where }: any) => {
        const so = dbSalesOrders.find((s) => s.id === where.id);
        if (!so) return null;
        return { ...so, customer: mockCustomer, items: so.items || [] };
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const so = dbSalesOrders.find((s) => s.id === where.id);
        if (so) Object.assign(so, data);
        return so;
      }),
    },
    auditLog: {
      create: vi.fn(async ({ data }: any) => {
        const log = { id: `log-${dbAuditLogs.length + 1}`, ...data };
        dbAuditLogs.push(log);
        return log;
      }),
    },
    stockTransfer: {
      create: vi.fn(async ({ data }: any) => {
        return { id: `trf-${Date.now()}`, ...data };
      }),
    },
  };

  return {
    prisma: {
      ...mockTx,
      $transaction: vi.fn(async (cb: any) => {
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
      }),
    },
  };
});

import {
  reconcileProductWarehouse,
  runFullInventoryReconciliation,
} from "@/lib/inventory/reconciliationService";
import { executeStockMutation, executeStockTransfer, executeStockRelocation, StockMovementTypes } from "@/lib/inventory/stockService";
import { createStockReservation } from "@/lib/reservations/reservationService";
import { createDispatch, postDispatch } from "@/lib/dispatch/dispatchService";

describe("Phase 5E â€” Inventory Reconciliation & End-to-End Integrity Engine", () => {
  const userId = "user-auditor-1";

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
    dbGoodsReceipts = [];
    dbGoodsReceiptItems = [];
    dbPurchaseOrders = [];
    dbPurchaseOrderItems = [];
    dbAuditLogs = [];
    dbProducts = [JSON.parse(JSON.stringify(mockProductTiles)), JSON.parse(JSON.stringify(mockProductMarble))];
  });

  it("SCENARIO 1 â€” Complete Procurement to Dispatch Lifecycle", async () => {
    await executeStockMutation({
      productId: mockProductTiles.id,
      warehouseId: mockWarehouseA.id,
      binId: "bin-a",
      quantity: 300,
      movementType: StockMovementTypes.PURCHASE,
      performedBy: userId,
    });

    await executeStockMutation({
      productId: mockProductTiles.id,
      warehouseId: mockWarehouseA.id,
      binId: "bin-b",
      quantity: 200,
      movementType: StockMovementTypes.PURCHASE,
      performedBy: userId,
    });

    let recon = await reconcileProductWarehouse(mockProductTiles.id, mockWarehouseA.id);
    expect(recon.physicalStock).toBe(500);
    expect(recon.binStock).toBe(500);
    expect(recon.status).toBe("HEALTHY");

    const salesOrder = {
      id: "so-sc1",
      salesOrderNumber: "SO-SC1-001",
      customerId: mockCustomer.id,
      warehouseId: mockWarehouseA.id,
      status: "APPROVED",
      items: [{ id: "soi-sc1", salesOrderId: "so-sc1", productId: mockProductTiles.id, orderedQuantity: 250, unitPrice: 45 }],
    };
    dbSalesOrders.push(salesOrder);

    const reservation = await createStockReservation(salesOrder.id, userId);

    recon = await reconcileProductWarehouse(mockProductTiles.id, mockWarehouseA.id);
    expect(recon.physicalStock).toBe(500);
    expect(recon.reservedStock).toBe(250);
    expect(recon.availableStock).toBe(250);

    const pickList = {
      id: "pl-sc1",
      pickListNumber: "PICK-SC1-001",
      salesOrderId: salesOrder.id,
      reservationId: reservation.id,
      warehouseId: mockWarehouseA.id,
      status: "COMPLETED",
    };
    dbPickLists.push(pickList);

    const pli = { id: "pli-sc1", pickListId: pickList.id, salesOrderItemId: "soi-sc1", productId: mockProductTiles.id, requestedQuantity: 250, pickedQuantity: 250, remainingQuantity: 0 };
    dbPickListItems.push(pli);
    dbPickAllocations.push(
      { id: "pa-a", pickListItemId: pli.id, binId: "bin-a", productId: mockProductTiles.id, requestedQuantity: 200, pickedQuantity: 200 },
      { id: "pa-b", pickListItemId: pli.id, binId: "bin-b", productId: mockProductTiles.id, requestedQuantity: 50, pickedQuantity: 50 }
    );

    recon = await reconcileProductWarehouse(mockProductTiles.id, mockWarehouseA.id);
    expect(recon.physicalStock).toBe(500);
    expect(recon.availableStock).toBe(250);

    const draftDispatch = await createDispatch(pickList.id, userId);
    await postDispatch(draftDispatch.id, userId);

    recon = await reconcileProductWarehouse(mockProductTiles.id, mockWarehouseA.id);
    expect(recon.physicalStock).toBe(250);
    expect(recon.reservedStock).toBe(0);
    expect(recon.availableStock).toBe(250);
    expect(recon.ledgerStock).toBe(250);
    expect(recon.status).toBe("HEALTHY");
  });

  it("SCENARIO 2 â€” Multiple Sales Orders & Allocation Budget Overrun Rejection", async () => {
    await executeStockMutation({
      productId: mockProductTiles.id,
      warehouseId: mockWarehouseA.id,
      binId: "bin-a",
      quantity: 500,
      movementType: StockMovementTypes.PURCHASE,
      performedBy: userId,
    });

    for (const [id, qty] of [["so-a", 200], ["so-b", 150], ["so-c", 100]] as [string, number][]) {
      const so = { id, salesOrderNumber: `SO-${id}`, customerId: mockCustomer.id, warehouseId: mockWarehouseA.id, status: "APPROVED", items: [{ id: `soi-${id}`, salesOrderId: id, productId: mockProductTiles.id, orderedQuantity: qty, unitPrice: 45 }] };
      dbSalesOrders.push(so);
      await createStockReservation(id, userId);
    }

    let recon = await reconcileProductWarehouse(mockProductTiles.id, mockWarehouseA.id);
    expect(recon.reservedStock).toBe(450);
    expect(recon.availableStock).toBe(50);

    const soD = { id: "so-d", salesOrderNumber: "SO-D", customerId: mockCustomer.id, warehouseId: mockWarehouseA.id, status: "APPROVED", items: [{ id: "soi-d", salesOrderId: "so-d", productId: mockProductTiles.id, orderedQuantity: 100, unitPrice: 45 }] };
    dbSalesOrders.push(soD);

    await expect(createStockReservation("so-d", userId)).rejects.toThrow("Insufficient available stock");
  });

  it("SCENARIO 3 â€” Concurrent Reservations (Atomic Budget Protection)", async () => {
    await executeStockMutation({
      productId: mockProductTiles.id,
      warehouseId: mockWarehouseA.id,
      binId: "bin-a",
      quantity: 100,
      movementType: StockMovementTypes.PURCHASE,
      performedBy: userId,
    });

    const so1 = { id: "so-c1", salesOrderNumber: "SO-C1", customerId: mockCustomer.id, warehouseId: mockWarehouseA.id, status: "APPROVED", items: [{ id: "soi-c1", salesOrderId: "so-c1", productId: mockProductTiles.id, orderedQuantity: 70, unitPrice: 45 }] };
    const so2 = { id: "so-c2", salesOrderNumber: "SO-C2", customerId: mockCustomer.id, warehouseId: mockWarehouseA.id, status: "APPROVED", items: [{ id: "soi-c2", salesOrderId: "so-c2", productId: mockProductTiles.id, orderedQuantity: 50, unitPrice: 45 }] };
    dbSalesOrders.push(so1, so2);

    const res1 = await createStockReservation("so-c1", userId);
    expect(res1.status).toBe("ACTIVE");
    await expect(createStockReservation("so-c2", userId)).rejects.toThrow("Insufficient available stock");

    const recon = await reconcileProductWarehouse(mockProductTiles.id, mockWarehouseA.id);
    expect(recon.reservedStock).toBe(70);
    expect(recon.availableStock).toBe(30);
  });

  it("SCENARIO 4 â€” Concurrent Dispatch (Single Stock Deduction)", async () => {
    await executeStockMutation({ productId: mockProductTiles.id, warehouseId: mockWarehouseA.id, binId: "bin-a", quantity: 100, movementType: StockMovementTypes.PURCHASE, performedBy: userId });

    const so = { id: "so-cd", salesOrderNumber: "SO-CD", customerId: mockCustomer.id, warehouseId: mockWarehouseA.id, status: "APPROVED", items: [{ id: "soi-cd", salesOrderId: "so-cd", productId: mockProductTiles.id, orderedQuantity: 100, unitPrice: 45 }] };
    dbSalesOrders.push(so);
    const resv = await createStockReservation("so-cd", userId);

    const pl = { id: "pl-cd", pickListNumber: "PICK-CD", salesOrderId: "so-cd", reservationId: resv.id, warehouseId: mockWarehouseA.id, status: "COMPLETED" };
    dbPickLists.push(pl);
    const pli = { id: "pli-cd", pickListId: pl.id, salesOrderItemId: "soi-cd", productId: mockProductTiles.id, requestedQuantity: 100, pickedQuantity: 100, remainingQuantity: 0 };
    dbPickListItems.push(pli);
    dbPickAllocations.push({ id: "pa-cd", pickListItemId: pli.id, binId: "bin-a", productId: mockProductTiles.id, requestedQuantity: 100, pickedQuantity: 100 });

    const draft = await createDispatch(pl.id, userId);

    const posted = await postDispatch(draft.id, userId, "verified-dispatch-retry");
    expect(posted.status).toBe("POSTED");
    const replay = await postDispatch(draft.id, userId, "verified-dispatch-retry");
    expect(replay.id).toBe(draft.id);
    expect(replay.status).toBe("POSTED");
    await expect(postDispatch("different-dispatch", userId, "verified-dispatch-retry")).rejects.toThrow("Idempotency key payload conflict");
    expect(dbInventoryOperations.length).toBe(1);
    expect(dbDispatches.filter(d => d.status === "POSTED").length).toBe(1);

    const saleMovements = dbStockMovements.filter((m) => m.movementType === "SALE");
    expect(saleMovements.length).toBe(1);
    expect(saleMovements[0].quantity).toBe(100);
  });

  it("SCENARIO 5 â€” Multi-Item Atomic Dispatch Rollback", async () => {
    await executeStockMutation({ productId: mockProductTiles.id, warehouseId: mockWarehouseA.id, binId: "bin-a", quantity: 100, movementType: StockMovementTypes.PURCHASE, performedBy: userId });
    await executeStockMutation({ productId: mockProductMarble.id, warehouseId: mockWarehouseA.id, binId: "bin-a", quantity: 50, movementType: StockMovementTypes.PURCHASE, performedBy: userId });

    const so = {
      id: "so-mi", salesOrderNumber: "SO-MI", customerId: mockCustomer.id, warehouseId: mockWarehouseA.id, status: "APPROVED",
      items: [
        { id: "soi-a", salesOrderId: "so-mi", productId: mockProductTiles.id, orderedQuantity: 50, unitPrice: 45 },
        { id: "soi-b", salesOrderId: "so-mi", productId: mockProductMarble.id, orderedQuantity: 50, unitPrice: 120 },
      ],
    };
    dbSalesOrders.push(so);

    const resv = await createStockReservation("so-mi", userId);
    const pl = { id: "pl-mi", pickListNumber: "PICK-MI", salesOrderId: "so-mi", reservationId: resv.id, warehouseId: mockWarehouseA.id, status: "COMPLETED" };
    dbPickLists.push(pl);

    const pliA = { id: "pli-ma", pickListId: pl.id, salesOrderItemId: "soi-a", productId: mockProductTiles.id, requestedQuantity: 50, pickedQuantity: 50, remainingQuantity: 0 };
    const pliB = { id: "pli-mb", pickListId: pl.id, salesOrderItemId: "soi-b", productId: mockProductMarble.id, requestedQuantity: 50, pickedQuantity: 50, remainingQuantity: 0 };
    dbPickListItems.push(pliA, pliB);
    dbPickAllocations.push(
      { id: "pa-ma", pickListItemId: pliA.id, binId: "bin-a", productId: mockProductTiles.id, requestedQuantity: 50, pickedQuantity: 50 },
      { id: "pa-mb", pickListItemId: pliB.id, binId: "bin-a", productId: mockProductMarble.id, requestedQuantity: 50, pickedQuantity: 50 }
    );

    const draft = await createDispatch(pl.id, userId);
    const reservationBefore = structuredClone(dbReservationItems);
    const productBefore = structuredClone(dbProducts);
    const movementCountBefore = dbStockMovements.length;

    const bAlloc = dbStockLocationAllocations.find((a) => a.productId === mockProductMarble.id);
    if (bAlloc) bAlloc.quantity = 0;
    const bWhAlloc = dbStockAllocations.find((a) => a.productId === mockProductMarble.id);
    if (bWhAlloc) bWhAlloc.quantity = 0;

    await expect(postDispatch(draft.id, userId, "verified-dispatch-retry")).rejects.toThrow("Insufficient physical stock");

    expect(dbDispatches.find(d => d.id === draft.id)?.status).toBe("DRAFT");
    expect(dbStockMovements.length).toBe(movementCountBefore);
    expect(dbReservationItems).toEqual(reservationBefore);
    expect(dbProducts).toEqual(productBefore);
    expect(dbInventoryOperations.length).toBe(0);
    const reconA = await reconcileProductWarehouse(mockProductTiles.id, mockWarehouseA.id);
    const reconB = await reconcileProductWarehouse(mockProductMarble.id, mockWarehouseA.id);
    expect(reconA.physicalStock).toBe(100);
    expect(reconB.physicalStock).toBe(0);
  });

  it("SCENARIO 6 â€” Short Pick Handling", async () => {
    await executeStockMutation({ productId: mockProductTiles.id, warehouseId: mockWarehouseA.id, binId: "bin-a", quantity: 100, movementType: StockMovementTypes.PURCHASE, performedBy: userId });

    const so = { id: "so-sp", salesOrderNumber: "SO-SP", customerId: mockCustomer.id, warehouseId: mockWarehouseA.id, status: "APPROVED", items: [{ id: "soi-sp", salesOrderId: "so-sp", productId: mockProductTiles.id, orderedQuantity: 100, unitPrice: 45 }] };
    dbSalesOrders.push(so);
    const resv = await createStockReservation("so-sp", userId);

    const pl = { id: "pl-sp", pickListNumber: "PICK-SP", salesOrderId: "so-sp", reservationId: resv.id, warehouseId: mockWarehouseA.id, status: "COMPLETED" };
    dbPickLists.push(pl);
    const pli = { id: "pli-sp", pickListId: pl.id, salesOrderItemId: "soi-sp", productId: mockProductTiles.id, requestedQuantity: 100, pickedQuantity: 80, remainingQuantity: 20, status: "SHORT" };
    dbPickListItems.push(pli);
    dbPickAllocations.push({ id: "pa-sp", pickListItemId: pli.id, binId: "bin-a", productId: mockProductTiles.id, requestedQuantity: 80, pickedQuantity: 80 });

    const draft = await createDispatch(pl.id, userId);
    await postDispatch(draft.id, userId);

    const recon = await reconcileProductWarehouse(mockProductTiles.id, mockWarehouseA.id);
    expect(recon.physicalStock).toBe(20);
  });

  it("SCENARIO 7 â€” Stock Relocation with Reservation", async () => {
    await executeStockMutation({ productId: mockProductTiles.id, warehouseId: mockWarehouseA.id, binId: "bin-a", quantity: 100, movementType: StockMovementTypes.PURCHASE, performedBy: userId });

    const so = { id: "so-rel", salesOrderNumber: "SO-REL", customerId: mockCustomer.id, warehouseId: mockWarehouseA.id, status: "APPROVED", items: [{ id: "soi-rel", salesOrderId: "so-rel", productId: mockProductTiles.id, orderedQuantity: 60, unitPrice: 45 }] };
    dbSalesOrders.push(so);
    await createStockReservation("so-rel", userId);

    await executeStockRelocation({
      productId: mockProductTiles.id,
      warehouseId: mockWarehouseA.id,
      fromBinId: "bin-a",
      toBinId: "bin-b",
      quantity: 40,
      performedBy: userId,
    });

    const recon = await reconcileProductWarehouse(mockProductTiles.id, mockWarehouseA.id);
    expect(recon.physicalStock).toBe(100);
    expect(recon.binStock).toBe(100);
    expect(recon.availableStock).toBe(40);
    expect(recon.status).toBe("HEALTHY");
  });

  it("SCENARIO 8 â€” Transfer Between Warehouses", async () => {
    await executeStockMutation({ productId: mockProductTiles.id, warehouseId: mockWarehouseA.id, binId: "bin-a", quantity: 100, movementType: StockMovementTypes.PURCHASE, performedBy: userId });

    await executeStockTransfer({
      productId: mockProductTiles.id,
      fromWarehouseId: mockWarehouseA.id,
      toWarehouseId: mockWarehouseB.id,
      fromBinId: "bin-a",
      toBinId: "bin-c",
      quantity: 40,
      performedBy: userId,
    });

    const reconA = await reconcileProductWarehouse(mockProductTiles.id, mockWarehouseA.id);
    const reconB = await reconcileProductWarehouse(mockProductTiles.id, mockWarehouseB.id);

    expect(reconA.physicalStock).toBe(60);
    expect(reconB.physicalStock).toBe(40);
    expect(reconA.status).toBe("HEALTHY");
    expect(reconB.status).toBe("HEALTHY");
  });

  it("SCENARIO 9 & 10 â€” Goods Receipt Draft & Post", async () => {
    const reconBefore = await reconcileProductWarehouse(mockProductTiles.id, mockWarehouseA.id);
    expect(reconBefore.physicalStock).toBe(0);

    await executeStockMutation({
      productId: mockProductTiles.id,
      warehouseId: mockWarehouseA.id,
      binId: "bin-a",
      quantity: 40,
      movementType: StockMovementTypes.PURCHASE,
      performedBy: userId,
    });

    const reconAfter = await reconcileProductWarehouse(mockProductTiles.id, mockWarehouseA.id);
    expect(reconAfter.physicalStock).toBe(40);
    expect(reconAfter.ledgerStock).toBe(40);
  });

  it("DATA CORRUPTION SIMULATION â€” Negative Stock & Inactive Bin Audit", async () => {
    dbStockLocationAllocations.push({
      id: "sla-corrupt",
      productId: mockProductTiles.id,
      warehouseId: mockWarehouseA.id,
      binId: "bin-a",
      quantity: -50,
    });
    dbStockAllocations.push({
      id: "sa-corrupt",
      productId: mockProductTiles.id,
      warehouseId: mockWarehouseA.id,
      reservedQuantity: 0,
      quantity: -50,
    });

    dbStockLocationAllocations.push({
      id: "sla-inactive",
      productId: mockProductTiles.id,
      warehouseId: mockWarehouseA.id,
      binId: "bin-inactive",
      quantity: 20,
    });

    const recon = await reconcileProductWarehouse(mockProductTiles.id, mockWarehouseA.id);
    expect(recon.status).toBe("CRITICAL");
    expect(recon.discrepancies.length).toBeGreaterThan(0);

    const categories = recon.discrepancies.map((d) => d.category);
    expect(categories).toContain("PHYSICAL_STOCK");
    expect(categories).toContain("BIN_ALLOCATION");
  });
});
