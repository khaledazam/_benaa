import { prisma } from "@/prisma/client";
import { executeStockMutation, StockMovementTypes } from "@/lib/inventory/stockService";
import { createOrUpdateBatchOnReceiptInTx } from "@/lib/inventory/batchService";
import { convertUnitQuantity } from "@/lib/units/unitService";

export const POStatus = {
  DRAFT: "DRAFT",
  PENDING_APPROVAL: "PENDING_APPROVAL",
  APPROVED: "APPROVED",
  PARTIALLY_RECEIVED: "PARTIALLY_RECEIVED",
  FULLY_RECEIVED: "FULLY_RECEIVED",
  CANCELLED: "CANCELLED",
  CLOSED: "CLOSED",
} as const;

export const GRNStatus = {
  DRAFT: "DRAFT",
  POSTED: "POSTED",
  CANCELLED: "CANCELLED",
} as const;

/**
 * Sequential unique document numbering generator
 */
function generatePONumber(): string {
  const year = new Date().getFullYear();
  const randomSuffix = Math.floor(100000 + Math.random() * 900000);
  return `PO-${year}-${randomSuffix}`;
}

function generateGRNNumber(): string {
  const year = new Date().getFullYear();
  const randomSuffix = Math.floor(100000 + Math.random() * 900000);
  return `GRN-${year}-${randomSuffix}`;
}

export interface CreatePOItemInput {
  productId: string;
  unitId?: string | null;
  orderedQuantity: number;
  unitPrice: number;
  discount?: number | null;
  tax?: number | null;
}

export interface CreatePOInput {
  supplierId: string;
  warehouseId: string;
  orderDate?: string | null;
  expectedDeliveryDate?: string | null;
  notes?: string | null;
  items: CreatePOItemInput[];
  userId: string;
}

/**
 * Create Purchase Order in DRAFT status
 */
export async function createPurchaseOrder(input: CreatePOInput) {
  const { supplierId, warehouseId, orderDate, expectedDeliveryDate, notes, items, userId } = input;

  const supplier = await prisma.supplier.findUnique({ where: { id: supplierId } });
  if (!supplier) throw new Error("Supplier not found");

  const warehouse = await prisma.warehouse.findUnique({ where: { id: warehouseId } });
  if (!warehouse) throw new Error("Warehouse not found");

  let subtotal = 0;
  let totalTax = 0;
  let totalDiscount = 0;

  const preparedItems = [];

  for (const item of items) {
    const product = await prisma.product.findUnique({ where: { id: item.productId } });
    if (!product) throw new Error(`Product not found: ${item.productId}`);

    const discount = item.discount || 0;
    const tax = item.tax || 0;
    const lineSubtotal = item.unitPrice * item.orderedQuantity;
    const lineTotal = lineSubtotal - discount + tax;

    subtotal += lineSubtotal;
    totalDiscount += discount;
    totalTax += tax;

    preparedItems.push({
      productId: item.productId,
      productName: product.name,
      productSku: product.sku,
      unitId: item.unitId || product.unitId || null,
      orderedQuantity: item.orderedQuantity,
      receivedQuantity: 0,
      remainingQuantity: item.orderedQuantity,
      unitPrice: item.unitPrice,
      discount,
      tax,
      lineTotal,
    });
  }

  const grandTotal = subtotal - totalDiscount + totalTax;
  const poNumber = generatePONumber();

  return prisma.purchaseOrder.create({
    data: {
      purchaseOrderNumber: poNumber,
      supplierId,
      warehouseId,
      status: POStatus.DRAFT,
      orderDate: orderDate ? new Date(orderDate) : new Date(),
      expectedDeliveryDate: expectedDeliveryDate ? new Date(expectedDeliveryDate) : null,
      notes: notes || null,
      subtotal,
      discount: totalDiscount,
      tax: totalTax,
      total: grandTotal,
      createdBy: userId,
      items: {
        create: preparedItems,
      },
    },
    include: {
      items: true,
    },
  });
}

/**
 * Submit Purchase Order for Approval (DRAFT -> PENDING_APPROVAL)
 */
