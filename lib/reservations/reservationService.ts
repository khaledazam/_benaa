import { prisma } from "@/prisma/client";
import {
  validateProductTrackingModeInTx,
  reserveBatchQuantityInTx,
  releaseBatchReservationInTx,
} from "@/lib/inventory/batchService";

export interface StockAvailabilityResult {
  productId: string;
  warehouseId: string;
  physicalStock: number;
  reservedStock: number;
  availableStock: number;
}

export interface GetReservationsQuery {
  search?: string;
  status?: string;
  warehouseId?: string;
  salesOrderId?: string;
  page?: number;
  limit?: number;
  sortBy?: "reservationNumber" | "createdAt" | "status";
  sortOrder?: "asc" | "desc";
}

export interface ReleaseReservationOptions {
  reason?: string;
  releasedQuantities?: Record<string, number>; // itemId -> releaseQty
}

/**
 * Generates human-readable Reservation Number: RES-2026-XXXXXX
 */
export async function generateReservationNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `RES-${year}-`;

  const lastReservation = await prisma.stockReservation.findFirst({
    where: { reservationNumber: { startsWith: prefix } },
    orderBy: { reservationNumber: "desc" },
    select: { reservationNumber: true },
  });

  let nextSequence = 1;
  const lastNum = lastReservation?.reservationNumber;
  if (lastNum) {
    const parts = lastNum.split("-");
    const lastSeqStr = parts[parts.length - 1] || "0";
    const lastSeq = parseInt(lastSeqStr, 10);
    if (!isNaN(lastSeq)) {
      nextSequence = lastSeq + 1;
    }
  }

  return `${prefix}${nextSequence.toString().padStart(6, "0")}`;
}

/**
 * Helper to safely round values to 2 decimals
 */
function roundQty(val: number): number {
  return Math.round((val + Number.EPSILON) * 100) / 100;
}

/**
 * Computes available stock for a product in a warehouse
 * availableStock = physicalStock - activeReservedStock
 */
export async function getAvailableStock(productId: string, warehouseId: string): Promise<StockAvailabilityResult> {
  // 1. Physical Stock sum
  const allocations = await prisma.stockAllocation.findMany({
    where: { productId, warehouseId },
    select: { quantity: true },
  });

  const physicalStock = roundQty(allocations.reduce((sum, a) => sum + a.quantity, 0));

  // 2. Active Reserved Stock sum
  const activeItems = await prisma.stockReservationItem.findMany({
    where: {
      productId,
      warehouseId,
      reservation: {
        status: { in: ["ACTIVE", "PARTIALLY_FULFILLED"] },
      },
    },
    select: { remainingQuantity: true },
  });

  const reservedStock = roundQty(activeItems.reduce((sum, i) => sum + i.remainingQuantity, 0));
  const availableStock = roundQty(Math.max(0, physicalStock - reservedStock));

  return {
    productId,
    warehouseId,
    physicalStock,
    reservedStock,
    availableStock,
  };
}

/**
 * Atomic Creation of a Stock Reservation for an approved Sales Order
 */
