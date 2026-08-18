import { prisma } from "@/prisma/client";

/**
 * Helper to safely round numeric values to 2 decimal places to avoid floating point precision drift.
 */
export function roundQty(val: number): number {
  return Math.round((val + Number.EPSILON) * 100) / 100;
}

export interface BinPickingAvailability {
  binId: string;
  binCode: string;
  locationPath: string;
  productId: string;
  physicalStock: number;
  alreadyCommittedToOtherActivePicks: number;
  pickableStock: number;
}

export interface SuggestedAllocation {
  pickListItemId: string;
  productId: string;
  binId: string;
  binCode: string;
  locationPath: string;
  suggestedQuantity: number;
  pickableStock: number;
}

export interface GetPickListsQuery {
  search?: string;
  status?: string;
  warehouseId?: string;
  salesOrderId?: string;
  assignedTo?: string;
  page?: number;
  limit?: number;
  sortBy?: "pickListNumber" | "createdAt" | "status";
  sortOrder?: "asc" | "desc";
}

const BIN_LOCATION_INCLUDE = {
  include: {
    shelf: {
      include: {
        rack: {
          include: {
            zone: true,
          },
        },
      },
    },
  },
};

/**
 * Generates human-readable Pick List Number: PICK-2026-XXXXXX
 */
export async function generatePickListNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `PICK-${year}-`;

  const lastPickList = await prisma.pickList.findFirst({
    where: { pickListNumber: { startsWith: prefix } },
    orderBy: { pickListNumber: "desc" },
    select: { pickListNumber: true },
  });

  let nextSequence = 1;
  const lastNum = lastPickList?.pickListNumber;
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
 * Format location path for warehouse hierarchy display
 */
export function formatLocationPath(bin: any): string {
  if (bin?.locationPath) return bin.locationPath;

  const zone = bin?.shelf?.rack?.zone?.code || "ZONE";
  const rack = bin?.shelf?.rack?.code || "RACK";
  const shelf = bin?.shelf?.code || "SHELF";
  const binCode = bin?.code || "BIN";

  return `WH / ${zone} / ${rack} / ${shelf} / ${binCode}`;
}

/**
 * Calculates physical stock, committed picking stock, and pickable stock per bin for a product in a warehouse.
 * 
 * Invariant: pickableStock = physicalBinStock - alreadyCommittedToOtherActivePicks
 */
export async function getPickingAvailability(
  productId: string,
  warehouseId: string,
  excludePickListId?: string
): Promise<BinPickingAvailability[]> {
  // 1. Fetch all stock location allocations in the target warehouse for this product
  const locationAllocations = await prisma.stockLocationAllocation.findMany({
    where: {
      productId,
      warehouseId,
      bin: {
        active: true,
        warehouseId,
      },
    },
    include: {
      bin: BIN_LOCATION_INCLUDE,
    },
  });

  if (locationAllocations.length === 0) {
    return [];
  }

  // 2. Fetch all active pick allocations for these bins (excluding current pick list if editing)
  const activeAllocations = await prisma.pickAllocation.findMany({
    where: {
      productId,
      bin: { warehouseId },
      pickListItem: {
        pickList: {
          status: { in: ["DRAFT", "ASSIGNED", "IN_PROGRESS"] },
          ...(excludePickListId ? { id: { not: excludePickListId } } : {}),
        },
      },
    },
    select: {
      binId: true,
      requestedQuantity: true,
    },
  });

  // Aggregate committed stock per bin ID
  const committedMap: Record<string, number> = {};
  for (const alloc of activeAllocations) {
    committedMap[alloc.binId] = roundQty((committedMap[alloc.binId] || 0) + alloc.requestedQuantity);
  }

  // 3. Compute availability per bin
  return locationAllocations.map((loc) => {
    const physicalStock = roundQty(loc.quantity);
    const committed = roundQty(committedMap[loc.binId] || 0);
    const pickableStock = roundQty(Math.max(0, physicalStock - committed));

    return {
      binId: loc.binId,
      binCode: loc.bin.code,
      locationPath: formatLocationPath(loc.bin),
      productId,
      physicalStock,
      alreadyCommittedToOtherActivePicks: committed,
      pickableStock,
    };
  });
}

