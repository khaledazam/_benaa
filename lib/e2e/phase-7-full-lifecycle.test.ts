import { describe, it, expect, beforeEach, vi } from "vitest";

const mockUser = { id: "user-mgr", name: "Manager", username: "mgr", role: "WAREHOUSE_MANAGER" };
const mockWarehouse = { id: "wh-main", name: "Main Construction Yard", code: "WH-MAIN" };
const mockBin = { id: "bin-b1", code: "BIN-B1", warehouseId: "wh-main", active: true, locationPath: "Zone B / B1" };

const mockProductCement = {
  id: "prod-cement-50",
  name: "Portland Cement 50kg Bag",
  sku: "CEM-PORT-50",
  barcode: "6297000112233",
  trackingMode: "BATCH",
  price: 25.0,
  unitId: "unit-bag",
  quantity: 0,
  minimumStock: 20,
};

let dbStockAllocations: any[] = [];
let dbStockLocationAllocations: any[] = [];
let dbStockMovements: any[] = [];
let dbBatches: any[] = [];
let dbProducts: any[] = [];

vi.mock("@/prisma/client", () => {
  const mockTx = {
    // Explicit fixture tables for the authoritative availability/unit contract.
    unit: { findUnique: vi.fn(async ({ where }: any) => [{ id: "unit-bag", active: true, type: "count" }].find(u => u.id === where.id) || null) },
    projectMaterialIssueItem: { findMany: vi.fn(async () => []) },
    stockReservationItem: { findMany: vi.fn(async () => []) },

    user: { findUnique: vi.fn(async () => mockUser) },
    warehouse: { findUnique: vi.fn(async () => mockWarehouse), findMany: vi.fn(async () => [mockWarehouse]) },
    warehouseBin: { findUnique: vi.fn(async () => mockBin) },
    product: {
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
      findMany: vi.fn(async () => dbStockLocationAllocations.map((sla) => ({ ...sla, product: mockProductCement, bin: mockBin }))),
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
          if (data.status) b.status = data.status;
        }
        return b;
      }),
    },
    stockReservation: { findMany: vi.fn(async () => []) },
    pickList: { findMany: vi.fn(async () => []) },
    dispatch: { findMany: vi.fn(async () => []) },
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
import { createOrUpdateBatchOnReceiptInTx, deductBatchQuantityInTx, getBatchSuggestions } from "@/lib/inventory/batchService";
import { executeStockMutation, executeStockMutationInTx, BATCH_MANAGED_IN_TX, StockMovementTypes } from "@/lib/inventory/stockService";
import { reconcileProductWarehouse } from "@/lib/inventory/reconciliationService";

describe("Phase 7 â€” Full End-to-End Lifecycle Scenario 36", () => {
  beforeEach(() => {
    dbStockAllocations = [];
    dbStockLocationAllocations = [];
    dbStockMovements = [];
    dbBatches = [];
    dbProducts = [JSON.parse(JSON.stringify(mockProductCement))];
  });

  it("Executes full Phase 7 E2E: Barcode -> GRN Receipt -> Batch -> Suggestion -> Dispatch -> Reconciliation", async () => {
    // 1. BARCODE LOOKUP
    const barcodeLookup = await lookupProductByBarcode("6297000112233");
    expect(barcodeLookup?.product.id).toBe(mockProductCement.id);

    // 2. GOODS RECEIPT (POST) -> Physical stock +200 & Batch Creation
    const batch = await prisma.$transaction(async (tx: any) => {
    const received = await createOrUpdateBatchOnReceiptInTx(tx, {
      productId: mockProductCement.id,
      warehouseId: mockWarehouse.id,
      batchNumber: "BAT-GRN-1001",
      quantity: 200,
      expiryDate: new Date("2027-01-01"),
    });
    await executeStockMutationInTx(tx, {
      batchId: received.id, batchAccounting: BATCH_MANAGED_IN_TX,
      productId: mockProductCement.id,
      warehouseId: mockWarehouse.id,
      binId: mockBin.id,
      quantity: 200,
      movementType: StockMovementTypes.PURCHASE,
      performedBy: mockUser.id,
    });
      return received;
    });

    expect(dbStockAllocations[0].quantity).toBe(200);
    expect(batch.quantity).toBe(200);

    // 3. FEFO BATCH SUGGESTION
    const suggestions = await getBatchSuggestions({
      productId: mockProductCement.id,
      warehouseId: mockWarehouse.id,
      requiredQuantity: 50,
    });
    const purchaseMov = dbStockMovements.find(m => m.movementType === StockMovementTypes.PURCHASE);
    expect(purchaseMov?.quantity).toBe(200);
    expect(suggestions.length).toBe(1);
    expect(suggestions?.[0]?.suggestedQuantity).toBe(50);
    expect(suggestions?.[0]?.batchNumber).toBe("BAT-GRN-1001");

    // 4. DISPATCH (POST) -> Deducts 50 physical stock & 50 batch quantity
    await prisma.$transaction(async (tx: any) => {
    await executeStockMutationInTx(tx, {
      batchId: batch.id,
      productId: mockProductCement.id,
      warehouseId: mockWarehouse.id,
      binId: mockBin.id,
      quantity: 50,
      movementType: StockMovementTypes.SALE,
      performedBy: mockUser.id,
    });
    });

    expect(dbStockAllocations[0].quantity).toBe(150);
    expect(batch.quantity).toBe(150);

    // 5. RECONCILIATION AUDIT -> HEALTHY status
    const recon = await reconcileProductWarehouse(mockProductCement.id, mockWarehouse.id);
    expect(recon.physicalStock).toBe(150);
    expect(recon.discrepancies.length).toBe(0);
    expect(recon.status).toBe("HEALTHY");
  });
});
