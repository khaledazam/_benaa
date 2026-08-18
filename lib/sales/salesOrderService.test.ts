import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Mock Prisma Client for Unit & E2E Testing
 */
const mockCustomer = {
  id: "cust-1",
  customerCode: "CUS-2026-000001",
  name: "ABC Decoration",
  phone: "+966 50 123 4567",
  email: "contact@abc.com",
  active: true,
  createdAt: new Date(),
};

const mockInactiveCustomer = {
  id: "cust-2",
  customerCode: "CUS-2026-000002",
  name: "Inactive Client Ltd",
  active: false,
};

const mockWarehouse = {
  id: "wh-1",
  name: "Main Warehouse",
  code: "MAIN-WH",
};

const mockProduct = {
  id: "prod-1",
  name: "Porcelain Tile 60x60",
  sku: "TILE-PORC-6060",
  price: 45.0,
  unitId: "unit-1",
  size: "m²",
};

const mockStockAllocation = {
  id: "alloc-1",
  productId: "prod-1",
  warehouseId: "wh-1",
  quantity: 100.0,
  reservedQuantity: 0.0,
};

let dbSalesOrders: any[] = [];
let dbAuditLogs: any[] = [];
let dbStockMovements: any[] = [];
let dbStockAllocations: any[] = [mockStockAllocation];

vi.mock("@/prisma/client", () => ({
  prisma: {
    customer: {
      findUnique: vi.fn(async ({ where }: any) => {
        if (where.id === "cust-1") return mockCustomer;
        if (where.id === "cust-2") return mockInactiveCustomer;
        return null;
      }),
      findFirst: vi.fn(async () => null),
      create: vi.fn(async ({ data }: any) => ({ id: "cust-1", ...data, createdAt: new Date() })),
      update: vi.fn(async ({ where, data }: any) => ({ ...mockCustomer, ...data })),
      count: vi.fn(async () => 1),
    },
    warehouse: {
      findUnique: vi.fn(async ({ where }: any) => (where.id === "wh-1" ? mockWarehouse : null)),
    },
    product: {
      findMany: vi.fn(async () => [mockProduct]),
    },
    unit: {
      findMany: vi.fn(async () => [{ id: "unit-1", symbol: "m²" }]),
    },
    salesOrder: {
      findFirst: vi.fn(async () => null),
      findUnique: vi.fn(async ({ where }: any) => dbSalesOrders.find((so) => so.id === where.id) || null),
      create: vi.fn(async ({ data }: any) => {
        const newOrder = {
          id: `so-${dbSalesOrders.length + 1}`,
          ...data,
          items: data.items.create.map((item: any, idx: number) => ({ id: `item-${idx + 1}`, ...item })),
          createdAt: new Date(),
        };
        dbSalesOrders.push(newOrder);
        return newOrder;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const order = dbSalesOrders.find((so) => so.id === where.id);
        if (!order) throw new Error("Sales Order not found");
        Object.assign(order, data);
        return order;
      }),
      count: vi.fn(async () => dbSalesOrders.length),
    },
    stockAllocation: {
      findUnique: vi.fn(async () => mockStockAllocation),
      findMany: vi.fn(async () => dbStockAllocations),
    },
    stockMovement: {
      count: vi.fn(async () => dbStockMovements.length),
    },
    auditLog: {
      create: vi.fn(async ({ data }: any) => {
        dbAuditLogs.push(data);
        return { id: `audit-${dbAuditLogs.length}`, ...data };
      }),
    },
  },
}));

import {
  generateCustomerCode,
  createCustomer,
  deactivateCustomer,
} from "@/lib/customers/customerService";

import {
  generateSalesOrderNumber,
  createSalesOrderDraft,
  updateSalesOrderDraft,
  submitSalesOrder,
  approveSalesOrder,
  startProcessingSalesOrder,
  completeSalesOrder,
  cancelSalesOrder,
} from "@/lib/sales/salesOrderService";

describe("BuildStock Phase 5A — Customer Domain Tests", () => {
  it("generates correct customer code format CUS-2026-XXXXXX", async () => {
    const code = await generateCustomerCode();
    expect(code).toMatch(/^CUS-\d{4}-\d{6}$/);
  });

  it("creates a new customer with active=true", async () => {
    const cust = await createCustomer({ name: "ABC Decoration", phone: "+966 50 123 4567" }, "user-1");
    expect(cust.name).toBe("ABC Decoration");
    expect(cust.active).toBe(true);
    expect(cust.customerCode).toMatch(/^CUS-\d{4}-\d{6}$/);
  });

  it("deactivates customer logically", async () => {
    const deactivated = await deactivateCustomer("cust-1", "user-1");
    expect(deactivated.active).toBe(false);
  });
});