/**
 * Creates a Pick List for an active Stock Reservation
 */
export async function createPickList(data: {
  reservationId: string;
  userId: string;
  assignedTo?: string;
}) {
  const { reservationId, userId, assignedTo } = data;

  // 1. Fetch Stock Reservation
  const reservation = await prisma.stockReservation.findUnique({
    where: { id: reservationId },
    include: {
      salesOrder: true,
      warehouse: true,
      items: {
        include: {
          product: true,
        },
      },
    },
  });

  if (!reservation) {
    throw new Error("Stock Reservation not found");
  }

  if (!["ACTIVE", "PARTIALLY_FULFILLED"].includes(reservation.status)) {
    throw new Error(`Cannot create Pick List for reservation in '${reservation.status}' status.`);
  }

  // 2. Validate Sales Order status
  if (!["APPROVED", "PROCESSING"].includes(reservation.salesOrder.status)) {
    throw new Error(`Sales Order must be APPROVED or PROCESSING (current: ${reservation.salesOrder.status}).`);
  }

  // 3. Check for existing active Pick List for this reservation
  const existingActivePickList = await prisma.pickList.findFirst({
    where: {
      reservationId,
      status: { in: ["DRAFT", "ASSIGNED", "IN_PROGRESS"] },
    },
  });

  if (existingActivePickList) {
    throw new Error(
      `An active Pick List (${existingActivePickList.pickListNumber}) already exists for this reservation.`
    );
  }

  // 4. Validate remaining unpicked reservation items
  const eligibleItems = reservation.items.filter((item) => item.remainingQuantity > 0);

  if (eligibleItems.length === 0) {
    throw new Error("All items in this reservation have already been fully fulfilled/picked.");
  }

  const pickListNumber = await generatePickListNumber();
  const initialStatus = assignedTo ? "ASSIGNED" : "DRAFT";

  // 5. Execute Creation Transaction
  return await prisma.$transaction(async (tx) => {
    const pickList = await tx.pickList.create({
      data: {
        pickListNumber,
        salesOrderId: reservation.salesOrderId,
        reservationId: reservation.id,
        warehouseId: reservation.warehouseId,
        status: initialStatus,
        createdBy: userId,
        assignedTo: assignedTo || null,
        items: {
          create: eligibleItems.map((resItem) => ({
            salesOrderItemId: resItem.salesOrderItemId,
            reservationItemId: resItem.id,
            productId: resItem.productId,
            unitId: resItem.unitId,
            unitSymbol: resItem.unitSymbol,
            requestedQuantity: roundQty(resItem.remainingQuantity),
            pickedQuantity: 0,
            remainingQuantity: roundQty(resItem.remainingQuantity),
            status: "PENDING",
          })),
        },
      },
      include: {
        items: {
          include: {
            product: true,
            allocations: {
              include: {
                bin: BIN_LOCATION_INCLUDE,
              },
            },
          },
        },
        salesOrder: {
          include: {
            customer: true,
          },
        },
        warehouse: true,
        reservation: true,
      },
    });

    // Audit Logging
    await tx.auditLog.create({
      data: {
        userId,
        action: "pick_list_created",
        entityType: "PickList",
        entityId: pickList.id,
        details: {
          pickListNumber: pickList.pickListNumber,
          reservationNumber: reservation.reservationNumber,
          salesOrderNumber: reservation.salesOrder.salesOrderNumber,
          status: initialStatus,
          assignedTo,
        },
      },
    });

    if (assignedTo) {
      await tx.auditLog.create({
        data: {
          userId,
          action: "pick_list_assigned",
          entityType: "PickList",
          entityId: pickList.id,
          details: {
            pickListNumber: pickList.pickListNumber,
            assignedTo,
          },
        },
      });
    }

    return pickList;
  });
}

/**
 * Assigns a Pick List to a specific picker
 */
