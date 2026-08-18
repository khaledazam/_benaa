import { prisma } from "@/prisma/client";
import { executeStockMutationInTx, StockMovementTypes } from "@/lib/inventory/stockService";
import { CreateAdjustmentInput } from "@/lib/validations/adjustment-validations";

export function roundQty(val: number): number {
  return Math.round((val + Number.EPSILON) * 100) / 100;
}

export async function generateAdjustmentNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `ADJ-${year}-`;

  const last = await prisma.stockAdjustment.findFirst({
    where: { adjustmentNumber: { startsWith: prefix } },
    orderBy: { adjustmentNumber: "desc" },
    select: { adjustmentNumber: true },
  });

  let seq = 1;
  if (last?.adjustmentNumber) {
    const parts = last.adjustmentNumber.split("-");
    const lastPart = parts[parts.length - 1];
    const lastSeq = lastPart ? parseInt(lastPart, 10) : NaN;
    if (!isNaN(lastSeq)) seq = lastSeq + 1;
  }

  return `${prefix}${seq.toString().padStart(6, "0")}`;
}

export async function createAdjustment(data: CreateAdjustmentInput, userId: string) {
  const warehouse = await prisma.warehouse.findUnique({
    where: { id: data.warehouseId },
  });
  if (!warehouse) throw new Error("Warehouse not found");

  const adjustmentNumber = await generateAdjustmentNumber();
  const itemCreations = [];

  for (const item of data.items) {
    const product = await prisma.product.findUnique({
      where: { id: item.productId },
    });
    if (!product) throw new Error(`Product with ID '${item.productId}' not found`);

    let binLocationPath: string | null = null;
    if (item.binId) {
      const bin = await prisma.warehouseBin.findUnique({
        where: { id: item.binId },
      });
      if (!bin) throw new Error(`Bin with ID '${item.binId}' not found`);
      if (bin.warehouseId !== data.warehouseId) {
        throw new Error(`Bin '${bin.code}' does not belong to warehouse '${warehouse.name}'`);
      }
      if (!bin.active) {
        throw new Error(`Cannot adjust stock in inactive bin '${bin.code}'`);
      }
      binLocationPath = bin.locationPath || bin.code;
    }

    let sysQty = 0;
    if (item.binId) {
      const sla = await prisma.stockLocationAllocation.findUnique({
        where: { productId_binId: { productId: item.productId, binId: item.binId } },
      });
      sysQty = sla?.quantity ?? 0;
    } else {
      const sa = await prisma.stockAllocation.findUnique({
        where: { productId_warehouseId: { productId: item.productId, warehouseId: data.warehouseId } },
      });
      sysQty = sa?.quantity ?? 0;
    }

    const adjQty = roundQty(item.adjustmentQuantity);
    const resultingQty = roundQty(sysQty + adjQty);
    if (resultingQty < 0) {
      throw new Error(`Adjustment resulting quantity cannot be negative for product '${product.name}'`);
    }

    itemCreations.push({
      productId: item.productId,
      productName: product.name,
      productSku: product.sku,
      warehouseId: data.warehouseId,
      binId: item.binId || null,
      locationPath: binLocationPath,
      unitId: item.unitId || product.unitId || null,
      unitSymbol: item.unitSymbol || null,
      systemQuantity: roundQty(sysQty),
      adjustmentQuantity: adjQty,
      resultingQuantity: resultingQty,
      reason: item.reason || data.reason,
      notes: item.notes || null,
    });
  }

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, username: true } });
  const createdByName = user?.name || user?.username || "System User";

  const adjustment = await prisma.stockAdjustment.create({
    data: {
      adjustmentNumber,
      warehouseId: data.warehouseId,
      warehouseName: warehouse.name,
      reason: data.reason,
      adjustmentType: data.adjustmentType,
      status: "DRAFT",
      createdBy: userId,
      createdByName,
      notes: data.notes || null,
      items: {
        create: itemCreations,
      },
    },
    include: {
      warehouse: true,
      items: {
        include: { product: true, bin: true },
      },
    },
  });

  await prisma.auditLog.create({
    data: {
      userId,
      action: "stock_adjustment_created",
      entityType: "StockAdjustment",
      entityId: adjustment.id,
      details: { adjustmentNumber, status: "DRAFT", itemCount: itemCreations.length },
    },
  });

  return adjustment;
}

