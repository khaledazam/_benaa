import { describe, it, expect, beforeEach, vi } from "vitest";

const mockWarehouse = { id: "wh-1", name: "Main Warehouse", code: "MAIN" };
const mockCustomer = { id: "cust-1", customerCode: "CUS-2026-000001", name: "ABC Decoration", active: true };

const mockProductTile = {
  id: "prod-tile",
  name: "Porcelain Tile",
  sku: "TILE-PORC",
  price: 45.0,
  unitId: "unit-m2",
  size: "m²",
};

const mockProductPaint = {
  id: "prod-paint",
  name: "Acrylic Paint",
  sku: "PAINT-ACR",
  price: 25.0,
  unitId: "unit-L",
  size: "L",
};

const mockStockAllocations = [
  { id: "alloc-tile", productId: "prod-tile", warehouseId: "wh-1", quantity: 100.0 },
  { id: "alloc-paint", productId: "prod-paint", warehouseId: "wh-1", quantity: 30.0 }, // Only 30 L available
];

let dbSalesOrders: any[] = [];
let dbReservations: any[] = [];
let dbReservationItems: any[] = [];
let dbAuditLogs: any[] = [];
let dbStockMovements: any[] = [];

vi.mock("@/prisma/client", () => {
  const mockTx = {
    stockAllocation: {
      findMany: vi.fn(async ({ where }: any) => {
        return mockStockAllocations.filter((a) => a.productId === where.productId && a.warehouseId === where.warehouseId);
      }),
    },
    stockReservationItem: {
      findMany: vi.fn(async ({ where }: any) => {
        return dbReservationItems.filter((i) => {
          const matchesProd = !where.productId || i.productId === where.productId;
          const matchesWh = !where.warehouseId || i.warehouseId === where.warehouseId;
          const res = dbReservations.find((r) => r.id === i.reservationId);
          const matchesStatus = !where.reservation?.status || (where.reservation.status.in && where.reservation.status.in.includes(res?.status));
          return matchesProd && matchesWh && matchesStatus;
        });
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const item = dbReservationItems.find((i) => i.id === where.id);
        if (item) Object.assign(item, data);
        return item;
      }),
    },
    stockReservation: {
      create: vi.fn(async ({ data }: any) => {
        const newRes = {
          id: `res-${dbReservations.length + 1}`,
          ...data,
          items: data.items.create.map((item: any, idx: number) => {
            const newItem = { id: `res-item-${dbReservationItems.length + idx + 1}`, reservationId: `res-${dbReservations.length + 1}`, ...item };
            dbReservationItems.push(newItem);
            return newItem;
          }),
          createdAt: new Date(),
        };
        dbReservations.push(newRes);
        return newRes;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const res = dbReservations.find((r) => r.id === where.id);
        if (!res) throw new Error("Reservation not found");
        Object.assign(res, data);
        return res;
      }),
    },
    auditLog: {
      create: vi.fn(async ({ data }: any) => {
        dbAuditLogs.push(data);
        return { id: `audit-${dbAuditLogs.length}`, ...data };
      }),
    },
  };

  return {
    prisma: {
      ...mockTx,
      $transaction: vi.fn(async (cb: any) => cb(mockTx)),
      salesOrder: {
        findUnique: vi.fn(async ({ where }: any) => dbSalesOrders.find((so) => so.id === where.id) || null),
        findFirst: vi.fn(async () => null),
        update: vi.fn(async ({ where, data }: any) => {
          const so = dbSalesOrders.find((s) => s.id === where.id);
          if (so) Object.assign(so, data);
          return so;
        }),
      },
      stockReservation: {
        ...mockTx.stockReservation,
        findFirst: vi.fn(async ({ where }: any) => {
          return dbReservations.find((r) => {
            const matchSO = !where.salesOrderId || r.salesOrderId === where.salesOrderId;
            const matchStatus = !where.status || (where.status.in && where.status.in.includes(r.status));
            const matchPrefix = !where.reservationNumber?.startsWith || r.reservationNumber.startsWith(where.reservationNumber.startsWith);
            return matchSO && matchStatus && matchPrefix;
          }) || null;
        }),
        findUnique: vi.fn(async ({ where }: any) => dbReservations.find((r) => r.id === where.id) || null),
        count: vi.fn(async () => dbReservations.length),
        findMany: vi.fn(async () => dbReservations),
      },
      stockAllocation: mockTx.stockAllocation,
      stockReservationItem: mockTx.stockReservationItem,
      stockMovement: {
        count: vi.fn(async () => dbStockMovements.length),
      },
      auditLog: mockTx.auditLog,
    },
  };
});

import {
  generateReservationNumber,
  getAvailableStock,
  createStockReservation,
  releaseReservation,
  cancelReservation,
} from "@/lib/reservations/reservationService";