export async function assignPickList(pickListId: string, assignedToId: string, userId: string) {
  const pickList = await prisma.pickList.findUnique({
    where: { id: pickListId },
  });

  if (!pickList) throw new Error("Pick List not found");
  if (["COMPLETED", "CANCELLED"].includes(pickList.status)) {
    throw new Error(`Cannot assign a Pick List in '${pickList.status}' status.`);
  }

  const updatedStatus = pickList.status === "DRAFT" ? "ASSIGNED" : pickList.status;

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.pickList.update({
      where: { id: pickListId },
      data: {
        assignedTo: assignedToId,
        status: updatedStatus,
        updatedAt: new Date(),
      },
      include: {
        items: {
          include: { product: true, allocations: { include: { bin: BIN_LOCATION_INCLUDE } } },
        },
        salesOrder: { include: { customer: true } },
        warehouse: true,
      },
    });

    await tx.auditLog.create({
      data: {
        userId,
        action: "pick_list_assigned",
        entityType: "PickList",
        entityId: pickListId,
        details: {
          pickListNumber: pickList.pickListNumber,
          assignedTo: assignedToId,
        },
      },
    });

    return result;
  });

  return updated;
}

/**
 * Starts a Pick List picking session
 */
export async function startPickList(pickListId: string, userId: string) {
  const pickList = await prisma.pickList.findUnique({
    where: { id: pickListId },
  });

  if (!pickList) throw new Error("Pick List not found");
  if (["COMPLETED", "CANCELLED"].includes(pickList.status)) {
    throw new Error(`Cannot start a Pick List in '${pickList.status}' status.`);
  }

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.pickList.update({
      where: { id: pickListId },
      data: {
        status: "IN_PROGRESS",
        startedAt: pickList.startedAt || new Date(),
        assignedTo: pickList.assignedTo || userId,
        updatedAt: new Date(),
      },
      include: {
        items: {
          include: { product: true, allocations: { include: { bin: BIN_LOCATION_INCLUDE } } },
        },
        salesOrder: { include: { customer: true } },
        warehouse: true,
      },
    });

    await tx.auditLog.create({
      data: {
        userId,
        action: "pick_list_started",
        entityType: "PickList",
        entityId: pickListId,
        details: {
          pickListNumber: pickList.pickListNumber,
          startedAt: result.startedAt,
        },
      },
    });

    return result;
  });

  return updated;
}

/**
 * Auto-suggests bin allocations for a Pick List based on available pickable stock in the warehouse
 */
export async function getPickingSuggestions(pickListId: string): Promise<SuggestedAllocation[]> {
  const pickList = await prisma.pickList.findUnique({
    where: { id: pickListId },
    include: {
      items: {
        include: {
          product: true,
          reservationItem: true,
        },
      },
    },
  });

  if (!pickList) throw new Error("Pick List not found");

  const suggestions: SuggestedAllocation[] = [];

  for (const item of pickList.items) {
    const neededQty = roundQty(item.requestedQuantity);
    if (neededQty <= 0) continue;

    // Get available bins for product in warehouse
    const availabilities = await getPickingAvailability(item.productId, pickList.warehouseId, pickListId);

    // Filter bins with pickable stock > 0, sorted by locationPath (logical picking path)
    const availableBins = availabilities
      .filter((b) => b.pickableStock > 0)
      .sort((a, b) => a.locationPath.localeCompare(b.locationPath));

    let accumulatedQty = 0;

    for (const bin of availableBins) {
      if (accumulatedQty >= neededQty) break;

      const remainingNeeded = roundQty(neededQty - accumulatedQty);
      const allocationQty = roundQty(Math.min(bin.pickableStock, remainingNeeded));

      suggestions.push({
        pickListItemId: item.id,
        productId: item.productId,
        binId: bin.binId,
        binCode: bin.binCode,
        locationPath: bin.locationPath,
        suggestedQuantity: allocationQty,
        pickableStock: bin.pickableStock,
      });

      accumulatedQty = roundQty(accumulatedQty + allocationQty);
    }
  }

  return suggestions;
}

/**
 * Sets / updates bin allocations for Pick List items
 */
