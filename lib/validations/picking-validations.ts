import { z } from "zod";

export const createPickListSchema = z.object({
  reservationId: z.string().min(1, "Reservation ID is required"),
  assignedTo: z.string().optional(),
});

export const assignPickListSchema = z.object({
  assignedTo: z.string().min(1, "Assigned user ID is required"),
});

export const setPickAllocationsSchema = z.object({
  allocations: z.array(
    z.object({
      pickListItemId: z.string().min(1, "Pick List Item ID is required"),
      binId: z.string().min(1, "Bin ID is required"),
      requestedQuantity: z.number().positive("Requested quantity must be greater than 0"),
      pickedQuantity: z.number().min(0, "Picked quantity cannot be negative").optional(),
    })
  ).min(1, "At least one allocation is required"),
});

export const updateAllocationSchema = z.object({
  pickedQuantity: z.number().min(0, "Picked quantity cannot be negative"),
});

export const completePickListSchema = z.object({
  allowShort: z.boolean().optional().default(false),
});

export const cancelPickListSchema = z.object({
  reason: z.string().optional(),
});

export type CreatePickListInput = z.infer<typeof createPickListSchema>;
export type AssignPickListInput = z.infer<typeof assignPickListSchema>;
export type SetPickAllocationsInput = z.infer<typeof setPickAllocationsSchema>;
export type UpdateAllocationInput = z.infer<typeof updateAllocationSchema>;
export type CompletePickListInput = z.infer<typeof completePickListSchema>;
export type CancelPickListInput = z.infer<typeof cancelPickListSchema>;