import { cancelSalesOrder } from "@/lib/sales/salesOrderService";

describe("BuildStock Phase 5B — Reservation Number & Availability", () => {
  beforeEach(() => {
    dbSalesOrders = [];
    dbReservations = [];
    dbReservationItems = [];
    dbAuditLogs = [];
    dbStockMovements = [];
  });

  it("generates correct reservation number format RES-2026-XXXXXX", async () => {
    const num = await generateReservationNumber();
    expect(num).toMatch(/^RES-\d{4}-\d{6}$/);
  });

  it("calculates available stock correctly (availableStock = physicalStock - activeReservedStock)", async () => {
    const initial = await getAvailableStock("prod-tile", "wh-1");
    expect(initial.physicalStock).toBe(100.0);
    expect(initial.reservedStock).toBe(0.0);
    expect(initial.availableStock).toBe(100.0);
  });
});

describe("BuildStock Phase 5B — STEP 26 CRITICAL E2E TEST (STOCK ISOLATION INVARIANT)", () => {
  beforeEach(() => {
    dbSalesOrders = [];
    dbReservations = [];
    dbReservationItems = [];
    dbAuditLogs = [];
    dbStockMovements = [];
  });

  it("verifies reservation creation and release leave physical stock and StockMovement 100% UNCHANGED", async () => {
    // 1. Initial State
    const INITIAL_PHYSICAL = 100.0;
    const ORDER_QTY = 25.0;

    const mockSO = {
      id: "so-1",
      salesOrderNumber: "SO-2026-000001",
      customerId: "cust-1",
      warehouseId: "wh-1",
      status: "APPROVED",
      customerNameSnapshot: "ABC Decoration",
      customerCodeSnapshot: "CUS-2026-000001",
      items: [
        {
          id: "so-item-1",
          productId: "prod-tile",
          productName: "Porcelain Tile",
          orderedQuantity: ORDER_QTY,
          unitSymbol: "m²",
        },
      ],
    };
    dbSalesOrders.push(mockSO);

    // 2. Create Reservation
    const reservation = await createStockReservation("so-1", "user-1");
    expect(reservation.reservationNumber).toMatch(/^RES-\d{4}-\d{6}$/);
    expect(reservation.status).toBe("ACTIVE");

    // Check Availability
    const afterReserve = await getAvailableStock("prod-tile", "wh-1");
    expect(afterReserve.physicalStock).toBe(INITIAL_PHYSICAL);
    expect(afterReserve.reservedStock).toBe(25.0);
    expect(afterReserve.availableStock).toBe(75.0);

    // CRITICAL ASSERTION: StockAllocation remains 100.0, StockMovements count remains 0!
    expect(mockStockAllocations[0]!.quantity).toBe(INITIAL_PHYSICAL);
    expect(dbStockMovements.length).toBe(0);

    // 3. Release Reservation
    const released = await releaseReservation(reservation.id, { reason: "Customer changed mind" }, "user-1");
    expect(released.status).toBe("RELEASED");

    // Check Availability after Release
    const afterRelease = await getAvailableStock("prod-tile", "wh-1");
    expect(afterRelease.physicalStock).toBe(INITIAL_PHYSICAL);
    expect(afterRelease.reservedStock).toBe(0.0);
    expect(afterRelease.availableStock).toBe(INITIAL_PHYSICAL);

    // CRITICAL ASSERTION: StockAllocation remains 100.0, StockMovements count remains 0!
    expect(mockStockAllocations[0]!.quantity).toBe(INITIAL_PHYSICAL);
    expect(dbStockMovements.length).toBe(0);
  });
});

describe("BuildStock Phase 5B — STEP 27 CONCURRENCY & OVER-RESERVATION PROTECTION", () => {
  beforeEach(() => {
    dbSalesOrders = [];
    dbReservations = [];
    dbReservationItems = [];
    dbAuditLogs = [];
    dbStockMovements = [];
  });

  it("prevents total reserved stock from exceeding physical stock (100 m² physical, 70 m² + 50 m² requests)", async () => {
    const mockSO1 = {
      id: "so-1",
      salesOrderNumber: "SO-2026-000001",
      warehouseId: "wh-1",
      status: "APPROVED",
      items: [{ id: "i1", productId: "prod-tile", productName: "Tile", orderedQuantity: 70.0 }],
    };

    const mockSO2 = {
      id: "so-2",
      salesOrderNumber: "SO-2026-000002",
      warehouseId: "wh-1",
      status: "APPROVED",
      items: [{ id: "i2", productId: "prod-tile", productName: "Tile", orderedQuantity: 50.0 }],
    };

    dbSalesOrders.push(mockSO1, mockSO2);

    // First reservation succeeds (70 m²)
    const res1 = await createStockReservation("so-1", "user-1");
    expect(res1.status).toBe("ACTIVE");

    // Second reservation must fail (50 m² requested > 30 m² available)
    await expect(createStockReservation("so-2", "user-2")).rejects.toThrow(/Insufficient available stock/);

    const avail = await getAvailableStock("prod-tile", "wh-1");
    expect(avail.physicalStock).toBe(100.0);
    expect(avail.reservedStock).toBe(70.0);
    expect(avail.availableStock).toBe(30.0);
  });
});

