import { prisma } from "@/prisma/client";
import { roundQty } from "@/lib/inventory/adjustmentService";

export async function getAdjustmentHistoryReport(query: {
  warehouseId?: string;
  adjustmentType?: string;
  startDate?: string;
  endDate?: string;
  page?: number;
  limit?: number;
}) {
  const page = Math.max(1, query.page || 1);
  const limit = Math.min(100, Math.max(1, query.limit || 20));
  const skip = (page - 1) * limit;

  const where: any = { status: "POSTED" };
  if (query.warehouseId) where.warehouseId = query.warehouseId;
  if (query.adjustmentType) where.adjustmentType = query.adjustmentType;
  if (query.startDate || query.endDate) {
    where.postedAt = {};
    if (query.startDate) where.postedAt.gte = new Date(query.startDate);
    if (query.endDate) where.postedAt.lte = new Date(query.endDate);
  }

  const [total, adjustments] = await Promise.all([
    prisma.stockAdjustment.count({ where }),
    prisma.stockAdjustment.findMany({
      where,
      orderBy: { postedAt: "desc" },
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

  let totalItemsAdjusted = 0;
  let totalPositiveDelta = 0;
  let totalNegativeDelta = 0;

  for (const adj of adjustments) {
    for (const item of adj.items) {
      totalItemsAdjusted++;
      if (item.adjustmentQuantity > 0) totalPositiveDelta += item.adjustmentQuantity;
      else totalNegativeDelta += Math.abs(item.adjustmentQuantity);
    }
  }

  return {
    summary: {
      totalPostedAdjustments: total,
      totalItemsAdjusted,
      totalPositiveDelta: roundQty(totalPositiveDelta),
      totalNegativeDelta: roundQty(totalNegativeDelta),
      netDelta: roundQty(totalPositiveDelta - totalNegativeDelta),
    },
    data: adjustments,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

export async function getInventoryVarianceReport(query: {
  warehouseId?: string;
  startDate?: string;
  endDate?: string;
  page?: number;
  limit?: number;
}) {
  const page = Math.max(1, query.page || 1);
  const limit = Math.min(100, Math.max(1, query.limit || 20));
  const skip = (page - 1) * limit;

  const where: any = { status: { in: ["POSTED", "CLOSED", "APPROVED", "SUBMITTED"] } };
  if (query.warehouseId) where.warehouseId = query.warehouseId;
  if (query.startDate || query.endDate) {
    where.createdAt = {};
    if (query.startDate) where.createdAt.gte = new Date(query.startDate);
    if (query.endDate) where.createdAt.lte = new Date(query.endDate);
  }

  const [total, counts] = await Promise.all([
    prisma.inventoryCount.count({ where }),
    prisma.inventoryCount.findMany({
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

  let totalItemsCounted = 0;
  let totalVarianceUnits = 0;
  let exactMatchCount = 0;

  for (const cnt of counts) {
    for (const item of cnt.items) {
      if (item.countedQuantity !== null) {
        totalItemsCounted++;
        const varQty = Math.abs(item.varianceQuantity || 0);
        totalVarianceUnits += varQty;
        if (varQty === 0) exactMatchCount++;
      }
    }
  }

  const accuracyPercentage = totalItemsCounted > 0 ? roundQty((exactMatchCount / totalItemsCounted) * 100) : 100;

  return {
    summary: {
      totalCountsEvaluated: total,
      totalItemsCounted,
      totalVarianceUnits: roundQty(totalVarianceUnits),
      exactMatchCount,
      accuracyPercentage,
    },
    data: counts,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

export async function getDamageAndLossReport(query: {
  warehouseId?: string;
  startDate?: string;
  endDate?: string;
}) {
  const where: any = {
    status: "POSTED",
    adjustmentType: { in: ["DAMAGE", "LOSS", "EXPIRY"] },
  };
  if (query.warehouseId) where.warehouseId = query.warehouseId;
  if (query.startDate || query.endDate) {
    where.postedAt = {};
    if (query.startDate) where.postedAt.gte = new Date(query.startDate);
    if (query.endDate) where.postedAt.lte = new Date(query.endDate);
  }

  const adjustments = await prisma.stockAdjustment.findMany({
    where,
    orderBy: { postedAt: "desc" },
    include: {
      warehouse: true,
      items: {
        include: { product: true, bin: true },
      },
    },
  });

  let damageQuantity = 0;
  let lossQuantity = 0;
  let expiryQuantity = 0;

  for (const adj of adjustments) {
    for (const item of adj.items) {
      const qty = Math.abs(item.adjustmentQuantity);
      if (adj.adjustmentType === "DAMAGE") damageQuantity += qty;
      else if (adj.adjustmentType === "LOSS") lossQuantity += qty;
      else if (adj.adjustmentType === "EXPIRY") expiryQuantity += qty;
    }
  }

  return {
    summary: {
      totalEvents: adjustments.length,
      damageQuantity: roundQty(damageQuantity),
      lossQuantity: roundQty(lossQuantity),
      expiryQuantity: roundQty(expiryQuantity),
      totalLostUnits: roundQty(damageQuantity + lossQuantity + expiryQuantity),
    },
    data: adjustments,
  };
}