export async function submitAdjustment(adjustmentId: string, userId: string) {
  const adj = await prisma.stockAdjustment.findUnique({
    where: { id: adjustmentId },
  });
  if (!adj) throw new Error("Stock adjustment not found");
  if (adj.status !== "DRAFT") {
    throw new Error(`Cannot submit adjustment in '${adj.status}' status. Must be DRAFT.`);
  }

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, username: true } });

  const updated = await prisma.stockAdjustment.update({
    where: { id: adjustmentId },
    data: {
      status: "PENDING_APPROVAL",
      submittedBy: userId,
      submittedByName: user?.name || user?.username || "User",
      submittedAt: new Date(),
    },
    include: { warehouse: true, items: { include: { product: true, bin: true } } },
  });

  await prisma.auditLog.create({
    data: {
      userId,
      action: "stock_adjustment_submitted",
      entityType: "StockAdjustment",
      entityId: adjustmentId,
      details: { adjustmentNumber: adj.adjustmentNumber, status: "PENDING_APPROVAL" },
    },
  });

  return updated;
}

export async function approveAdjustment(adjustmentId: string, userId: string) {
  const adj = await prisma.stockAdjustment.findUnique({
    where: { id: adjustmentId },
  });
  if (!adj) throw new Error("Stock adjustment not found");
  if (adj.status !== "PENDING_APPROVAL") {
    throw new Error(`Cannot approve adjustment in '${adj.status}' status. Must be PENDING_APPROVAL.`);
  }

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, username: true } });

  const updated = await prisma.stockAdjustment.update({
    where: { id: adjustmentId },
    data: {
      status: "APPROVED",
      approvedBy: userId,
      approvedByName: user?.name || user?.username || "User",
      approvedAt: new Date(),
    },
    include: { warehouse: true, items: { include: { product: true, bin: true } } },
  });

  await prisma.auditLog.create({
    data: {
      userId,
      action: "stock_adjustment_approved",
      entityType: "StockAdjustment",
      entityId: adjustmentId,
      details: { adjustmentNumber: adj.adjustmentNumber, status: "APPROVED" },
    },
  });

  return updated;
}

export async function rejectAdjustment(adjustmentId: string, rejectionReason: string, userId: string) {
  const adj = await prisma.stockAdjustment.findUnique({
    where: { id: adjustmentId },
  });
  if (!adj) throw new Error("Stock adjustment not found");
  if (adj.status !== "PENDING_APPROVAL") {
    throw new Error(`Cannot reject adjustment in '${adj.status}' status. Must be PENDING_APPROVAL.`);
  }

  const updated = await prisma.stockAdjustment.update({
    where: { id: adjustmentId },
    data: {
      status: "REJECTED",
      rejectionReason,
    },
    include: { warehouse: true, items: { include: { product: true, bin: true } } },
  });

  await prisma.auditLog.create({
    data: {
      userId,
      action: "stock_adjustment_rejected",
      entityType: "StockAdjustment",
      entityId: adjustmentId,
      details: { adjustmentNumber: adj.adjustmentNumber, status: "REJECTED", rejectionReason },
    },
  });

  return updated;
}

export async function cancelAdjustment(adjustmentId: string, cancellationReason: string, userId: string) {
  const adj = await prisma.stockAdjustment.findUnique({
    where: { id: adjustmentId },
  });
  if (!adj) throw new Error("Stock adjustment not found");
  if (adj.status === "POSTED") {
    throw new Error("Cannot cancel a POSTED stock adjustment. Posted adjustments are immutable.");
  }
  if (adj.status === "CANCELLED" || adj.status === "REJECTED") {
    throw new Error(`Adjustment is already in '${adj.status}' status.`);
  }

  const updated = await prisma.stockAdjustment.update({
    where: { id: adjustmentId },
    data: {
      status: "CANCELLED",
      cancelledBy: userId,
      cancelledAt: new Date(),
      cancellationReason,
    },
    include: { warehouse: true, items: { include: { product: true, bin: true } } },
  });

  await prisma.auditLog.create({
    data: {
      userId,
      action: "stock_adjustment_cancelled",
      entityType: "StockAdjustment",
      entityId: adjustmentId,
      details: { adjustmentNumber: adj.adjustmentNumber, status: "CANCELLED", cancellationReason },
    },
  });

  return updated;
}