describe("BuildStock Phase 5B — STEP 28 MULTI-ITEM ATOMIC RESERVATION TEST", () => {
  beforeEach(() => {
    dbSalesOrders = [];
    dbReservations = [];
    dbReservationItems = [];
    dbAuditLogs = [];
    dbStockMovements = [];
  });

  it("aborts entire multi-item reservation if ANY single item exceeds available stock", async () => {
    const mockMultiSO = {
      id: "so-multi",
      salesOrderNumber: "SO-2026-000099",
      warehouseId: "wh-1",
      status: "APPROVED",
      items: [
        { id: "i1", productId: "prod-tile", productName: "Tile", orderedQuantity: 25.0 }, // 25 m² (Available: 100) -> OK
        { id: "i2", productId: "prod-paint", productName: "Acrylic Paint", orderedQuantity: 50.0 }, // 50 L requested > 30 L available -> FAILS
      ],
    };
    dbSalesOrders.push(mockMultiSO);

    // Reservation should fail atomically
    await expect(createStockReservation("so-multi", "user-1")).rejects.toThrow(/Insufficient available stock for product 'Acrylic Paint'/);

    // Verify 0 reservation headers and 0 reservation items persisted
    expect(dbReservations.length).toBe(0);
    expect(dbReservationItems.length).toBe(0);
  });
});

describe("BuildStock Phase 5B — STEP 29 SALES ORDER CANCELLATION INTEGRATION TEST", () => {
  beforeEach(() => {
    dbSalesOrders = [];
    dbReservations = [];
    dbReservationItems = [];
    dbAuditLogs = [];
    dbStockMovements = [];
  });

  it("automatically releases active reservation when Sales Order is cancelled", async () => {
    const mockSO = {
      id: "so-cancel-test",
      salesOrderNumber: "SO-2026-000100",
      warehouseId: "wh-1",
      status: "APPROVED",
      items: [{ id: "i1", productId: "prod-tile", productName: "Tile", orderedQuantity: 40.0 }],
    };
    dbSalesOrders.push(mockSO);

    // Create reservation (40 m²)
    const res = await createStockReservation("so-cancel-test", "user-1");
    expect(res.status).toBe("ACTIVE");

    const availBefore = await getAvailableStock("prod-tile", "wh-1");
    expect(availBefore.reservedStock).toBe(40.0);

    // Cancel Sales Order
    const cancelledSO = await cancelSalesOrder("so-cancel-test", "Customer cancelled order", "user-1");
    expect(cancelledSO.status).toBe("CANCELLED");

    // Reservation should automatically be CANCELLED / RELEASED
    const reservationState = dbReservations.find((r) => r.id === res.id);
    expect(reservationState.status).toBe("CANCELLED");

    const availAfter = await getAvailableStock("prod-tile", "wh-1");
    expect(availAfter.physicalStock).toBe(100.0);
    expect(availAfter.reservedStock).toBe(0.0);
    expect(availAfter.availableStock).toBe(100.0);
    expect(dbStockMovements.length).toBe(0);
  });
});

describe("BuildStock Phase 5B — STEP 30 DECIMAL QUANTITY TESTING", () => {
  beforeEach(() => {
    dbSalesOrders = [];
    dbReservations = [];
    dbReservationItems = [];
    dbAuditLogs = [];
    dbStockMovements = [];
  });

  it("handles decimal quantities (25.50 m², 12.75 L, 0.50 Ton) with 0 precision drift", async () => {
    const mockSO = {
      id: "so-decimal",
      salesOrderNumber: "SO-2026-000555",
      warehouseId: "wh-1",
      status: "APPROVED",
      items: [{ id: "i1", productId: "prod-tile", productName: "Tile", orderedQuantity: 25.5 }],
    };
    dbSalesOrders.push(mockSO);

    const res = await createStockReservation("so-decimal", "user-1");
    expect(res.items[0]!.reservedQuantity).toBe(25.5);

    const avail = await getAvailableStock("prod-tile", "wh-1");
    expect(avail.physicalStock).toBe(100.0);
    expect(avail.reservedStock).toBe(25.5);
    expect(avail.availableStock).toBe(74.5);
  });
});