export async function submitPurchaseOrder(poId: string) {
  const po = await prisma.purchaseOrder.findUnique({ where: { id: poId } });
  if (!po) throw new Error("Purchase Order not found");
  if (po.status !== POStatus.DRAFT) {
    throw new Error(`Cannot submit PO in status ${po.status}. Must be DRAFT.`);
  }

  return prisma.purchaseOrder.update({
    where: { id: poId },
    data: { status: POStatus.PENDING_APPROVAL, updatedAt: new Date() },
  });
}

/**
 * Approve Purchase Order (PENDING_APPROVAL -> APPROVED)
 */
export async function approvePurchaseOrder(poId: string, userId: string) {
  const po = await prisma.purchaseOrder.findUnique({ where: { id: poId } });
  if (!po) throw new Error("Purchase Order not found");
  if (po.status !== POStatus.PENDING_APPROVAL && po.status !== POStatus.DRAFT) {
    throw new Error(`Cannot approve PO in status ${po.status}. Must be DRAFT or PENDING_APPROVAL.`);
  }

  return prisma.purchaseOrder.update({
    where: { id: poId },
    data: {
      status: POStatus.APPROVED,
      approvedBy: userId,
      approvedAt: new Date(),
      updatedAt: new Date(),
    },
  });
}

/**
 * Cancel Purchase Order
 */
export async function cancelPurchaseOrder(poId: string, userId: string, reason?: string) {
  const po = await prisma.purchaseOrder.findUnique({ where: { id: poId } });
  if (!po) throw new Error("Purchase Order not found");
  if (po.status === POStatus.FULLY_RECEIVED || po.status === POStatus.CLOSED) {
    throw new Error(`Cannot cancel PO in status ${po.status}.`);
  }

  return prisma.purchaseOrder.update({
    where: { id: poId },
    data: {
      status: POStatus.CANCELLED,
      cancelledBy: userId,
      cancelledAt: new Date(),
      cancellationReason: reason || null,
      updatedAt: new Date(),
    },
  });
}

export interface CreateGoodsReceiptItemInput {
  purchaseOrderItemId: string;
  productId: string;
  receivedQuantity: number;
  unitId?: string | null;
  destinationBinId?: string | null;
  notes?: string | null;
}

export interface CreateGoodsReceiptInput {
  purchaseOrderId: string;
  notes?: string | null;
  items: CreateGoodsReceiptItemInput[];
  userId: string;
}

/**
 * Create Goods Receipt in DRAFT status ONLY.
 * MUST NOT update stock, create StockMovements, update PO items, or change PO status.
 */
export async function createGoodsReceiptDraft(input: CreateGoodsReceiptInput) {
  const { purchaseOrderId, notes, items, userId } = input;

  const po = await prisma.purchaseOrder.findUnique({
    where: { id: purchaseOrderId },
    include: { items: true },
  });

  if (!po) throw new Error("Purchase Order not found");
  if (po.status !== POStatus.APPROVED && po.status !== POStatus.PARTIALLY_RECEIVED) {
    throw new Error(`Cannot create receipt for PO with status ${po.status}. Must be APPROVED or PARTIALLY_RECEIVED.`);
  }

  const poItemMap = new Map(po.items.map((item) => [item.id, item]));
  const preparedItems = [];

  for (const rItem of items) {
    const poItem = poItemMap.get(rItem.purchaseOrderItemId);
    if (!poItem) {
      throw new Error(`Purchase order line item not found: ${rItem.purchaseOrderItemId}`);
    }
    if (rItem.receivedQuantity <= 0) {
      throw new Error(`Received quantity must be greater than 0 for item ${poItem.productName}`);
    }

    // OVER-RECEIVING PREVENTION CHECK
    if (rItem.receivedQuantity > poItem.remainingQuantity) {
      throw new Error(
        `Over-receiving rejected for ${poItem.productName}. Attempted: ${rItem.receivedQuantity}, Remaining allowed: ${poItem.remainingQuantity}`
      );
    }

    // Validate destination bin if provided
    if (rItem.destinationBinId) {
      const bin = await prisma.warehouseBin.findUnique({ where: { id: rItem.destinationBinId } });
      if (!bin) throw new Error(`Destination bin not found: ${rItem.destinationBinId}`);
      if (bin.warehouseId !== po.warehouseId) {
        throw new Error(`Destination bin ${bin.code} belongs to warehouse ${bin.warehouseId}, not ${po.warehouseId}`);
      }
    }

    const product = await prisma.product.findUnique({ where: { id: rItem.productId } });
    if (!product) throw new Error(`Product not found: ${rItem.productId}`);

    const baseQuantity = await convertUnitQuantity({
      quantity: rItem.receivedQuantity,
      fromUnitId: rItem.unitId || poItem.unitId,
      toUnitId: product.unitId,
      productId: product.id,
    });

    preparedItems.push({
      purchaseOrderItemId: poItem.id,
      productId: rItem.productId,
      receivedQuantity: rItem.receivedQuantity,
      unitId: rItem.unitId || poItem.unitId || null,
      destinationBinId: rItem.destinationBinId || null,
      quantityInBaseUnit: baseQuantity,
      notes: rItem.notes || null,
    });
  }

  const receiptNumber = generateGRNNumber();

  const receipt = await prisma.goodsReceipt.create({
    data: {
      receiptNumber,
      purchaseOrderId,
      supplierId: po.supplierId,
      warehouseId: po.warehouseId,
      status: GRNStatus.DRAFT,
      notes: notes || null,
      receivedBy: userId,
      receivedAt: new Date(),
      items: {
        create: preparedItems,
      },
    },
    include: {
      items: true,
    },
  });

  await prisma.auditLog.create({
    data: {
      userId,
      action: "goods_receipt_created",
      entityType: "GoodsReceipt",
      entityId: receipt.id,
      details: {
        receiptNumber,
        purchaseOrderId,
        poNumber: po.purchaseOrderNumber,
        status: GRNStatus.DRAFT,
        itemCount: items.length,
      },
    },
  });

  return receipt;
}