export async function setPickAllocations(
  pickListId: string,
  allocationsInput: Array<{
    pickListItemId: string;
    binId: string;
    requestedQuantity: number;
    pickedQuantity?: number;
  }>,
  userId: string
) {
  const pickList = await prisma.pickList.findUnique({
    where: { id: pickListId },
    include: {
      items: true,
    },
  });

  if (!pickList) throw new Error("Pick List not found");
  if (["COMPLETED", "CANCELLED"].includes(pickList.status)) {
    throw new Error(`Cannot modify allocations for Pick List in '${pickList.status}' status.`);
  }

  // Group allocations by item ID for validation
  const itemAllocMap: Record<string, typeof allocationsInput> = {};
  for (const alloc of allocationsInput) {
    if (!itemAllocMap[alloc.pickListItemId]) itemAllocMap[alloc.pickListItemId] = [];
    (itemAllocMap[alloc.pickListItemId] as typeof allocationsInput).push(alloc);
  }

  // Validate allocations and physical bin availability
  for (const itemId of Object.keys(itemAllocMap)) {
    const item = pickList.items.find((i) => i.id === itemId);
    if (!item) {
      throw new Error(`Pick List Item '${itemId}' not found in Pick List.`);
    }

    const allocs = itemAllocMap[itemId] || [];
    const totalAllocatedReq = roundQty(allocs.reduce((sum, a) => sum + a.requestedQuantity, 0));

    if (totalAllocatedReq > item.requestedQuantity) {
      throw new Error(
        `Total requested bin allocation (${totalAllocatedReq}) exceeds Pick List item requested quantity (${item.requestedQuantity}).`
      );
    }

    for (const alloc of allocs) {
      // Validate bin
      const bin = await prisma.warehouseBin.findUnique({
        where: { id: alloc.binId },
      });

      if (!bin) throw new Error(`Bin '${alloc.binId}' does not exist.`);
      if (!bin.active) throw new Error(`Bin '${bin.code}' is deactivated.`);
      if (bin.warehouseId !== pickList.warehouseId) {
        throw new Error(`Bin '${bin.code}' does not belong to Pick List warehouse.`);
      }

      // Check pickable stock in bin
      const availabilities = await getPickingAvailability(item.productId, pickList.warehouseId, pickListId);
      const binAvail = availabilities.find((b) => b.binId === alloc.binId);
      const pickable = binAvail ? binAvail.pickableStock : 0;

      if (alloc.requestedQuantity > pickable) {
        throw new Error(
          `Bin '${bin.code}' has insufficient pickable stock (${pickable} m²/units available, ${alloc.requestedQuantity} requested).`
        );
      }
    }
  }

  // Execute Allocation Update Transaction
  return await prisma.$transaction(async (tx) => {
    for (const itemId of Object.keys(itemAllocMap)) {
      const item = pickList.items.find((i) => i.id === itemId);
      if (!item) continue;
      const allocs = itemAllocMap[itemId] || [];

      // Delete old allocations for this item
      await tx.pickAllocation.deleteMany({
        where: { pickListItemId: itemId },
      });

      let totalItemPicked = 0;

      for (const alloc of allocs) {
        const pickedVal = roundQty(alloc.pickedQuantity ?? alloc.requestedQuantity);
        totalItemPicked = roundQty(totalItemPicked + pickedVal);

        await tx.pickAllocation.create({
          data: {
            pickListItemId: itemId,
            binId: alloc.binId,
            productId: item.productId,
            requestedQuantity: roundQty(alloc.requestedQuantity),
            pickedQuantity: pickedVal,
            unitId: item.unitId,
          },
        });
      }

      // Recalculate item status
      const remaining = roundQty(Math.max(0, item.requestedQuantity - totalItemPicked));
      let itemStatus = "PENDING";
      if (totalItemPicked >= item.requestedQuantity) {
        itemStatus = "PICKED";
      } else if (totalItemPicked > 0) {
        itemStatus = "PARTIALLY_PICKED";
      }

      await tx.pickListItem.update({
        where: { id: itemId },
        data: {
          pickedQuantity: totalItemPicked,
          remainingQuantity: remaining,
          status: itemStatus,
          updatedAt: new Date(),
        },
      });

      await tx.auditLog.create({
        data: {
          userId,
          action: "pick_allocation_updated",
          entityType: "PickListItem",
          entityId: itemId,
          details: {
            pickListNumber: pickList.pickListNumber,
            allocationsCount: allocs.length,
            totalItemPicked,
            status: itemStatus,
          },
        },
      });
    }

    // Auto-update status to IN_PROGRESS if DRAFT / ASSIGNED
    if (["DRAFT", "ASSIGNED"].includes(pickList.status)) {
      await tx.pickList.update({
        where: { id: pickListId },
        data: {
          status: "IN_PROGRESS",
          startedAt: pickList.startedAt || new Date(),
          updatedAt: new Date(),
        },
      });
    }

    return await tx.pickList.findUnique({
      where: { id: pickListId },
      include: {
        items: {
          include: {
            product: true,
            allocations: {
              include: {
                bin: BIN_LOCATION_INCLUDE,
              },
            },
          },
        },
        salesOrder: { include: { customer: true } },
        warehouse: true,
      },
    });
  });
}

