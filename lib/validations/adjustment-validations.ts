import { z } from "zod";

export const adjustmentItemSchema = z.object({
  productId: z.string().min(1, "Product is required"),
  binId: z.string().optional().nullable(),
  unitId: z.string().optional().nullable(),
  unitSymbol: z.string().optional().nullable(),
  systemQuantity: z.number().min(0, "System quantity cannot be negative"),
  adjustmentQuantity: z.number().refine((val) => val !== 0, {
    message: "Adjustment quantity cannot be zero",
  }),
  resultingQuantity: z.number().min(0, "Resulting quantity cannot be negative"),
  reason: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

export const createAdjustmentSchema = z.object({
  warehouseId: z.string().min(1, "Warehouse is required"),
  reason: z.string().min(1, "Reason is required"),
  adjustmentType: z.enum([
    "ADJUSTMENT_IN",
    "ADJUSTMENT_OUT",
    "DAMAGE",
    "LOSS",
    "EXPIRY",
    "FOUND",
    "CORRECTION",
  ]),
  notes: z.string().optional().nullable(),
  items: z.array(adjustmentItemSchema).min(1, "At least one adjustment item is required"),
});

export const updateAdjustmentSchema = createAdjustmentSchema.partial();

export const cancelAdjustmentSchema = z.object({
  reason: z.string().min(1, "Cancellation reason is required"),
});

export const rejectAdjustmentSchema = z.object({
  reason: z.string().min(1, "Rejection reason is required"),
});

export type CreateAdjustmentInput = z.infer<typeof createAdjustmentSchema>;
export type UpdateAdjustmentInput = z.infer<typeof updateAdjustmentSchema>;
