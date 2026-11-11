import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/prisma/client", () => ({ prisma: {
  category: { findMany: vi.fn(async () => []) },
  supplier: { findMany: vi.fn(async () => []) },
  user: { findMany: vi.fn(async () => []) },
} }));
import { prisma } from "@/prisma/client";
import { loadProductListPartyMaps, productListPartyFields } from "./product-list-party";

describe("uncategorized product presentation", () => {
  beforeEach(() => vi.clearAllMocks());
  it("does not query categories when every product has no category", async () => {
    const product = { categoryId: null, supplierId: "supplier", userId: "owner" };
    const maps = await loadProductListPartyMaps([product]);
    expect(prisma.category.findMany).not.toHaveBeenCalled();
    expect(productListPartyFields(product, maps).category).toBe("Unknown");
  });
  it("excludes absent categories from a mixed batch lookup", async () => {
    await loadProductListPartyMaps([
      { categoryId: null, supplierId: "supplier", userId: "owner" },
      { categoryId: "category", supplierId: "supplier", userId: "owner" },
    ]);
    expect(prisma.category.findMany).toHaveBeenCalledWith({ where: { id: { in: ["category"] } }, select: { id: true, name: true } });
  });
});
