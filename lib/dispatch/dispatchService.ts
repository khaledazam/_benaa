import { prisma } from "@/prisma/client";
import { executeStockMutationInTx, StockMovementTypes } from "@/lib/inventory/stockService";
import { deductBatchQuantityInTx, validateProductTrackingModeInTx } from "@/lib/inventory/batchService";

export interface GetDispatchesQuery {
  search?: string;
  status?: string;
  warehouseId?: string;
  salesOrderId?: string;
  pickListId?: string;
  page?: number;
  limit?: number;
  sortBy?: "dispatchNumber" | "createdAt" | "status";
  sortOrder?: "asc" | "desc";
}

/**
 * Generates unique Dispatch Number: DSP-2026-XXXXXX
 */
export async function generateDispatchNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `DSP-${year}-`;

  const lastDispatch = await prisma.dispatch.findFirst({
    where: { dispatchNumber: { startsWith: prefix } },
    orderBy: { dispatchNumber: "desc" },
    select: { dispatchNumber: true },
  });

  let nextSequence = 1;
  const lastNum = lastDispatch?.dispatchNumber;
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
 * Formats full physical location path for display:
 * Zone / Rack / Shelf / Bin
 */
export function formatLocationPath(bin: any): string {
  if (!bin) return "";
  const parts: string[] = [];
  if (bin.shelf?.rack?.zone?.name) parts.push(`Zone ${bin.shelf.rack.zone.name}`);
  if (bin.shelf?.rack?.code) parts.push(`Rack ${bin.shelf.rack.code}`);
  if (bin.shelf?.code) parts.push(`Shelf ${bin.shelf.code}`);
  parts.push(`Bin ${bin.code || ""}`);
  return parts.join(" / ");
}

/**
 * Helper to round quantities to 2 decimals safely
 */
function roundQty(val: number): number {
  return Math.round((val + Number.EPSILON) * 100) / 100;
}

/**
 * Creates a DRAFT Dispatch from a COMPLETED PickList.
 * Zero physical stock mutation occurs during creation.
 */
export async function createDispatch(pickListId: string, userId: string, notes?: string) {
  // 1. Fetch PickList with items and bin allocations
  const pickList: any = await prisma.pickList.findUnique({
    where: { id: pickListId },
    include: {
      salesOrder: {
        include: { customer: true },
      },
      warehouse: true,
      items: {
        include: {
          product: true,
          allocations: {
            include: {
              bin: {
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
              },
            },
          },
        },
      },
    },
  });

  if (!pickList) throw new Error("Pick List not found");
  if (pickList.status !== "COMPLETED") {
    throw new Error(`Cannot create Dispatch for Pick List in status '${pickList.status}'. Must be COMPLETED.`);
  }

  if (["COMPLETED", "CANCELLED"].includes(pickList.salesOrder.status)) {
    throw new Error(`Cannot create Dispatch for Sales Order in terminal status '${pickList.salesOrder.status}'.`);
  }

  // 2. Check for existing active or posted Dispatch for this PickList
  const existingDispatch = await prisma.dispatch.findFirst({
    where: {
      pickListId,
      status: { in: ["DRAFT", "POSTED"] },
    },
  });

  if (existingDispatch) {
    throw new Error(`A Dispatch (${existingDispatch.dispatchNumber}) already exists for Pick List '${pickList.pickListNumber}' in '${existingDispatch.status}' status.`);
  }

  // 3. Generate Dispatch Number
  const dispatchNumber = await generateDispatchNumber();

  // 4. Build Dispatch items with bin allocation snapshots
  const dispatchItemsData = (pickList.items || []).map((item: any) => {
    const pickedQty = roundQty((item.allocations || []).reduce((sum: number, a: any) => sum + (a.pickedQuantity || 0), 0));
    const dispatchedQty = pickedQty;

    const binAllocationsData = (item.allocations || [])
      .filter((a: any) => (a.pickedQuantity || 0) > 0)
      .map((a: any) => ({
        binId: a.binId,
        productId: a.productId,
        dispatchedQuantity: a.pickedQuantity,
        unitId: a.unitId,
        locationPath: formatLocationPath(a.bin),
      }));

    return {
      salesOrderItemId: item.salesOrderItemId,
      pickListItemId: item.id,
      productId: item.productId,
      productName: item.product.name,
      productSku: item.product.sku || null,
      unitId: item.unitId,
      unitSymbol: item.unitSymbol,
      requestedQuantity: item.requestedQuantity,
      pickedQuantity: pickedQty,
      dispatchedQuantity: dispatchedQty,
      binAllocations: {
        create: binAllocationsData,
      },
    };
  });

  // 5. Create DRAFT Dispatch inside a transaction
  const dispatch = await prisma.$transaction(async (tx: any) => {
    const created = await tx.dispatch.create({
      data: {
        dispatchNumber,
        salesOrderId: pickList.salesOrderId,
        pickListId: pickList.id,
        warehouseId: pickList.warehouseId,
        status: "DRAFT",
        createdBy: userId,
        notes: notes?.trim() || null,
        customerNameSnapshot: pickList.salesOrder.customerNameSnapshot || pickList.salesOrder.customer?.name || null,
        customerCodeSnapshot: pickList.salesOrder.customerCodeSnapshot || pickList.salesOrder.customer?.code || null,
        items: {
          create: dispatchItemsData,
        },
      },
      include: {
        items: {
          include: {
            binAllocations: {
              include: { bin: true },
            },
          },
        },
        salesOrder: true,
        pickList: true,
        warehouse: true,
      },
    });

    await tx.auditLog.create({
      data: {
        userId,
        action: "dispatch_created",
        entityType: "Dispatch",
        entityId: created.id,
        details: {
          dispatchNumber: created.dispatchNumber,
          salesOrderNumber: pickList.salesOrder.salesOrderNumber,
          pickListNumber: pickList.pickListNumber,
          warehouseId: pickList.warehouseId,
        },
      },
    });

    return created;
  });

  return dispatch;
}