/**
 * Completes a Pick List
 * 
 * CRITICAL INVARIANT:
 * - StockAllocation.quantity MUST remain unchanged.
 * - StockLocationAllocation.quantity MUST remain unchanged.
 * - StockMovement MUST remain unchanged.
 * - Reservation quantities MUST NOT be modified.
 */
export async function completePickList(
  pickListId: string,
  userId: string,
  options: { allowShort?: boolean } = {}
) {
  const pickList = await prisma.pickList.findUnique({
    where: { id: pickListId },
    include: {
      items: {
        include: {
          allocations: true,
        },
      },
      reservation: true,
      salesOrder: true,
    },
  });

  if (!pickList) throw new Error("Pick List not found");
  if (pickList.status === "COMPLETED") {
    throw new Error("Pick List is already COMPLETED.");
  }
  if (pickList.status === "CANCELLED") {
    throw new Error("Cannot complete a CANCELLED Pick List.");
  }

  // Check picking progress
  let hasShort = false;
  let unfulfilledCount = 0;

  for (const item of pickList.items) {
    if (item.pickedQuantity < item.requestedQuantity) {
      hasShort = true;
      unfulfilledCount++;
    }
  }

  if (hasShort && !options.allowShort) {
    throw new Error(
      `Pick List is not fully picked (${unfulfilledCount} line(s) short). Enable short pick approval to complete.`
    );
  }

  return await prisma.$transaction(async (tx) => {
    // Process items and mark SHORT if partial
    for (const item of pickList.items) {
      const isShort = item.pickedQuantity < item.requestedQuantity;
      const status = isShort ? "SHORT" : "PICKED";

      await tx.pickListItem.update({
        where: { id: item.id },
        data: {
          status,
          updatedAt: new Date(),
        },
      });

      if (isShort) {
        const shortQty = roundQty(item.requestedQuantity - item.pickedQuantity);
        await tx.auditLog.create({
          data: {
            userId,
            action: "short_pick_recorded",
            entityType: "PickListItem",
            entityId: item.id,
            details: {
              pickListNumber: pickList.pickListNumber,
              requestedQuantity: item.requestedQuantity,
              pickedQuantity: item.pickedQuantity,
              shortQuantity: shortQty,
            },
          },
        });
      }
    }

    // Complete Pick List
    const completed = await tx.pickList.update({
      where: { id: pickListId },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
        updatedAt: new Date(),
      },
      include: {
        items: {
          include: {
            product: true,
            allocations: {
              include: {
                bin: BIN_LOCATION_INCLUDE,
              },
            },
          },
        },
        salesOrder: { include: { customer: true } },
        warehouse: true,
        reservation: true,
      },
    });

    await tx.auditLog.create({
      data: {
        userId,
        action: "pick_list_completed",
        entityType: "PickList",
        entityId: pickListId,
        details: {
          pickListNumber: pickList.pickListNumber,
          reservationNumber: pickList.reservation.reservationNumber,
          completedAt: completed.completedAt,
          hasShortPicks: hasShort ? true : false,
        },
      },
    });

    return completed;
  });
}

/**
 * Cancels a Pick List and releases pick allocations
 */