export async function postAdjustment(adjustmentId: string, userId: string) {
  return await prisma.$transaction(async (tx) => {
    const adj = await tx.stockAdjustment.findUnique({
      where: { id: adjustmentId },
      include: {
        items: true,
      },
    });

    if (!adj) throw new Error("Stock adjustment not found");
    if (adj.status === "POSTED") {
      throw new Error(`Stock adjustment '${adj.adjustmentNumber}' has already been POSTED.`);
    }
    if (adj.status === "CANCELLED" || adj.status === "REJECTED") {
      throw new Error(`Cannot post stock adjustment in '${adj.status}' status.`);
    }

    const user = await tx.user.findUnique({ where: { id: userId }, select: { name: true, username: true } });
    const postedByName = user?.name || user?.username || "User";

    // Lock status immediately
    await tx.stockAdjustment.update({
      where: { id: adjustmentId },
      data: {
        status: "POSTED",
        postedBy: userId,
        postedByName,
        postedAt: new Date(),
      },
    });

    for (const item of adj.items) {
      if (item.binId) {
        const bin = await tx.warehouseBin.findUnique({ where: { id: item.binId } });
        if (!bin) throw new Error(`Bin with ID '${item.binId}' not found`);
        if (bin.warehouseId !== adj.warehouseId) {
          throw new Error(`Bin '${bin.code}' does not belong to warehouse '${adj.warehouseId}'`);
        }
        if (!bin.active) {
          throw new Error(`Cannot perform adjustment in inactive bin '${bin.code}'`);
        }
      }

      let movementType: string = adj.adjustmentType;
      const adjQty = item.adjustmentQuantity;
      if (adjQty > 0) {
        if (!["ADJUSTMENT_IN", "FOUND", "OPENING_BALANCE"].includes(movementType)) {
          movementType = StockMovementTypes.ADJUSTMENT_IN;
        }
      } else {
        if (!["ADJUSTMENT_OUT", "DAMAGE", "LOSS", "EXPIRY"].includes(movementType)) {
          movementType = StockMovementTypes.ADJUSTMENT_OUT;
        }
      }

      await executeStockMutationInTx(tx, {
        productId: item.productId,
        warehouseId: adj.warehouseId,
        binId: item.binId,
        quantity: Math.abs(adjQty),
        unitId: item.unitId,
        movementType,
        referenceType: "STOCK_ADJUSTMENT",
        referenceId: adj.id,
        reason: item.reason || adj.reason,
        performedBy: userId,
      });
    }

    await tx.auditLog.create({
      data: {
        userId,
        action: "stock_adjustment_posted",
        entityType: "StockAdjustment",
        entityId: adjustmentId,
        details: { adjustmentNumber: adj.adjustmentNumber, itemCount: adj.items.length, status: "POSTED" },
      },
    });

    return await tx.stockAdjustment.findUnique({
      where: { id: adjustmentId },
      include: { warehouse: true, items: { include: { product: true, bin: true } } },
    });
  });
}

export async function getAdjustmentById(adjustmentId: string) {
  const adj = await prisma.stockAdjustment.findUnique({
    where: { id: adjustmentId },
    include: {
      warehouse: true,
      items: {
        include: { product: true, bin: true },
      },
    },
  });
  return adj;
}

export async function getAdjustments(query: {
  warehouseId?: string;
  status?: string;
  adjustmentType?: string;
  search?: string;
  page?: number;
  limit?: number;
}) {
  const page = Math.max(1, query.page || 1);
  const limit = Math.min(100, Math.max(1, query.limit || 20));
  const skip = (page - 1) * limit;

  const where: any = {};
  if (query.warehouseId) where.warehouseId = query.warehouseId;
  if (query.status) where.status = query.status;
  if (query.adjustmentType) where.adjustmentType = query.adjustmentType;
  if (query.search) {
    where.OR = [
      { adjustmentNumber: { contains: query.search, mode: "insensitive" } },
      { reason: { contains: query.search, mode: "insensitive" } },
      { createdByName: { contains: query.search, mode: "insensitive" } },
    ];
  }

  const [total, adjustments] = await Promise.all([
    prisma.stockAdjustment.count({ where }),
    prisma.stockAdjustment.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
      include: {
        warehouse: true,
        items: {
          include: { product: true, bin: true },
        },
      },
    }),
  ]);

  return {
    data: adjustments,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}