/**
 * ATOMICALLY Posts a Dispatch (DRAFT -> POSTED)
 * Performs physical stock deduction, SALE StockMovements, reservation reconciliation, and order completion inside ONE transaction.
 */
export async function postDispatch(dispatchId: string, userId: string) {
  return await prisma.$transaction(async (tx: any) => {
    // 1. Fetch & lock Dispatch in DRAFT status via atomic lock
    if (tx.dispatch?.updateMany) {
      const lock = await tx.dispatch.updateMany({
        where: { id: dispatchId, status: "DRAFT" },
        data: { status: "POSTED", postedBy: userId, postedAt: new Date(), updatedAt: new Date() },
      });
      if (lock.count === 0) {
        throw new Error(`Dispatch has already been posted or is not in DRAFT status.`);
      }
    } else {
      const existing = await tx.dispatch.findUnique({ where: { id: dispatchId } });
      if (!existing || existing.status !== "DRAFT") {
        throw new Error(`Dispatch '${existing?.dispatchNumber || dispatchId}' is in status '${existing?.status}' and cannot be posted.`);
      }
      await tx.dispatch.update({
        where: { id: dispatchId },
        data: { status: "POSTED", postedBy: userId, postedAt: new Date(), updatedAt: new Date() },
      });
    }

    const dispatch: any = await tx.dispatch.findUnique({
      where: { id: dispatchId },
      include: {
        salesOrder: true,
        pickList: true,
        warehouse: true,
        items: {
          include: {
            binAllocations: {
              include: { bin: true },
            },
          },
        },
      },
    });

    if (!dispatch) throw new Error("Dispatch not found");

    // Validate Preconditions
    if (dispatch.pickList.status !== "COMPLETED") {
      throw new Error(`Pick List '${dispatch.pickList.pickListNumber}' must be COMPLETED to post Dispatch.`);
    }

    if (["COMPLETED", "CANCELLED"].includes(dispatch.salesOrder.status)) {
      throw new Error(`Sales Order '${dispatch.salesOrder.salesOrderNumber}' is in terminal status '${dispatch.salesOrder.status}'.`);
    }

    // 3. Physical Stock Validation & Deduction per item & bin allocation
    for (const item of dispatch.items) {
      if (item.dispatchedQuantity <= 0) continue;
      if (item.dispatchedQuantity > item.pickedQuantity) {
        throw new Error(`Dispatched quantity (${item.dispatchedQuantity}) exceeds picked quantity (${item.pickedQuantity}) for product '${item.productName}'.`);
      }

      // Check warehouse physical stock
      const warehouseAlloc: any = await tx.stockAllocation.findUnique({
        where: { productId_warehouseId: { productId: item.productId, warehouseId: dispatch.warehouseId } },
      });
      const currentWhStock = warehouseAlloc ? Number(warehouseAlloc.quantity) : 0;
      if (currentWhStock < item.dispatchedQuantity) {
        throw new Error(
          `Insufficient physical stock in warehouse for '${item.productName}'. Available: ${currentWhStock}, Required: ${item.dispatchedQuantity}`
        );
      }

      // Process bin allocations
      for (const binAlloc of item.binAllocations) {
        if (binAlloc.dispatchedQuantity <= 0) continue;

        // Verify bin belongs to warehouse
        if (binAlloc.bin.warehouseId !== dispatch.warehouseId) {
          throw new Error(`Source bin '${binAlloc.bin.code}' belongs to warehouse '${binAlloc.bin.warehouseId}', not '${dispatch.warehouseId}'.`);
        }

        // Verify bin physical stock
        const locAlloc: any = await tx.stockLocationAllocation.findUnique({
          where: { productId_binId: { productId: item.productId, binId: binAlloc.binId } },
        });
        const currentBinStock = locAlloc ? Number(locAlloc.quantity) : 0;
        if (currentBinStock < binAlloc.dispatchedQuantity) {
          throw new Error(
            `Insufficient physical stock in bin '${binAlloc.bin.code}' for '${item.productName}'. Available: ${currentBinStock}, Required: ${binAlloc.dispatchedQuantity}`
          );
        }

        // Execute physical stock mutation via stockService helper
        const mutationRes = await executeStockMutationInTx(tx, {
          productId: item.productId,
          warehouseId: dispatch.warehouseId,
          sourceBinId: binAlloc.binId,
          quantity: binAlloc.dispatchedQuantity,
          unitId: item.unitId,
          movementType: StockMovementTypes.SALE,
          referenceType: "DISPATCH",
          referenceId: dispatch.id,
          reason: `Dispatch #${dispatch.dispatchNumber} for Sales Order ${dispatch.salesOrder.salesOrderNumber}`,
          performedBy: userId,
        });

        // Deduct batch quantity if item or pick allocation has assigned batchId
        if (item.batchId) {
          await deductBatchQuantityInTx(tx, item.batchId, binAlloc.dispatchedQuantity);
          if (mutationRes?.movementId) {
            await tx.stockMovement.update({
              where: { id: mutationRes.movementId },
              data: { batchId: item.batchId, batchNumber: item.batchNumber },
            });
          }
        }

        await tx.auditLog.create({
          data: {
            userId,
            action: "stock_deducted_by_dispatch",
            entityType: "Dispatch",
            entityId: dispatch.id,
            details: {
              dispatchNumber: dispatch.dispatchNumber,
              productId: item.productId,
              productName: item.productName,
              binId: binAlloc.binId,
              binCode: binAlloc.bin.code,
              dispatchedQuantity: binAlloc.dispatchedQuantity,
              previousBinStock: currentBinStock,
              newBinStock: currentBinStock - binAlloc.dispatchedQuantity,
            },
          },
        });
      }
    }

    // 4. Reconcile StockReservation & StockReservationItems
    const reservation: any = await tx.stockReservation.findUnique({
      where: { id: dispatch.pickList.reservationId },
      include: { items: true },
    });

    if (reservation) {
      let allReservationItemsFulfilled = true;

      for (const resItem of reservation.items) {
        const dispatchItem = dispatch.items.find((di: any) => di.productId === resItem.productId);
        const dispatchedQty = dispatchItem ? dispatchItem.dispatchedQuantity : 0;

        const newReleasedQty = roundQty(resItem.releasedQuantity + dispatchedQty);
        const newRemainingQty = roundQty(Math.max(0, resItem.remainingQuantity - dispatchedQty));

        await tx.stockReservationItem.update({
          where: { id: resItem.id },
          data: {
            releasedQuantity: newReleasedQty,
            remainingQuantity: newRemainingQty,
          },
        });

        if (newRemainingQty > 0) {
          allReservationItemsFulfilled = false;
        }
      }

      const newReservationStatus = allReservationItemsFulfilled ? "FULFILLED" : "PARTIALLY_FULFILLED";
      await tx.stockReservation.update({
        where: { id: reservation.id },
        data: {
          status: newReservationStatus,
          updatedAt: new Date(),
        },
      });

      await tx.auditLog.create({
        data: {
          userId,
          action: "reservation_fulfilled_by_dispatch",
          entityType: "StockReservation",
          entityId: reservation.id,
          details: {
            dispatchNumber: dispatch.dispatchNumber,
            reservationNumber: reservation.reservationNumber,
            status: newReservationStatus,
          },
        },
      });
    }

    // 5. Reconcile SalesOrder status
    const salesOrder: any = await tx.salesOrder.findUnique({
      where: { id: dispatch.salesOrderId },
      include: { items: true },
    });

    if (salesOrder) {
      const postedDispatches: any[] = await tx.dispatch.findMany({
        where: {
          salesOrderId: dispatch.salesOrderId,
          status: "POSTED",
        },
        include: { items: true },
      });

      const totalDispatchedByProduct = new Map<string, number>();
      for (const item of dispatch.items) {
        totalDispatchedByProduct.set(item.productId, (totalDispatchedByProduct.get(item.productId) || 0) + item.dispatchedQuantity);
      }
      for (const prevDispatch of postedDispatches) {
        for (const item of prevDispatch.items || []) {
          totalDispatchedByProduct.set(item.productId, (totalDispatchedByProduct.get(item.productId) || 0) + item.dispatchedQuantity);
        }
      }

      let allOrderItemsDispatched = true;
      for (const soItem of salesOrder.items) {
        const totalDispatched = totalDispatchedByProduct.get(soItem.productId) || 0;
        if (totalDispatched < soItem.orderedQuantity) {
          allOrderItemsDispatched = false;
        }
      }

      const newSoStatus = allOrderItemsDispatched ? "COMPLETED" : "PROCESSING";
      await tx.salesOrder.update({
        where: { id: salesOrder.id },
        data: {
          status: newSoStatus,
          updatedAt: new Date(),
        },
      });

      if (newSoStatus === "COMPLETED") {
        await tx.auditLog.create({
          data: {
            userId,
            action: "sales_order_completed",
            entityType: "SalesOrder",
            entityId: salesOrder.id,
            details: {
              salesOrderNumber: salesOrder.salesOrderNumber,
              dispatchNumber: dispatch.dispatchNumber,
            },
          },
        });
      }
    }

    // 6. Update Dispatch status to POSTED
    const postedDispatch = await tx.dispatch.update({
      where: { id: dispatchId },
      data: {
        status: "POSTED",
        postedBy: userId,
        postedAt: new Date(),
        updatedAt: new Date(),
      },
      include: {
        items: {
          include: {
            binAllocations: {
              include: { bin: true },
            },
          },
        },
        salesOrder: true,
        pickList: true,
        warehouse: true,
      },
    });

    await tx.auditLog.create({
      data: {
        userId,
        action: "dispatch_posted",
        entityType: "Dispatch",
        entityId: postedDispatch.id,
        details: {
          dispatchNumber: postedDispatch.dispatchNumber,
          salesOrderNumber: dispatch.salesOrder.salesOrderNumber,
          pickListNumber: dispatch.pickList.pickListNumber,
        },
      },
    });

    return postedDispatch;
  }, { timeout: 30000 });
}

