import { z } from "zod";

export const createDispatchSchema = z.object({
  pickListId: z.string().min(1, "Pick List ID is required"),
  notes: z.string().optional(),
});

export const cancelDispatchSchema = z.object({
  reason: z.string().min(1, "Cancellation reason is required"),
});

export const getDispatchesQuerySchema = z.object({
  search: z.string().optional(),
  status: z.enum(["DRAFT", "POSTED", "CANCELLED"]).optional(),
  warehouseId: z.string().optional(),
  salesOrderId: z.string().optional(),
  pickListId: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sortBy: z.enum(["dispatchNumber", "createdAt", "status"]).default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

export type CreateDispatchInput = z.infer<typeof createDispatchSchema>;
export type CancelDispatchInput = z.infer<typeof cancelDispatchSchema>;
export type GetDispatchesQuery = z.infer<typeof getDispatchesQuerySchema>;