export async function createStockReservation(salesOrderId: string, userId: string) {
  if (!salesOrderId) throw new Error("Sales Order ID is required");

  // 1. Fetch Sales Order
  const salesOrder = await prisma.salesOrder.findUnique({
    where: { id: salesOrderId },
    include: {
      customer: true,
      warehouse: true,
      items: true,
    },
  });

  if (!salesOrder) throw new Error("Sales Order not found");
  if (salesOrder.status !== "APPROVED") {
    throw new Error(`Cannot reserve stock for Sales Order in '${salesOrder.status}' status. Only APPROVED orders can be reserved.`);
  }

  // 2. Check Idempotency (no active reservation for same Sales Order)
  const existingActive = await prisma.stockReservation.findFirst({
    where: {
      salesOrderId,
      status: { in: ["ACTIVE", "PARTIALLY_FULFILLED"] },
    },
  });

  if (existingActive) {
    throw new Error(
      `Sales Order '${salesOrder.salesOrderNumber}' already has an active reservation (${existingActive.reservationNumber}).`
    );
  }

  if (!salesOrder.items || salesOrder.items.length === 0) {
    throw new Error("Sales Order has no line items to reserve");
  }

  // 3. Atomic Reservation Transaction
  const reservationNumber = await generateReservationNumber();

  return await prisma.$transaction(async (tx) => {
    // Validate availability for each line item
    const reservationItemsData = [];

    for (const item of salesOrder.items) {
      await validateProductTrackingModeInTx(tx, item.productId);

      // Calculate physical stock in warehouse
      const allocs = await tx.stockAllocation.findMany({
        where: { productId: item.productId, warehouseId: salesOrder.warehouseId },
        select: { quantity: true },
      });
      const physicalStock = roundQty(allocs.reduce((sum, a) => sum + a.quantity, 0));

      // Calculate existing active reservations
      const reservedItems = await tx.stockReservationItem.findMany({
        where: {
          productId: item.productId,
          warehouseId: salesOrder.warehouseId,
          reservation: {
            status: { in: ["ACTIVE", "PARTIALLY_FULFILLED"] },
          },
        },
        select: { remainingQuantity: true },
      });
      const existingReserved = roundQty(reservedItems.reduce((sum, i) => sum + i.remainingQuantity, 0));
      const availableStock = roundQty(Math.max(0, physicalStock - existingReserved));

      if (item.orderedQuantity > availableStock) {
        throw new Error(
          `Insufficient available stock for product '${item.productName}'. Requested: ${item.orderedQuantity} ${item.unitSymbol || ""}, Available: ${availableStock} ${item.unitSymbol || ""}`
        );
      }

      reservationItemsData.push({
        salesOrderItemId: item.id,
        productId: item.productId,
        warehouseId: salesOrder.warehouseId,
        unitId: item.unitId,
        unitSymbol: item.unitSymbol,
        requestedQuantity: item.orderedQuantity,
        reservedQuantity: item.orderedQuantity,
        releasedQuantity: 0,
        remainingQuantity: item.orderedQuantity,
      });
    }

    // Create Reservation Header & Items
    const reservation = await tx.stockReservation.create({
      data: {
        reservationNumber,
        salesOrderId: salesOrder.id,
        warehouseId: salesOrder.warehouseId,
        status: "ACTIVE",
        reservedBy: userId,
        items: {
          create: reservationItemsData,
        },
      },
      include: {
        salesOrder: true,
        warehouse: true,
        items: {
          include: { product: true },
        },
      },
    });

    // Audit Log
    await tx.auditLog.create({
      data: {
        userId,
        action: "reservation_created",
        entityType: "StockReservation",
        entityId: reservation.id,
        details: {
          reservationNumber: reservation.reservationNumber,
          salesOrderNumber: salesOrder.salesOrderNumber,
          warehouseId: salesOrder.warehouseId,
          itemsCount: reservation.items.length,
        },
      },
    });

    return reservation;
  });
}

/**
 * Releases a Stock Reservation (Full or Partial)
 * Physical stock remains 100% UNCHANGED.
 */
export async function releaseReservation(
  reservationId: string,
  options: ReleaseReservationOptions = {},
  userId: string
) {
  const existing = await prisma.stockReservation.findUnique({
    where: { id: reservationId },
    include: { items: true },
  });

  if (!existing) throw new Error("Stock Reservation not found");
  if (!["ACTIVE", "PARTIALLY_FULFILLED"].includes(existing.status)) {
    throw new Error(`Cannot release reservation in '${existing.status}' status. Only ACTIVE or PARTIALLY_FULFILLED reservations can be released.`);
  }

  return await prisma.$transaction(async (tx) => {
    let allFulfilled = true;
    let anyReleased = false;

    if (options.releasedQuantities && Object.keys(options.releasedQuantities).length > 0) {
      // Partial / specific item release
      for (const item of existing.items) {
        const releaseAmt = options.releasedQuantities[item.id] || 0;
        if (releaseAmt > 0) {
          anyReleased = true;
          const newReleased = roundQty(item.releasedQuantity + releaseAmt);
          const newRemaining = roundQty(Math.max(0, item.reservedQuantity - newReleased));

          await tx.stockReservationItem.update({
            where: { id: item.id },
            data: {
              releasedQuantity: newReleased,
              remainingQuantity: newRemaining,
            },
          });

          if (item.batchId) {
            await releaseBatchReservationInTx(tx, item.batchId, releaseAmt);
          }

          if (newRemaining > 0) allFulfilled = false;
        } else {
          if (item.remainingQuantity > 0) allFulfilled = false;
        }
      }
    } else {
      // Full Release of all remaining quantities
      anyReleased = true;
      for (const item of existing.items) {
        await tx.stockReservationItem.update({
          where: { id: item.id },
          data: {
            releasedQuantity: item.reservedQuantity,
            remainingQuantity: 0,
          },
        });
        if (item.batchId && item.remainingQuantity > 0) {
          await releaseBatchReservationInTx(tx, item.batchId, item.remainingQuantity);
        }
      }
      allFulfilled = true;
    }

    const nextStatus = allFulfilled ? "RELEASED" : anyReleased ? "PARTIALLY_FULFILLED" : existing.status;

    const updated = await tx.stockReservation.update({
      where: { id: reservationId },
      data: {
        status: nextStatus,
        releasedBy: userId,
        releasedAt: new Date(),
      },
      include: {
        salesOrder: true,
        warehouse: true,
        items: { include: { product: true } },
      },
    });

    await tx.auditLog.create({
      data: {
        userId,
        action: nextStatus === "RELEASED" ? "reservation_released" : "reservation_partially_released",
        entityType: "StockReservation",
        entityId: reservationId,
        details: {
          reservationNumber: existing.reservationNumber,
          status: nextStatus,
          reason: options.reason || "Manual release",
        },
      },
    });

    return updated;
  });
}