/**
 * Cancels a DRAFT Dispatch (DRAFT -> CANCELLED)
 * Zero physical stock mutation occurs.
 */
export async function cancelDispatch(dispatchId: string, reason: string | undefined, userId: string) {
  const dispatch = await prisma.dispatch.findUnique({
    where: { id: dispatchId },
  });

  if (!dispatch) throw new Error("Dispatch not found");
  if (dispatch.status !== "DRAFT") {
    throw new Error(`Cannot cancel Dispatch in status '${dispatch.status}'. Must be DRAFT.`);
  }

  const cancelled = await prisma.dispatch.update({
    where: { id: dispatchId },
    data: {
      status: "CANCELLED",
      cancelledBy: userId,
      cancelledAt: new Date(),
      cancellationReason: reason?.trim() || "Cancelled by user",
      updatedAt: new Date(),
    },
    include: {
      items: true,
      salesOrder: true,
      pickList: true,
      warehouse: true,
    },
  });

  await prisma.auditLog.create({
    data: {
      userId,
      action: "dispatch_cancelled",
      entityType: "Dispatch",
      entityId: cancelled.id,
      details: {
        dispatchNumber: cancelled.dispatchNumber,
        reason: cancelled.cancellationReason,
      },
    },
  });

  return cancelled;
}