describe("BuildStock Phase 5A — Sales Order Domain & Calculations", () => {
  beforeEach(() => {
    dbSalesOrders = [];
    dbAuditLogs = [];
    dbStockMovements = [];
    dbStockAllocations = [{ ...mockStockAllocation }];
  });

  it("generates correct sales order number format SO-2026-XXXXXX", async () => {
    const number = await generateSalesOrderNumber();
    expect(number).toMatch(/^SO-\d{4}-\d{6}$/);
  });

  it("blocks sales order creation for INACTIVE customers", async () => {
    await expect(
      createSalesOrderDraft(
        {
          customerId: "cust-2", // Inactive customer
          warehouseId: "wh-1",
          items: [{ productId: "prod-1", orderedQuantity: 25, unitPrice: 45 }],
        },
        "user-1"
      )
    ).rejects.toThrow(/INACTIVE/);
  });

  it("creates DRAFT sales order with product & customer snapshots and financial calculations", async () => {
    const order = await createSalesOrderDraft(
      {
        customerId: "cust-1",
        warehouseId: "wh-1",
        items: [{ productId: "prod-1", orderedQuantity: 25.5, unitPrice: 45.0, discount: 12.5 }],
        discount: 10,
        tax: 5,
      },
      "user-1"
    );

    expect(order.salesOrderNumber).toMatch(/^SO-\d{4}-\d{6}$/);
    expect(order.status).toBe("DRAFT");
    expect(order.customerNameSnapshot).toBe("ABC Decoration");
    expect(order.customerCodeSnapshot).toBe("CUS-2026-000001");
    expect(order.items[0]!.productName).toBe("Porcelain Tile 60x60");
    expect(order.items[0]!.productSku).toBe("TILE-PORC-6060");
    expect(order.items[0]!.unitSymbol).toBe("m²");
    expect(order.items[0]!.orderedQuantity).toBe(25.5);
    
    // Line total: (25.5 * 45) - 12.5 = 1147.5 - 12.5 = 1135.00
    expect(order.items[0]!.lineTotal).toBe(1135.0);
    // Order total: 1135 - 10 + 5 = 1130.00
    expect(order.total).toBe(1130.0);
  });

  it("enforces strict status transition matrix (DRAFT -> PENDING -> APPROVED -> PROCESSING -> COMPLETED)", async () => {
    const draft = await createSalesOrderDraft(
      {
        customerId: "cust-1",
        warehouseId: "wh-1",
        items: [{ productId: "prod-1", orderedQuantity: 10, unitPrice: 45 }],
      },
      "user-1"
    );

    // DRAFT -> PENDING_APPROVAL
    const pending = await submitSalesOrder(draft.id, "user-1");
    expect(pending.status).toBe("PENDING_APPROVAL");

    // PENDING_APPROVAL -> APPROVED
    const approved = await approveSalesOrder(pending.id, "user-1");
    expect(approved.status).toBe("APPROVED");
    expect(approved.approvedBy).toBe("user-1");

    // APPROVED -> PROCESSING
    const processing = await startProcessingSalesOrder(approved.id, "user-1");
    expect(processing.status).toBe("PROCESSING");

    // PROCESSING -> COMPLETED
    const completed = await completeSalesOrder(processing.id, "user-1");
    expect(completed.status).toBe("COMPLETED");

    // Cannot edit COMPLETED order
    await expect(updateSalesOrderDraft(completed.id, { notes: "Edit test" }, "user-1")).rejects.toThrow(/Only DRAFT/);

    // Cannot cancel COMPLETED order
    await expect(cancelSalesOrder(completed.id, "Reason", "user-1")).rejects.toThrow(/terminal status/);
  });
});

describe("BuildStock Phase 5A — CRITICAL STEP 35 E2E STOCK ISOLATION SCENARIO", () => {
  beforeEach(() => {
    dbSalesOrders = [];
    dbAuditLogs = [];
    dbStockMovements = [];
    dbStockAllocations = [{ id: "alloc-1", productId: "prod-1", warehouseId: "wh-1", quantity: 100.0 }];
  });

  it("verifies that ALL Sales Order operations leave StockAllocation and StockMovement EXACTLY UNCHANGED", async () => {
    const INITIAL_STOCK = 100.0;
    const ORDER_QTY = 25.0;

    // 1. Initial Stock check
    expect(dbStockAllocations[0].quantity).toBe(INITIAL_STOCK);
    expect(dbStockMovements.length).toBe(0);

    // 2. Create DRAFT Sales Order
    const so = await createSalesOrderDraft(
      {
        customerId: "cust-1",
        warehouseId: "wh-1",
        items: [{ productId: "prod-1", orderedQuantity: ORDER_QTY, unitPrice: 45.0 }],
      },
      "user-1"
    );
    expect(so.status).toBe("DRAFT");
    expect(dbStockAllocations[0].quantity).toBe(INITIAL_STOCK);
    expect(dbStockMovements.length).toBe(0);

    // 3. Submit Order -> PENDING_APPROVAL
    const pending = await submitSalesOrder(so.id, "user-1");
    expect(pending.status).toBe("PENDING_APPROVAL");
    expect(dbStockAllocations[0].quantity).toBe(INITIAL_STOCK);
    expect(dbStockMovements.length).toBe(0);

    // 4. Approve Order -> APPROVED
    const approved = await approveSalesOrder(pending.id, "user-1");
    expect(approved.status).toBe("APPROVED");
    expect(dbStockAllocations[0].quantity).toBe(INITIAL_STOCK);
    expect(dbStockMovements.length).toBe(0);

    // 5. Start Processing -> PROCESSING
    const processing = await startProcessingSalesOrder(approved.id, "user-1");
    expect(processing.status).toBe("PROCESSING");
    expect(dbStockAllocations[0].quantity).toBe(INITIAL_STOCK);
    expect(dbStockMovements.length).toBe(0);

    // 6. Complete Order -> COMPLETED
    const completed = await completeSalesOrder(processing.id, "user-1");
    expect(completed.status).toBe("COMPLETED");

    // CRITICAL ASSERTION: Physical stock remains EXACTLY 100 m² and StockMovements count remains 0!
    expect(dbStockAllocations[0].quantity).toBe(INITIAL_STOCK);
    expect(dbStockMovements.length).toBe(0);
  });
});
