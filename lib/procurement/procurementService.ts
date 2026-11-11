import { stockUnits, STOCK_SCALE } from "@/lib/inventory/quantity";
import { inventoryTransaction } from "@/lib/inventory/transaction";
import { prisma } from "@/prisma/client";
import { BATCH_MANAGED_IN_TX, executeStockMutationInTx, StockMovementTypes } from "@/lib/inventory/stockService";
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
  const receiptTotals = new Map<string, number>();
  if (!items.length) throw new Error("A receipt requires at least one item");

  for (const rItem of items) {
    const poItem = poItemMap.get(rItem.purchaseOrderItemId);
    if (!poItem) {
      throw new Error(`Purchase order line item not found: ${rItem.purchaseOrderItemId}`);
    }
    if (!Number.isFinite(rItem.receivedQuantity) || rItem.receivedQuantity <= 0) {
      throw new Error(`Received quantity must be greater than 0 for item ${poItem.productName}`);
    }

    if (rItem.productId !== poItem.productId) throw new Error("Receipt product does not match purchase order line");
    const quantityInPOUnit = await convertUnitQuantity({ quantity: rItem.receivedQuantity,
      fromUnitId: rItem.unitId || poItem.unitId, toUnitId: poItem.unitId, productId: poItem.productId });
    const lineTotal = (stockUnits(receiptTotals.get(poItem.id) || 0) + stockUnits(quantityInPOUnit)) / STOCK_SCALE;
    if (lineTotal > poItem.remainingQuantity) throw new Error("Over-receiving rejected");
    receiptTotals.set(poItem.id, lineTotal);

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
  return inventoryTransaction(prisma, async (tx) => {
    const receipt = await tx.goodsReceipt.findUnique({ where: { id: receiptId }, include: {
      items: true, purchaseOrder: { include: { items: true } },
    } });
    if (!receipt) throw new Error("Goods Receipt not found");
    // Receipt identity is the idempotency key: retry cannot create another posting.
    if (receipt.status === GRNStatus.POSTED) return { goodsReceipt: receipt, purchaseOrderStatus: receipt.purchaseOrder.status };
    if (receipt.status !== GRNStatus.DRAFT) throw new Error("Only DRAFT receipts can be posted");
    const po = receipt.purchaseOrder;
    if (!po || ![POStatus.APPROVED, POStatus.PARTIALLY_RECEIVED].includes(po.status)) throw new Error("Purchase order is not open for receipt");
    if (receipt.warehouseId !== po.warehouseId || receipt.supplierId !== po.supplierId) throw new Error("Receipt does not match purchase order");
    if (!receipt.items.length) throw new Error("A receipt requires at least one item");
    const totals = new Map<string, number>();
    const prepared = [];
    for (const item of receipt.items) {
      const line = po.items.find((l: any) => l.id === item.purchaseOrderItemId);
      if (!line || line.productId !== item.productId) throw new Error("Receipt product does not match purchase order line");
      const product = await tx.product.findUnique({ where: { id: item.productId } });
      if (!product) throw new Error("Receipt product not found");
      const unitId = item.unitId || line.unitId;
      const poQuantity = await convertUnitQuantity({ quantity: item.receivedQuantity, fromUnitId: unitId, toUnitId: line.unitId, productId: product.id }, tx);
      const baseQuantity = await convertUnitQuantity({ quantity: item.receivedQuantity, fromUnitId: unitId, toUnitId: product.unitId, productId: product.id }, tx);
      const total = (stockUnits(totals.get(line.id) || 0) + stockUnits(poQuantity)) / STOCK_SCALE;
      if (!Number.isFinite(line.remainingQuantity) || !Number.isFinite(line.receivedQuantity) || !Number.isFinite(line.orderedQuantity) || line.receivedQuantity < 0 || line.remainingQuantity < 0 || total > line.remainingQuantity || stockUnits(total) + stockUnits(line.receivedQuantity) > stockUnits(line.orderedQuantity)) throw new Error("Over-receiving or inconsistent PO quantities");
      totals.set(line.id, total);
      prepared.push({ item, product, unitId, baseQuantity });
    }
    const locked = await tx.goodsReceipt.updateMany({ where: { id: receiptId, status: GRNStatus.DRAFT }, data: { status: GRNStatus.POSTED, postedAt: new Date(), updatedAt: new Date() } });
    if (locked.count !== 1) throw new Error("Receipt state changed concurrently");
    for (const { item, product, unitId, baseQuantity } of prepared) {
      // This transaction owns the batch receipt; the central service validates its
      // identity while the unforgeable internal symbol prevents a second increment.
      const batch = ["BATCH", "LOT", "HEAT"].includes(product.trackingMode)
        ? await createOrUpdateBatchOnReceiptInTx(tx, { productId: product.id, warehouseId: receipt.warehouseId,
          supplierId: receipt.supplierId, goodsReceiptId: receipt.id, batchNumber: "BAT-" + receipt.receiptNumber.replace("GRN-", ""),
          quantity: baseQuantity, notes: "Received via Goods Receipt " + receipt.receiptNumber })
        : null;
      await executeStockMutationInTx(tx, { productId: item.productId, warehouseId: receipt.warehouseId,
        destinationBinId: item.destinationBinId, quantity: item.receivedQuantity, unitId,
        batchId: batch?.id, batchAccounting: batch ? BATCH_MANAGED_IN_TX : undefined,
        movementType: StockMovementTypes.PURCHASE, referenceType: "GoodsReceipt", referenceId: receipt.id,
        reason: "Goods receipt " + receipt.receiptNumber + " for PO " + po.purchaseOrderNumber, performedBy: userId });
      await tx.goodsReceiptItem.update({ where: { id: item.id }, data: { quantityInBaseUnit: baseQuantity } });
    }
    for (const line of po.items) {
      const quantity = totals.get(line.id);
      if (quantity === undefined) continue;
      const receivedQuantity = (stockUnits(line.receivedQuantity) + stockUnits(quantity)) / STOCK_SCALE;
      await tx.purchaseOrderItem.update({ where: { id: line.id }, data: { receivedQuantity, remainingQuantity: (stockUnits(line.orderedQuantity) - stockUnits(receivedQuantity)) / STOCK_SCALE } });
    }
    const updatedLines = await tx.purchaseOrderItem.findMany({ where: { purchaseOrderId: po.id } });
    const status = updatedLines.every((l: any) => l.remainingQuantity === 0) ? POStatus.FULLY_RECEIVED : POStatus.PARTIALLY_RECEIVED;
    await tx.purchaseOrder.update({ where: { id: po.id }, data: { status, updatedAt: new Date() } });
    await tx.auditLog.create({ data: { userId, action: "goods_receipt_posted", entityType: "GoodsReceipt", entityId: receipt.id,
      details: { receiptNumber: receipt.receiptNumber, purchaseOrderId: po.id, poNumber: po.purchaseOrderNumber, newPoStatus: status, itemCount: receipt.items.length } } });
    return { goodsReceipt: await tx.goodsReceipt.findUnique({ where: { id: receiptId }, include: { items: true } }), purchaseOrderStatus: status };
  });
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
