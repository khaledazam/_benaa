import { describe, it, expect, beforeEach, vi } from "vitest";

const mockProduct = {
  id: "prod-tile-100",
  name: "Porcelain Floor Tile 60x60",
  sku: "TILE-PORC-100",
  barcode: "6291100123456",
  deletedAt: null,
  quantity: 500,
  reservedQuantity: 0,
};

const mockWarehouse = { id: "wh-1", name: "Main Warehouse" };
const mockAllocations = [{ id: "sa-1", productId: "prod-tile-100", warehouseId: "wh-1", quantity: 500, reservedQuantity: 50 }];

vi.mock("@/prisma/client", () => {
  return {
    prisma: {
      stockReservationItem: { findMany: vi.fn(async () => []) },
      projectMaterialIssueItem: { findMany: vi.fn(async () => []) },
      product: {
        findFirst: vi.fn(async ({ where }: any) => {
          const barcodeCond = where.OR?.find((c: any) => c.barcode === mockProduct.barcode);
          const skuCond = where.OR?.find((c: any) => c.sku === mockProduct.sku);
          if (barcodeCond || skuCond) return mockProduct;
          return null;
        }),
        findUnique: vi.fn(async ({ where }: any) => (where.id === mockProduct.id ? mockProduct : null)),
      },
      stockAllocation: {
        findMany: vi.fn(async () => mockAllocations),
      },
      warehouse: {
        findMany: vi.fn(async () => [mockWarehouse]),
      },
    },
  };
});

import { lookupProductByBarcode } from "@/lib/inventory/barcodeService";

describe("Phase 7 — Barcode Operations & Fast Lookup", () => {
  it("SCENARIO 1 — Barcode lookup succeeds by exact barcode", async () => {
    const result = await lookupProductByBarcode("6291100123456");
    expect(result).not.toBeNull();
    expect(result?.product.id).toBe(mockProduct.id);
    expect(result?.exactMatchField).toBe("barcode");
    expect(result?.totalPhysicalStock).toBe(500);
    expect(result?.totalAvailableStock).toBe(450);
  });

  it("SCENARIO 1 — Barcode lookup succeeds by SKU fallback", async () => {
    const result = await lookupProductByBarcode("TILE-PORC-100");
    expect(result).not.toBeNull();
    expect(result?.product.id).toBe(mockProduct.id);
    expect(result?.exactMatchField).toBe("sku");
  });

  it("SCENARIO 2 — Invalid barcode returns null safely", async () => {
    const result = await lookupProductByBarcode("9999999999999");
    expect(result).toBeNull();
  });

  it("SCENARIO 4 — Whitespace and carriage returns stripped safely", async () => {
    const result = await lookupProductByBarcode("  6291100123456 \r\n");
    expect(result).not.toBeNull();
    expect(result?.product.id).toBe(mockProduct.id);
  });
});
