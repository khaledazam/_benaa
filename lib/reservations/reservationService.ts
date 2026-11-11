import { prisma } from "@/prisma/client";
import { inventoryTransaction } from "@/lib/inventory/transaction";
import { getStockAvailabilityInTx } from "@/lib/inventory/availability";
import { stockUnits } from "@/lib/inventory/quantity";
import { authorizeInventoryPosting } from '@/lib/inventory/postingAuthorization';
import { convertUnitQuantity } from "@/lib/units/unitService";
import {
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
 * Computes available stock for a product in a warehouse
 * availableStock = physicalStock - activeReservedStock
 */
export async function getAvailableStock(productId: string, warehouseId: string): Promise<StockAvailabilityResult> {
  return { productId, warehouseId, ...await getStockAvailabilityInTx(prisma, productId, warehouseId) };
}

/**
 * Atomic Creation of a Stock Reservation for an approved Sales Order
 */
export async function createStockReservation(salesOrderId: string, userId: string) {
  if (!salesOrderId) throw new Error("Sales Order ID is required");

  return inventoryTransaction(prisma, async (tx: any) => {
    const salesOrder = await tx.salesOrder.findUnique({ where: { id: salesOrderId }, include: { items: true } });
    if (!salesOrder) throw new Error("Sales Order not found");
    await authorizeInventoryPosting(tx, userId, salesOrder.warehouseId, 'RESERVATION_CREATE');
    await tx.salesOrder.update({ where: { id: salesOrderId }, data: { updatedAt: new Date() } });
    const existing = await tx.stockReservation.findFirst({ where: { salesOrderId, status: { in: ["ACTIVE", "PARTIALLY_FULFILLED"] } }, include: { items: true } });
    if (existing) return existing;
    if (salesOrder.status !== "APPROVED") throw new Error("Only APPROVED sales orders can be reserved");
    if (!salesOrder.items.length) throw new Error("Sales Order has no line items to reserve");
    const demand = new Map<string, number>();
    const reservationItemsData: any[] = [];
    for (const item of salesOrder.items) {
      if (!Number.isFinite(item.orderedQuantity) || item.orderedQuantity <= 0) throw new Error("Reservation quantities must be finite and positive");
      const product = await tx.product.findUnique({ where: { id: item.productId } });
      if (!product) throw new Error("Product not found");
      const base = await convertUnitQuantity({ quantity: item.orderedQuantity, fromUnitId: item.unitId || product.unitId, toUnitId: product.unitId, productId: item.productId }, tx);
      stockUnits(base);
      demand.set(item.productId, (demand.get(item.productId) || 0) + base);
      reservationItemsData.push({ salesOrderItemId: item.id, productId: item.productId, warehouseId: salesOrder.warehouseId, unitId: item.unitId, unitSymbol: item.unitSymbol,
        requestedQuantity: item.orderedQuantity, reservedQuantity: item.orderedQuantity, releasedQuantity: 0, remainingQuantity: item.orderedQuantity });
    }
    for (const [productId, quantity] of [...demand].sort(([a], [b]) => a.localeCompare(b))) {
      await tx.product.update({ where: { id: productId }, data: { updatedAt: new Date() } });
      await tx.stockAllocation.update({ where: { productId_warehouseId: { productId, warehouseId: salesOrder.warehouseId } }, data: { reservedQuantity: { increment: 0 }, updatedAt: new Date() } });
      const availability = await getStockAvailabilityInTx(tx, productId, salesOrder.warehouseId);
      if (!availability.consistent || quantity > availability.availableStock + 1e-8) {
        const product = await tx.product.findUnique({ where: { id: productId } });
        throw new Error(`Insufficient available stock for product '${product?.name || productId}'`);
      }
    }
    const prefix = `RES-${new Date().getFullYear()}-`;
    const last = await tx.stockReservation.findFirst({ where: { reservationNumber: { startsWith: prefix } }, orderBy: { reservationNumber: "desc" } });
    const reservationNumber = `${prefix}${String(Number(last?.reservationNumber.split("-").pop() || 0) + 1).padStart(6, "0")}`;

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
  return inventoryTransaction(prisma, async (tx: any) => {
  const existing = await tx.stockReservation.findUnique({
    where: { id: reservationId },
    include: { items: true },
  });

  if (!existing) throw new Error("Stock Reservation not found");
  await authorizeInventoryPosting(tx, userId, existing.warehouseId, 'RESERVATION_RELEASE');
  if (!["ACTIVE", "PARTIALLY_FULFILLED"].includes(existing.status)) {
    throw new Error(`Cannot release reservation in '${existing.status}' status. Only ACTIVE or PARTIALLY_FULFILLED reservations can be released.`);
  }

    for (const productId of [...new Set<string>(existing.items.map((item: any) => item.productId))].sort()) {
      await tx.product.update({ where: { id: productId }, data: { updatedAt: new Date() } });
      await tx.stockAllocation.update({ where: { productId_warehouseId: { productId, warehouseId: existing.warehouseId } }, data: { reservedQuantity: { increment: 0 }, updatedAt: new Date() } });
    }

    let allFulfilled = true;
    let anyReleased = false;

    if (options.releasedQuantities && Object.keys(options.releasedQuantities).length > 0) {
      // Partial / specific item release
      for (const item of existing.items) {
        const releaseAmt = options.releasedQuantities[item.id] ?? 0;
        if (!Number.isFinite(releaseAmt) || releaseAmt < 0 || releaseAmt > item.remainingQuantity) throw new Error("Release quantity must be finite and within remaining reservation");
        if (releaseAmt > 0) {
          anyReleased = true;
          const newReleased = item.releasedQuantity + releaseAmt;
          const newRemaining = Math.max(0, item.remainingQuantity - releaseAmt);

          await tx.stockReservationItem.update({
            where: { id: item.id },
            data: {
              releasedQuantity: newReleased,
              remainingQuantity: newRemaining,
            },
          });

          if (item.batchId) {
            await releaseBatchInBase(tx, item, releaseAmt);
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
          await releaseBatchInBase(tx, item, item.remainingQuantity);
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
  return inventoryTransaction(prisma, async (tx: any) => {
  const existing = await tx.stockReservation.findUnique({
    where: { id: reservationId },
    include: { items: true },
  });

  if (!existing) throw new Error("Stock Reservation not found");
  if (["CANCELLED", "RELEASED", "FULFILLED"].includes(existing.status)) {
    throw new Error(`Reservation is already in terminal status '${existing.status}'.`);
  }

    for (const productId of [...new Set<string>(existing.items.map((item: any) => item.productId))].sort()) {
      await tx.product.update({ where: { id: productId }, data: { updatedAt: new Date() } });
      await tx.stockAllocation.update({ where: { productId_warehouseId: { productId, warehouseId: existing.warehouseId } }, data: { reservedQuantity: { increment: 0 }, updatedAt: new Date() } });
    }

    for (const item of existing.items) {
      await tx.stockReservationItem.update({
        where: { id: item.id },
        data: {
          releasedQuantity: item.reservedQuantity,
          remainingQuantity: 0,
        },
      });
    }

    for (const item of existing.items) if (item.batchId && item.remainingQuantity > 0) await releaseBatchInBase(tx, item, item.remainingQuantity);
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

async function releaseBatchInBase(tx: any, item: any, quantity: number) {
  const product = await tx.product.findUnique({ where: { id: item.productId } });
  const base = await convertUnitQuantity({ quantity, fromUnitId: item.unitId || product.unitId, toUnitId: product.unitId, productId: item.productId }, tx);
  await releaseBatchReservationInTx(tx, item.batchId, base);
}