/**
 * Retrieves a Dispatch by ID with full item, bin allocation, and StockMovement ledger
 */
export async function getDispatchById(id: string) {
  const dispatch: any = await prisma.dispatch.findUnique({
    where: { id },
    include: {
      salesOrder: {
        include: { customer: true },
      },
      pickList: {
        include: {
          reservation: true,
        },
      },
      warehouse: true,
      items: {
        include: {
          product: {
            select: {
              id: true,
              name: true,
              sku: true,
              size: true,
            },
          },
          binAllocations: {
            include: {
              bin: {
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
              },
            },
          },
        },
      },
    },
  });

  if (!dispatch) throw new Error("Dispatch not found");

  let movements: any[] = [];
  if (dispatch.status === "POSTED") {
    const rawMovements = await prisma.stockMovement.findMany({
      where: {
        referenceType: "DISPATCH",
        referenceId: dispatch.id,
      },
      orderBy: { createdAt: "asc" },
    });

    const productMap = new Map<string, any>();
    for (const item of dispatch.items || []) {
      if (item.productId && item.product) {
        productMap.set(item.productId, item.product);
      }
    }

    movements = rawMovements.map((m: any) => ({
      ...m,
      product: productMap.get(m.productId) || { name: "Product", sku: null },
    }));
  }

  return {
    ...dispatch,
    stockMovements: movements,
  };
}

