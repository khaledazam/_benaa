import { z } from "zod";

export const countItemRecordSchema = z.object({
  productId: z.string().min(1, "Product is required"),
  binId: z.string().optional().nullable(),
  countedQuantity: z.number().min(0, "Counted quantity cannot be negative"),
  notes: z.string().optional().nullable(),
});

export const createCountSchema = z.object({
  warehouseId: z.string().min(1, "Warehouse is required"),
  scopeType: z.enum([
    "WAREHOUSE",
    "ZONE",
    "RACK",
    "SHELF",
    "BIN",
    "PRODUCT",
    "CATEGORY",
    "HIGH_VALUE",
    "LOW_STOCK",
  ]),
  scopeId: z.string().optional().nullable(),
  countMode: z.enum(["OPEN_COUNT", "BLIND_COUNT"]).optional(),
  notes: z.string().optional().nullable(),
});

export const recordCountItemsSchema = z.object({
  items: z.array(countItemRecordSchema).min(1, "At least one item count is required"),
});

export type CreateCountInput = z.infer<typeof createCountSchema>;
export type RecordCountItemsInput = z.infer<typeof recordCountItemsSchema>;
