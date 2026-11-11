/**
 * BuildStock Product Validation Schemas
 */

import { z } from "zod";
import type { ProductStatus } from "@/types";
import { calculateStockStatus } from "@/lib/inventory/stock-status";

const productSkuSchema = z
  .string()
  .min(1, "SKU is required")
  .regex(/^[a-zA-Z0-9-_]+$/, "SKU must be alphanumeric");

const productApiNameSchema = z
  .string()
  .min(1, "Product name is required")
  .max(100, "Product name must be 100 characters or less");

const productStatusSchema = z.string();

const optionalImageUrlSchema = z
  .string()
  .url("Invalid image URL")
  .optional()
  .or(z.literal(""));

const optionalExpirationDateSchema = z
  .string()
  .optional()
  .or(z.literal(""))
  .or(z.null());

/**
 * Product form validation schema
 */
export const productSchema = z.object({
  productName: productApiNameSchema,
  sku: productSkuSchema,
  barcode: z.string().optional().or(z.literal("")),
  brandId: z.string().optional().or(z.literal("")),
  brandName: z.string().optional().or(z.literal("")),
  subcategoryId: z.string().optional().or(z.literal("")),
  model: z.string().optional().or(z.literal("")),
  size: z.string().optional().or(z.literal("")),
  color: z.string().optional().or(z.literal("")),
  material: z.string().optional().or(z.literal("")),
  weight: z.number().nonnegative().optional().or(z.null()),
  quantity: z.preprocess(
    (val) => {
      if (val === "" || val === null || val === undefined) return 0;
      const num = typeof val === "string" ? Number(val) : val;
      return isNaN(num as number) ? 0 : num;
    },
    z.number().nonnegative("Quantity cannot be negative")
  ),
  price: z.preprocess(
    (val) => {
      if (val === "" || val === null || val === undefined) return 0;
      const num = typeof val === "string" ? Number(val) : val;
      return isNaN(num as number) ? 0 : num;
    },
    z.number().nonnegative("Price cannot be negative")
  ),
  purchasePrice: z.number().nonnegative().optional().or(z.null()),
  wholesalePrice: z.number().nonnegative().optional().or(z.null()),
  retailPrice: z.number().nonnegative().optional().or(z.null()),
  minimumStock: z.number().nonnegative().optional().or(z.null()),
  maximumStock: z.number().nonnegative().optional().or(z.null()),
  unitId: z.string().optional().or(z.literal("")),
  purchaseUnitId: z.string().optional().or(z.literal("")),
  saleUnitId: z.string().optional().or(z.literal("")),
  imageUrl: optionalImageUrlSchema,
  imageFileId: z.string().optional(),
  expirationDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date format. Use YYYY-MM-DD format")
    .optional()
    .or(z.literal("")),
});

export type ProductFormData = z.infer<typeof productSchema>;

export const productFormSubmitSchema = productSchema.extend({
  categoryId: z.string().min(1, "Category is required"),
  supplierId: z.string().min(1, "Supplier is required"),
});

/**
 * API request body for POST /api/products
 */
export const createProductBodySchema = z.object({
  name: productApiNameSchema,
  sku: productSkuSchema,
  barcode: z.string().optional(),
  brandId: z.string().optional(),
  brandName: z.string().optional(),
  subcategoryId: z.string().optional(),
  model: z.string().optional(),
  size: z.string().optional(),
  color: z.string().optional(),
  material: z.string().optional(),
  weight: z.number().nonnegative().optional(),
  dimensions: z.any().optional(),
  price: z.number().nonnegative("Price cannot be negative"),
  purchasePrice: z.number().nonnegative().optional(),
  wholesalePrice: z.number().nonnegative().optional(),
  retailPrice: z.number().nonnegative().optional(),
  quantity: z.number().nonnegative("Quantity cannot be negative"),
  minimumStock: z.number().nonnegative().optional(),
  maximumStock: z.number().nonnegative().optional(),
  purchaseUnitId: z.string().optional(),
  saleUnitId: z.string().optional(),
  status: productStatusSchema.optional(),
  categoryId: z.string().min(1, "Category is required"),
  supplierId: z.string().min(1, "Supplier is required"),
  unitId: z.string().regex(/^[a-f0-9]{24}$/i, "Registered base unit is required").optional().nullable(),
  imageUrl: optionalImageUrlSchema.optional(),
  imageFileId: z.string().optional(),
  expirationDate: optionalExpirationDateSchema.optional(),
});

export const createProductSchema = createProductBodySchema.extend({
  userId: z.string().min(1),
});

/**
 * API request body for PUT /api/products
 */
export const updateProductBodySchema = z.object({
  id: z.string().min(1, "Product ID is required"),
  name: productApiNameSchema.optional(),
  sku: productSkuSchema.optional(),
  barcode: z.string().optional(),
  brandId: z.string().optional(),
  brandName: z.string().optional(),
  subcategoryId: z.string().optional(),
  model: z.string().optional(),
  size: z.string().optional(),
  color: z.string().optional(),
  material: z.string().optional(),
  weight: z.number().nonnegative().optional(),
  dimensions: z.any().optional(),
  price: z.number().nonnegative("Price cannot be negative").optional(),
  purchasePrice: z.number().nonnegative().optional(),
  wholesalePrice: z.number().nonnegative().optional(),
  retailPrice: z.number().nonnegative().optional(),
  quantity: z.number().nonnegative("Quantity cannot be negative").optional(),
  minimumStock: z.number().nonnegative().optional(),
  maximumStock: z.number().nonnegative().optional(),
  unitId: z.string().optional(),
  purchaseUnitId: z.string().optional(),
  saleUnitId: z.string().optional(),
  status: productStatusSchema.optional(),
  categoryId: z.string().min(1, "Category is required").optional(),
  supplierId: z.string().min(1, "Supplier is required").optional(),
  imageUrl: optionalImageUrlSchema.optional(),
  imageFileId: z.string().optional(),
  expirationDate: optionalExpirationDateSchema.optional(),
});

export const updateProductSchema = updateProductBodySchema;

export const generateProductQrCodeBodySchema = z.object({
  productId: z.string().min(1, "Product ID is required"),
});

/**
 * Dynamic calculation of product status using per-product minimumStock.
 */
export const calculateProductStatus = (
  quantity: number,
  minimumStock: number = 0,
  maximumStock?: number | null
): ProductStatus | string => {
  const status = calculateStockStatus(quantity, minimumStock, maximumStock);
  
  if (status === "OUT_OF_STOCK") return "Stock Out";
  if (status === "LOW_STOCK") return "Stock Low";
  return "Available";
};