/**
 * Paginated Listing & Search for Dispatches
 */
export async function getDispatches(query: GetDispatchesQuery = {}) {
  const page = Math.max(1, query.page || 1);
  const limit = Math.min(100, Math.max(1, query.limit || 20));
  const skip = (page - 1) * limit;

  const where: any = {};

  if (query.status) where.status = query.status;
  if (query.warehouseId) where.warehouseId = query.warehouseId;
  if (query.salesOrderId) where.salesOrderId = query.salesOrderId;
  if (query.pickListId) where.pickListId = query.pickListId;

  if (query.search && query.search.trim().length > 0) {
    const s = query.search.trim();
    where.OR = [
      { dispatchNumber: { contains: s, mode: "insensitive" } },
      { customerNameSnapshot: { contains: s, mode: "insensitive" } },
      { customerCodeSnapshot: { contains: s, mode: "insensitive" } },
    ];
  }

  const sortBy = query.sortBy || "createdAt";
  const sortOrder = query.sortOrder || "desc";

  const [items, total] = await Promise.all([
    prisma.dispatch.findMany({
      where,
      skip,
      take: limit,
      orderBy: { [sortBy]: sortOrder },
      include: {
        salesOrder: {
          select: { salesOrderNumber: true },
        },
        pickList: {
          select: { pickListNumber: true },
        },
        warehouse: {
          select: { id: true, name: true, code: true },
        },
        items: {
          select: { id: true, requestedQuantity: true, pickedQuantity: true, dispatchedQuantity: true },
        },
      },
    }),
    prisma.dispatch.count({ where }),
  ]);

  return {
    items,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

/**
 * Preview physical stock impact of posting a DRAFT Dispatch.
 * Read-only lookup. Zero mutation.
 */
export async function previewDispatch(dispatchId: string) {
  const dispatch: any = await prisma.dispatch.findUnique({
    where: { id: dispatchId },
    include: {
      warehouse: true,
      items: {
        include: {
          product: true,
          binAllocations: {
            include: {
              bin: {
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
              },
            },
          },
        },
      },
    },
  });

  if (!dispatch) throw new Error("Dispatch not found");

  const previews = [];

  for (const item of dispatch.items) {
    const whAlloc: any = await prisma.stockAllocation.findUnique({
      where: { productId_warehouseId: { productId: item.productId, warehouseId: dispatch.warehouseId } },
    });
    const currentWhStock = whAlloc ? Number(whAlloc.quantity) : 0;
    const newWhStock = Math.max(0, currentWhStock - item.dispatchedQuantity);

    const binPreviews = [];
    for (const binAlloc of item.binAllocations) {
      const locAlloc: any = await prisma.stockLocationAllocation.findUnique({
        where: { productId_binId: { productId: item.productId, binId: binAlloc.binId } },
      });
      const currentBinStock = locAlloc ? Number(locAlloc.quantity) : 0;
      const newBinStock = Math.max(0, currentBinStock - binAlloc.dispatchedQuantity);

      binPreviews.push({
        binId: binAlloc.binId,
        binCode: binAlloc.bin.code,
        locationPath: formatLocationPath(binAlloc.bin),
        dispatchedQuantity: binAlloc.dispatchedQuantity,
        currentBinStock,
        newBinStock,
        sufficient: currentBinStock >= binAlloc.dispatchedQuantity,
      });
    }

    previews.push({
      productId: item.productId,
      productName: item.productName,
      productSku: item.productSku,
      dispatchedQuantity: item.dispatchedQuantity,
      currentWarehouseStock: currentWhStock,
      newWarehouseStock: newWhStock,
      sufficientWarehouseStock: currentWhStock >= item.dispatchedQuantity,
      bins: binPreviews,
    });
  }

  return {
    dispatchId,
    dispatchNumber: dispatch.dispatchNumber,
    warehouseId: dispatch.warehouseId,
    warehouseName: dispatch.warehouse?.name,
    items: previews,
  };
}

/**
 * Updates delivery status (POSTED -> OUT_FOR_DELIVERY -> DELIVERED)
 * ZERO physical stock mutation occurs during delivery status updates.
 */
export async function updateDeliveryStatus(
  dispatchId: string,
  deliveryStatus: string,
  deliveryData: {
    driverName?: string;
    driverPhone?: string;
    vehicleNumber?: string;
    deliveryAddress?: string;
    routeNotes?: string;
  },
  userId: string
) {
  const dispatch = await prisma.dispatch.findUnique({ where: { id: dispatchId } });
  if (!dispatch) throw new Error("Dispatch not found");

  const allowedStatuses = ["POSTED", "OUT_FOR_DELIVERY", "DELIVERED", "CANCELLED"];
  if (!allowedStatuses.includes(deliveryStatus)) {
    throw new Error(`Invalid delivery status '${deliveryStatus}'. Must be one of: ${allowedStatuses.join(", ")}`);
  }

  const updated = await prisma.dispatch.update({
    where: { id: dispatchId },
    data: {
      deliveryStatus,
      driverName: deliveryData.driverName || dispatch.driverName,
      driverPhone: deliveryData.driverPhone || dispatch.driverPhone,
      vehicleNumber: deliveryData.vehicleNumber || dispatch.vehicleNumber,
      deliveryAddress: deliveryData.deliveryAddress || dispatch.deliveryAddress,
      routeNotes: deliveryData.routeNotes || dispatch.routeNotes,
      deliveredAt: deliveryStatus === "DELIVERED" ? new Date() : dispatch.deliveredAt,
      deliveredBy: deliveryStatus === "DELIVERED" ? userId : dispatch.deliveredBy,
      updatedAt: new Date(),
    },
  });

  await prisma.auditLog.create({
    data: {
      userId,
      action: "delivery_status_changed",
      entityType: "Dispatch",
      entityId: dispatchId,
      details: { deliveryStatus, driverName: deliveryData.driverName },
    },
  });

  return updated;
}