/**
 * Cancels a Stock Reservation and releases all remaining reserved quantities
 * Physical stock remains 100% UNCHANGED.
 */
export async function cancelReservation(reservationId: string, reason: string | undefined, userId: string) {
  const existing = await prisma.stockReservation.findUnique({
    where: { id: reservationId },
    include: { items: true },
  });

  if (!existing) throw new Error("Stock Reservation not found");
  if (["CANCELLED", "RELEASED", "FULFILLED"].includes(existing.status)) {
    throw new Error(`Reservation is already in terminal status '${existing.status}'.`);
  }

  return await prisma.$transaction(async (tx) => {
    for (const item of existing.items) {
      await tx.stockReservationItem.update({
        where: { id: item.id },
        data: {
          releasedQuantity: item.reservedQuantity,
          remainingQuantity: 0,
        },
      });
    }

    const cancelled = await tx.stockReservation.update({
      where: { id: reservationId },
      data: {
        status: "CANCELLED",
        cancelledBy: userId,
        cancelledAt: new Date(),
        cancellationReason: reason?.trim() || "Cancelled",
      },
      include: {
        salesOrder: true,
        warehouse: true,
        items: { include: { product: true } },
      },
    });

    await tx.auditLog.create({
      data: {
        userId,
        action: "reservation_cancelled",
        entityType: "StockReservation",
        entityId: reservationId,
        details: {
          reservationNumber: existing.reservationNumber,
          reason: reason || "Cancelled",
        },
      },
    });

    return cancelled;
  });
}

/**
 * Fetches single reservation by ID
 */
export async function getReservationById(id: string) {
  return prisma.stockReservation.findUnique({
    where: { id },
    include: {
      salesOrder: {
        include: { customer: true },
      },
      warehouse: true,
      items: {
        include: { product: true },
      },
    },
  });
}

/**
 * Fetches list of stock reservations with filters & pagination
 */
export async function getReservations(query: GetReservationsQuery = {}) {
  const {
    search,
    status,
    warehouseId,
    salesOrderId,
    page = 1,
    limit = 20,
    sortBy = "createdAt",
    sortOrder = "desc",
  } = query;

  const where: any = {};

  if (status) where.status = status;
  if (warehouseId) where.warehouseId = warehouseId;
  if (salesOrderId) where.salesOrderId = salesOrderId;

  if (search) {
    where.OR = [
      { reservationNumber: { contains: search, mode: "insensitive" } },
      { salesOrder: { salesOrderNumber: { contains: search, mode: "insensitive" } } },
      { salesOrder: { customerNameSnapshot: { contains: search, mode: "insensitive" } } },
    ];
  }

  const total = await prisma.stockReservation.count({ where });
  const totalPages = Math.ceil(total / limit) || 1;
  const skip = (page - 1) * limit;

  const items = await prisma.stockReservation.findMany({
    where,
    skip,
    take: limit,
    orderBy: { [sortBy]: sortOrder },
    include: {
      salesOrder: {
        select: {
          salesOrderNumber: true,
          customerNameSnapshot: true,
          customerCodeSnapshot: true,
        },
      },
      warehouse: {
        select: { name: true, code: true },
      },
      items: {
        select: {
          id: true,
          product: { select: { name: true } },
          requestedQuantity: true,
          reservedQuantity: true,
          remainingQuantity: true,
          unitSymbol: true,
        },
      },
    },
  });

  return {
    items,
    pagination: {
      total,
      page,
      limit,
      totalPages,
    },
  };
}