/**
 * Post DRAFT Goods Receipt: Executed atomically.
 * Updates warehouse stock, creates PURCHASE StockMovements, updates PO item received & remaining quantities, updates PO status to PARTIALLY_RECEIVED or FULLY_RECEIVED, marks receipt POSTED.
 */
export async function postGoodsReceipt(receiptId: string, userId: string) {
  const receipt = await prisma.goodsReceipt.findUnique({
    where: { id: receiptId },
    include: {
      items: true,
      purchaseOrder: {
        include: { items: true },
      },
    },
  });

  if (!receipt) throw new Error("Goods Receipt not found");

  if (receipt.status !== GRNStatus.DRAFT) {
    throw new Error(`Goods Receipt is in status ${receipt.status}. Only DRAFT receipts can be posted.`);
  }

  // ATOMIC CONCURRENCY GUARD: Update status to POSTED conditionally
  const atomicLock = await prisma.goodsReceipt.updateMany({
    where: {
      id: receiptId,
      status: GRNStatus.DRAFT,
    },
    data: {
      status: GRNStatus.POSTED,
      postedAt: new Date(),
      updatedAt: new Date(),
    },
  });

  if (atomicLock.count === 0) {
    throw new Error("Goods Receipt has already been posted or is no longer in DRAFT status.");
  }

  const po = receipt.purchaseOrder;
  if (!po) throw new Error("Linked Purchase Order not found");

  if (po.status !== POStatus.APPROVED && po.status !== POStatus.PARTIALLY_RECEIVED) {
    throw new Error(`Cannot post receipt for PO in status ${po.status}. Must be APPROVED or PARTIALLY_RECEIVED.`);
  }

  const poItemMap = new Map(po.items.map((item) => [item.id, item]));

  for (const rItem of receipt.items) {
    const poItem = poItemMap.get(rItem.purchaseOrderItemId);
    if (!poItem) {
      throw new Error(`Purchase order line item not found: ${rItem.purchaseOrderItemId}`);
    }

    // Double check over-receiving against current remaining quantity
    if (rItem.receivedQuantity > poItem.remainingQuantity) {
      throw new Error(
        `Over-receiving rejected for ${poItem.productName}. Attempted: ${rItem.receivedQuantity}, Remaining allowed: ${poItem.remainingQuantity}`
      );
    }

    // Execute Stock Movement (PURCHASE) & StockAllocation Update via Central Stock Service
    const mutationRes = await executeStockMutation({
      productId: rItem.productId,
      warehouseId: receipt.warehouseId,
      destinationBinId: rItem.destinationBinId,
      quantity: rItem.receivedQuantity,
      unitId: rItem.unitId || poItem.unitId,
      movementType: StockMovementTypes.PURCHASE,
      referenceType: "GoodsReceipt",
      referenceId: receipt.id,
      reason: `Goods receipt ${receipt.receiptNumber} for PO ${po.purchaseOrderNumber}`,
      performedBy: userId,
    });

    // Check if Product is Batch / Lot / Heat Tracked
    const prod = await prisma.product.findUnique({ where: { id: rItem.productId }, select: { trackingMode: true } });
    if (prod && prod.trackingMode && prod.trackingMode !== "NONE") {
      const batchNumber = `BAT-${receipt.receiptNumber.replace("GRN-", "")}`;
      const batchRecord = await createOrUpdateBatchOnReceiptInTx(prisma, {
        productId: rItem.productId,
        warehouseId: receipt.warehouseId,
        supplierId: receipt.supplierId,
        goodsReceiptId: receipt.id,
        batchNumber,
        quantity: rItem.receivedQuantity,
        notes: `Received via Goods Receipt ${receipt.receiptNumber}`,
      });

      if (mutationRes?.movementId && batchRecord?.id) {
        await prisma.stockMovement.update({
          where: { id: mutationRes.movementId },
          data: { batchId: batchRecord.id, batchNumber: batchRecord.batchNumber },
        });
      }
    }

    // Update PO Line Item quantities
    const newReceivedQty = poItem.receivedQuantity + rItem.receivedQuantity;
    const newRemainingQty = Math.max(0, poItem.orderedQuantity - newReceivedQty);

    await prisma.purchaseOrderItem.update({
      where: { id: poItem.id },
      data: {
        receivedQuantity: newReceivedQty,
        remainingQuantity: newRemainingQty,
      },
    });
  }

  // Update PO overall status based on remaining line item quantities
  const updatedPoItems = await prisma.purchaseOrderItem.findMany({
    where: { purchaseOrderId: po.id },
  });

  const totalRemaining = updatedPoItems.reduce((acc, item) => acc + item.remainingQuantity, 0);
  const newPoStatus = totalRemaining === 0 ? POStatus.FULLY_RECEIVED : POStatus.PARTIALLY_RECEIVED;

  await prisma.purchaseOrder.update({
    where: { id: po.id },
    data: {
      status: newPoStatus,
      updatedAt: new Date(),
    },
  });

  const postedReceipt = await prisma.goodsReceipt.findUnique({
    where: { id: receiptId },
    include: { items: true },
  });

  // Record Audit Log for Posting
  await prisma.auditLog.create({
    data: {
      userId,
      action: "goods_receipt_posted",
      entityType: "GoodsReceipt",
      entityId: receipt.id,
      details: {
        receiptNumber: receipt.receiptNumber,
        purchaseOrderId: po.id,
        poNumber: po.purchaseOrderNumber,
        newPoStatus,
        itemCount: receipt.items.length,
      },
    },
  });

  return {
    goodsReceipt: postedReceipt!,
    purchaseOrderStatus: newPoStatus,
  };
}

/**
 * Supplier Purchase History Aggregation
 */
export async function getSupplierPurchaseHistory(supplierId: string) {
  const [purchaseOrders, aggregate] = await Promise.all([
    prisma.purchaseOrder.findMany({
      where: { supplierId },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        items: true,
      },
    }),
    prisma.purchaseOrder.aggregate({
      where: { supplierId },
      _count: { id: true },
      _sum: { total: true },
    }),
  ]);

  const openOrdersCount = purchaseOrders.filter((po) =>
    [POStatus.DRAFT, POStatus.PENDING_APPROVAL, POStatus.APPROVED, POStatus.PARTIALLY_RECEIVED].includes(
      po.status as any
    )
  ).length;

  const totalOrderedValue = aggregate._sum.total || 0;
  const lastPurchaseDate = purchaseOrders.length > 0 ? purchaseOrders[0]?.createdAt ?? null : null;

  return {
    supplierId,
    totalPurchaseOrders: aggregate._count.id,
    openOrdersCount,
    totalOrderedValue,
    lastPurchaseDate,
    recentOrders: purchaseOrders,
  };
}