export async function cancelPickList(
  pickListId: string,
  reason: string | undefined,
  userId: string
) {
  const pickList = await prisma.pickList.findUnique({
    where: { id: pickListId },
  });

  if (!pickList) throw new Error("Pick List not found");
  if (pickList.status === "COMPLETED") {
    throw new Error("Cannot cancel a COMPLETED Pick List.");
  }
  if (pickList.status === "CANCELLED") {
    throw new Error("Pick List is already CANCELLED.");
  }

  return await prisma.$transaction(async (tx) => {
    const cancelled = await tx.pickList.update({
      where: { id: pickListId },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
        cancellationReason: reason || null,
        updatedAt: new Date(),
      },
      include: {
        items: {
          include: {
            product: true,
            allocations: true,
          },
        },
        salesOrder: { include: { customer: true } },
        warehouse: true,
      },
    });

    await tx.auditLog.create({
      data: {
        userId,
        action: "pick_list_cancelled",
        entityType: "PickList",
        entityId: pickListId,
        details: {
          pickListNumber: pickList.pickListNumber,
          cancelledAt: cancelled.cancelledAt,
          reason,
        },
      },
    });

    return cancelled;
  });
}

/**
 * Fetches Pick Lists with search, filtering, and pagination
 */
export async function getPickLists(query: GetPickListsQuery = {}) {
  const {
    search,
    status,
    warehouseId,
    salesOrderId,
    assignedTo,
    page = 1,
    limit = 10,
    sortBy = "createdAt",
    sortOrder = "desc",
  } = query;

  const where: any = {};

  if (status) where.status = status;
  if (warehouseId) where.warehouseId = warehouseId;
  if (salesOrderId) where.salesOrderId = salesOrderId;
  if (assignedTo) where.assignedTo = assignedTo;

  if (search) {
    where.OR = [
      { pickListNumber: { contains: search, mode: "insensitive" } },
      { salesOrder: { salesOrderNumber: { contains: search, mode: "insensitive" } } },
      { salesOrder: { customer: { name: { contains: search, mode: "insensitive" } } } },
    ];
  }

  const skip = (page - 1) * limit;

  const [total, items] = await Promise.all([
    prisma.pickList.count({ where }),
    prisma.pickList.findMany({
      where,
      skip,
      take: limit,
      orderBy: { [sortBy]: sortOrder },
      include: {
        items: {
          include: {
            product: true,
            allocations: {
              include: {
                bin: true,
              },
            },
          },
        },
        salesOrder: {
          include: {
            customer: true,
          },
        },
        warehouse: true,
        reservation: true,
      },
    }),
  ]);

  return {
    items,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
  };
}

/**
 * Fetches a single Pick List by ID with detailed relations
 */
export async function getPickListById(id: string) {
  const pickList = await prisma.pickList.findUnique({
    where: { id },
    include: {
      items: {
        include: {
          product: true,
          reservationItem: true,
          allocations: {
            include: {
              bin: BIN_LOCATION_INCLUDE,
            },
          },
        },
      },
      salesOrder: {
        include: {
          customer: true,
        },
      },
      warehouse: true,
      reservation: {
        include: {
          items: true,
        },
      },
    },
  });

  if (!pickList) return null;

  // Enrich bin allocations with locationPath formatting
  const enrichedItems = pickList.items.map((item: any) => ({
    ...item,
    allocations: item.allocations.map((alloc: any) => ({
      ...alloc,
      locationPath: formatLocationPath(alloc.bin),
    })),
  }));

  return {
    ...pickList,
    items: enrichedItems,
  };
}

export type PickingStrategy = "FEFO" | "FIFO" | "LOCATION_PATH" | "MANUAL";

export interface StrategyPickingSuggestion {
  pickListItemId: string;
  productId: string;
  productName: string;
  productSku: string | null;
  batchId: string | null;
  batchNumber: string | null;
  lotNumber: string | null;
  heatNumber: string | null;
  expiryDate: Date | null;
  binId: string;
  binCode: string;
  locationPath: string;
  availableQuantity: number;
  reservedQuantity: number;
  suggestedQuantity: number;
  pickingStrategyUsed: PickingStrategy;
  recommendationReason: string;
}

/**
 * Strategy-driven picking suggestion engine (FEFO, FIFO, LOCATION_PATH, MANUAL)
 */
