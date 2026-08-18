import { describe, it, expect, beforeEach, vi } from "vitest";

const mockProductTracked = {
  id: "prod-cement",
  name: "Portland Cement 50kg",
  sku: "CEM-PORT-50",
  trackingMode: "BATCH",
  expirationDate: null,
};

const mockProductUntracked = {
  id: "prod-pipe",
  name: "PVC Pipe 110mm",
  sku: "PIPE-PVC-110",
  trackingMode: "NONE",
};

let dbBatches: any[] = [];

vi.mock("@/prisma/client", () => {
  const mockTx = {
    product: {
      findUnique: vi.fn(async ({ where }: any) => {
        if (where.id === mockProductTracked.id) return mockProductTracked;
        if (where.id === mockProductUntracked.id) return mockProductUntracked;
        return null;
      }),
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
      findMany: vi.fn(async ({ where }: any) => {
        return dbBatches.filter((b) => {
          const matchProd = !where.productId || b.productId === where.productId;
          const matchWh = !where.warehouseId || b.warehouseId === where.warehouseId;
          const matchStatus = !where.status || b.status === where.status;
          return matchProd && matchWh && matchStatus;
        });
      }),
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
  };

  return {
    prisma: {
      ...mockTx,
      $transaction: vi.fn(async (cb: any) => cb(mockTx)),
    },
  };
});

import { prisma } from "@/prisma/client";
import {
  createOrUpdateBatchOnReceiptInTx,
  deductBatchQuantityInTx,
  getBatchSuggestions,
} from "@/lib/inventory/batchService";

describe("Phase 7 — Batch / Lot / Heat Tracking & FEFO/FIFO", () => {
  beforeEach(() => {
    dbBatches = [];
  });

  it("SCENARIO 5 & 6 — Batch creation during GRN POST matches received quantity", async () => {
    const batch = await createOrUpdateBatchOnReceiptInTx(prisma as any, {
      productId: mockProductTracked.id,
      warehouseId: "wh-main",
      batchNumber: "BAT-2026-001",
      quantity: 100,
    });

    expect(batch.batchNumber).toBe("BAT-2026-001");
    expect(batch.quantity).toBe(100);
    expect(batch.status).toBe("ACTIVE");
  });

  it("SCENARIO 7 — Batch cannot go negative on deduction", async () => {
    const batch = await createOrUpdateBatchOnReceiptInTx(prisma as any, {
      productId: mockProductTracked.id,
      warehouseId: "wh-main",
      batchNumber: "BAT-2026-001",
      quantity: 50,
    });

    await expect(
      deductBatchQuantityInTx(prisma as any, batch.id, 100)
    ).rejects.toThrow("Insufficient available stock in batch");
  });

  it("SCENARIO 11 & 12 — FEFO/FIFO suggestions", async () => {
    // Batch A: Expiring early (2026-10-01)
    await createOrUpdateBatchOnReceiptInTx(prisma as any, {
      productId: mockProductTracked.id,
      warehouseId: "wh-main",
      batchNumber: "BAT-EARLY",
      expiryDate: new Date("2026-10-01"),
      quantity: 40,
    });

    // Batch B: Expiring late (2026-12-31)
    await createOrUpdateBatchOnReceiptInTx(prisma as any, {
      productId: mockProductTracked.id,
      warehouseId: "wh-main",
      batchNumber: "BAT-LATE",
      expiryDate: new Date("2026-12-31"),
      quantity: 60,
    });

    const suggestions = await getBatchSuggestions({
      productId: mockProductTracked.id,
      warehouseId: "wh-main",
      requiredQuantity: 50,
    });

    expect(suggestions.length).toBe(2);
    expect(suggestions?.[0]?.batchNumber).toBe("BAT-EARLY"); // FEFO order
    expect(suggestions?.[0]?.suggestedQuantity).toBe(40);
    expect(suggestions?.[1]?.batchNumber).toBe("BAT-LATE");
    expect(suggestions?.[1]?.suggestedQuantity).toBe(10);
  });
});
