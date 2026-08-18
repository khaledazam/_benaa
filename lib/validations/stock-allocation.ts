/**
 * BuildStock Allocation & Transfer Validation Schemas
 */

import { z } from "zod";

export const createStockAllocationSchema = z.object({
  productId: z.string().min(1, "Product is required"),
  warehouseId: z.string().min(1, "Warehouse is required"),
  quantity: z.number().min(0, "Quantity must be 0 or more"),
  unitId: z.string().optional(),
});

export const updateStockAllocationSchema = z.object({
  quantity: z.number().min(0, "Quantity must be 0 or more").optional(),
  unitId: z.string().optional(),
});

export const createStockTransferSchema = z.object({
  productId: z.string().min(1, "Product is required"),
  fromWarehouseId: z.string().min(1, "Source warehouse is required"),
  toWarehouseId: z.string().min(1, "Destination warehouse is required"),
  quantity: z.number().positive("Quantity must be greater than 0"),
  unitId: z.string().optional(),
  notes: z.string().max(500).optional(),
});

export type CreateStockAllocationFormData = z.infer<
  typeof createStockAllocationSchema
>;
export type UpdateStockAllocationFormData = z.infer<
  typeof updateStockAllocationSchema
>;
export type CreateStockTransferFormData = z.infer<
  typeof createStockTransferSchema
>;