export async function getStrategyPickingSuggestions(params: {
  pickListId: string;
  strategy?: PickingStrategy;
}): Promise<StrategyPickingSuggestion[]> {
  const { pickListId, strategy } = params;

  const pickList = await getPickListById(pickListId);
  if (!pickList) throw new Error("Pick List not found");

  const suggestions: StrategyPickingSuggestion[] = [];

  for (const item of pickList.items) {
    const unpickedQty = Math.max(0, item.requestedQuantity - item.pickedQuantity);
    if (unpickedQty <= 0) continue;

    const product = item.product;
    const isBatchTracked = product?.trackingMode && product.trackingMode !== "NONE";

    let chosenStrategy: PickingStrategy = strategy || (product?.expirationDate ? "FEFO" : "FIFO");
    if (strategy === "MANUAL") chosenStrategy = "MANUAL";

    const availableBins = await getPickingAvailability(item.productId, pickList.warehouseId);
    if (availableBins.length === 0) continue;

    if (isBatchTracked) {
      // Query active batches for product & warehouse
      const batches = await prisma.inventoryBatch.findMany({
        where: {
          productId: item.productId,
          warehouseId: pickList.warehouseId,
          status: "ACTIVE",
          quantity: { gt: 0 },
        },
      });

      // Sort batches according to chosen strategy
      batches.sort((a, b) => {
        if (chosenStrategy === "FEFO") {
          const expA = a.expiryDate ? new Date(a.expiryDate).getTime() : Number.MAX_SAFE_INTEGER;
          const expB = b.expiryDate ? new Date(b.expiryDate).getTime() : Number.MAX_SAFE_INTEGER;
          if (expA !== expB) return expA - expB;
        }
        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      });

      let remaining = unpickedQty;
      for (const batch of batches) {
        const availBatch = Math.max(0, batch.quantity - batch.reservedQuantity);
        if (availBatch <= 0) continue;

        for (const bin of availableBins) {
          if (bin.pickableStock <= 0) continue;

          const allocQty = Math.min(remaining, availBatch, bin.pickableStock);
          if (allocQty <= 0) continue;

          remaining -= allocQty;
          bin.pickableStock -= allocQty;

          const reason = chosenStrategy === "FEFO"
            ? `FEFO Batch ${batch.batchNumber} (Exp: ${batch.expiryDate ? new Date(batch.expiryDate).toLocaleDateString() : "N/A"})`
            : `FIFO Batch ${batch.batchNumber} (Received: ${new Date(batch.createdAt).toLocaleDateString()})`;

          suggestions.push({
            pickListItemId: item.id,
            productId: item.productId,
            productName: product.name,
            productSku: product.sku || null,
            batchId: batch.id,
            batchNumber: batch.batchNumber,
            lotNumber: batch.lotNumber || null,
            heatNumber: batch.heatNumber || null,
            expiryDate: batch.expiryDate || null,
            binId: bin.binId,
            binCode: bin.binCode,
            locationPath: bin.locationPath,
            availableQuantity: availBatch,
            reservedQuantity: batch.reservedQuantity,
            suggestedQuantity: allocQty,
            pickingStrategyUsed: chosenStrategy,
            recommendationReason: reason,
          });

          if (remaining <= 0) break;
        }
        if (remaining <= 0) break;
      }
    } else {
      // Non-batch tracked: allocate across bins
      if (chosenStrategy === "LOCATION_PATH") {
        availableBins.sort((a: any, b: any) => a.locationPath.localeCompare(b.locationPath));
      }

      let remaining = unpickedQty;
      for (const bin of availableBins) {
        if (bin.pickableStock <= 0) continue;

        const allocQty = Math.min(remaining, bin.pickableStock);
        if (allocQty <= 0) continue;

        remaining -= allocQty;
        bin.pickableStock -= allocQty;

        suggestions.push({
          pickListItemId: item.id,
          productId: item.productId,
          productName: product.name,
          productSku: product.sku || null,
          batchId: null,
          batchNumber: null,
          lotNumber: null,
          heatNumber: null,
          expiryDate: null,
          binId: bin.binId,
          binCode: bin.binCode,
          locationPath: bin.locationPath,
          availableQuantity: bin.pickableStock + allocQty,
          reservedQuantity: 0,
          suggestedQuantity: allocQty,
          pickingStrategyUsed: chosenStrategy,
          recommendationReason: `Optimal Location Bin ${bin.binCode}`,
        });

        if (remaining <= 0) break;
      }
    }
  }

  return suggestions;
}
