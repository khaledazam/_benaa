import { describe, expect, it } from "vitest";
import {
  createProductBodySchema,
  updateProductBodySchema,
  generateProductQrCodeBodySchema,
} from "./product";

const validCreatePayload = {
  name: "Widget",
  sku: "WDG-001",
  price: 9.99,
  quantity: 10,
  status: "Available" as const,
  categoryId: "507f1f77bcf86cd799439011",
  supplierId: "507f1f77bcf86cd799439012",
};

describe("createProductBodySchema", () => {
  it("accepts a valid payload", () => {
    const result = createProductBodySchema.safeParse(validCreatePayload);
    expect(result.success).toBe(true);
  });

  it("rejects empty categoryId", () => {
    const result = createProductBodySchema.safeParse({
      ...validCreatePayload,
      categoryId: "",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((e) => e.path.includes("categoryId"))).toBe(
        true,
      );
    }
  });

  it("rejects invalid SKU characters", () => {
    const result = createProductBodySchema.safeParse({
      ...validCreatePayload,
      sku: "bad sku!",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((e) => e.path.includes("sku"))).toBe(true);
    }
  });
});

describe("updateProductBodySchema", () => {
  it("requires id", () => {
    const result = updateProductBodySchema.safeParse({
      name: "Updated",
    });
    expect(result.success).toBe(false);
  });

  it("accepts partial updates with id", () => {
    const result = updateProductBodySchema.safeParse({
      id: "507f1f77bcf86cd799439011",
      name: "Updated",
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty categoryId when provided", () => {
    const result = updateProductBodySchema.safeParse({
      id: "507f1f77bcf86cd799439011",
      categoryId: "",
    });
    expect(result.success).toBe(false);
  });
});

describe("generateProductQrCodeBodySchema", () => {
  it("requires productId", () => {
    expect(generateProductQrCodeBodySchema.safeParse({}).success).toBe(false);
  });

  it("accepts valid productId", () => {
    expect(
      generateProductQrCodeBodySchema.safeParse({
        productId: "507f1f77bcf86cd799439011",
      }).success,
    ).toBe(true);
  });
});
