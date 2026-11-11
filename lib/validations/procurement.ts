import { z } from "zod";

export const purchaseOrderItemSchema = z.object({
  productId: z.string().min(1, "Product is required"),
  unitId: z.string().optional().or(z.null()),
  orderedQuantity: z.number().positive("Ordered quantity must be greater than 0"),
  unitPrice: z.number().nonnegative("Unit price cannot be negative"),
  discount: z.number().nonnegative().optional().or(z.null()),
  tax: z.number().nonnegative().optional().or(z.null()),
});

export const createPurchaseOrderSchema = z.object({
  supplierId: z.string().min(1, "Supplier is required"),
  warehouseId: z.string().min(1, "Destination warehouse is required"),
  orderDate: z.string().optional().or(z.null()),
  expectedDeliveryDate: z.string().optional().or(z.null()),
  notes: z.string().optional().or(z.null()),
  items: z.array(purchaseOrderItemSchema).min(1, "At least one order line is required"),
});

export const updatePurchaseOrderSchema = z.object({
  supplierId: z.string().optional(),
  warehouseId: z.string().optional(),
  orderDate: z.string().optional().or(z.null()),
  expectedDeliveryDate: z.string().optional().or(z.null()),
  notes: z.string().optional().or(z.null()),
  items: z.array(purchaseOrderItemSchema).optional(),
});

export const goodsReceiptItemSchema = z.object({
  purchaseOrderItemId: z.string().min(1, "PO Item ID is required"),
  productId: z.string().min(1, "Product is required"),
  receivedQuantity: z.number().positive("Received quantity must be greater than 0"),
  unitId: z.string().optional().or(z.null()),
  destinationBinId: z.string().min(1).optional().nullable(),
  notes: z.string().optional().or(z.null()),
});

export const createGoodsReceiptSchema = z.object({
  purchaseOrderId: z.string().min(1, "Purchase Order is required"),
  notes: z.string().optional().or(z.null()),
  items: z.array(goodsReceiptItemSchema).min(1, "At least one received line is required"),
});
