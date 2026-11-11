import { authorizeInventoryPosting } from "./postingAuthorization";
import { inventoryTransaction } from "./transaction";
import { stockUnits, STOCK_SCALE, addStock } from "./quantity";
import { prisma } from "@/prisma/client";
import { roundQty, createAdjustment, postAdjustmentInTx } from "@/lib/inventory/adjustmentService";
import { CreateCountInput, RecordCountItemsInput } from "@/lib/validations/count-validations";

export async function generateCountNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `CNT-${year}-`;

  const last = await prisma.inventoryCount.findFirst({
    where: { countNumber: { startsWith: prefix } },
    orderBy: { countNumber: "desc" },
    select: { countNumber: true },
  });

  let seq = 1;
  if (last?.countNumber) {
    const parts = last.countNumber.split("-");
    const lastPart = parts[parts.length - 1];
    const lastSeq = lastPart ? parseInt(lastPart, 10) : NaN;
    if (!isNaN(lastSeq)) seq = lastSeq + 1;
  }

  return `${prefix}${seq.toString().padStart(6, "0")}`;
}

export async function createInventoryCount(data: CreateCountInput, userId: string) {
  const warehouse = await prisma.warehouse.findUnique({
    where: { id: data.warehouseId },
  });
  if (!warehouse) throw new Error("Warehouse not found");

  let scopeName: string | null = null;
  if (data.scopeId) {
    if (data.scopeType === "BIN") {
      const bin = await prisma.warehouseBin.findUnique({ where: { id: data.scopeId } });
      scopeName = bin ? `Bin: ${bin.code}` : null;
    } else if (data.scopeType === "ZONE") {
      const zone = await prisma.warehouseZone.findUnique({ where: { id: data.scopeId } });
      scopeName = zone ? `Zone: ${zone.name}` : null;
    } else if (data.scopeType === "PRODUCT") {
      const prod = await prisma.product.findUnique({ where: { id: data.scopeId } });
      scopeName = prod ? `Product: ${prod.name}` : null;
    } else if (data.scopeType === "CATEGORY") {
      const cat = await prisma.category.findUnique({ where: { id: data.scopeId } });
      scopeName = cat ? `Category: ${cat.name}` : null;
    }
  }

  const countNumber = await generateCountNumber();
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, username: true } });
  const createdByName = user?.name || user?.username || "System User";

  const count = await prisma.inventoryCount.create({
    data: {
      countNumber,
      warehouseId: data.warehouseId,
      warehouseName: warehouse.name,
      scopeType: data.scopeType,
      scopeId: data.scopeId || null,
      scopeName: scopeName || data.scopeType,
      status: "DRAFT",
      countMode: data.countMode || "OPEN_COUNT",
      createdBy: userId,
      createdByName,
      notes: data.notes || null,
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
      action: "inventory_count_created",
      entityType: "InventoryCount",
      entityId: count.id,
      details: { countNumber, scopeType: data.scopeType, status: "DRAFT" },
    },
  });

  return count;
}

export async function startInventoryCount(countId: string, userId: string) {
  const count = await prisma.inventoryCount.findUnique({
    where: { id: countId },
  });
  if (!count) throw new Error("Inventory count not found");
  if (count.status !== "DRAFT") {
    throw new Error(`Cannot start count in '${count.status}' status. Must be DRAFT.`);
  }

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, username: true } });
  const startedByName = user?.name || user?.username || "User";

  // Build items by snapshotting system quantities based on scope
  const itemCreations: any[] = [];

  if (count.scopeType === "BIN" && count.scopeId) {
    const bin = await prisma.warehouseBin.findUnique({ where: { id: count.scopeId } });
    if (!bin) throw new Error("Target bin not found");

    const slas = await prisma.stockLocationAllocation.findMany({
      where: { binId: count.scopeId, warehouseId: count.warehouseId },
      include: { product: true },
    });

    for (const sla of slas) {
      itemCreations.push({
        productId: sla.productId,
        productName: sla.product.name,
        productSku: sla.product.sku,
        binId: count.scopeId,
        locationPath: bin.locationPath || bin.code,
        unitId: sla.unitId || sla.product.unitId || null,
        systemQuantity: stockUnits(sla.quantity) / STOCK_SCALE,
      });
    }
  } else if (count.scopeType === "PRODUCT" && count.scopeId) {
    const product = await prisma.product.findUnique({ where: { id: count.scopeId } });
    if (!product) throw new Error("Target product not found");

    const slas = await prisma.stockLocationAllocation.findMany({
      where: { productId: count.scopeId, warehouseId: count.warehouseId },
      include: { bin: true },
    });

    if (slas.length > 0) {
      for (const sla of slas) {
        itemCreations.push({
          productId: product.id,
          productName: product.name,
          productSku: product.sku,
          binId: sla.binId,
          locationPath: sla.bin?.locationPath || sla.bin?.code || null,
          unitId: product.unitId || null,
          systemQuantity: stockUnits(sla.quantity) / STOCK_SCALE,
        });
      }
    } else {
      const sa = await prisma.stockAllocation.findUnique({
        where: { productId_warehouseId: { productId: product.id, warehouseId: count.warehouseId } },
      });
      itemCreations.push({
        productId: product.id,
        productName: product.name,
        productSku: product.sku,
        binId: null,
        locationPath: "Unassigned",
        unitId: product.unitId || null,
        systemQuantity: stockUnits(sa?.quantity ?? 0) / STOCK_SCALE,
      });
    }
  } else {
    // WAREHOUSE, ZONE, RACK, SHELF, CATEGORY, HIGH_VALUE, LOW_STOCK
    const slas = await prisma.stockLocationAllocation.findMany({
      where: { warehouseId: count.warehouseId },
      include: { product: true, bin: true },
    });

    for (const sla of slas) {
      let includeProduct = true;
      if (count.scopeType === "CATEGORY" && count.scopeId) {
        if (sla.product.categoryId !== count.scopeId) includeProduct = false;
      } else if (count.scopeType === "LOW_STOCK") {
        const minStock = sla.product.minimumStock ?? 0;
        if (minStock <= 0 || sla.quantity > minStock) includeProduct = false;
      }

      if (includeProduct) {
        itemCreations.push({
          productId: sla.productId,
          productName: sla.product.name,
          productSku: sla.product.sku,
          binId: sla.binId,
          locationPath: sla.bin?.locationPath || sla.bin?.code || null,
          unitId: sla.unitId || sla.product.unitId || null,
          systemQuantity: stockUnits(sla.quantity) / STOCK_SCALE,
        });
      }
    }
  }

  const updated = await prisma.inventoryCount.update({
    where: { id: countId },
    data: {
      status: "IN_PROGRESS",
      startedBy: userId,
      startedAt: new Date(),
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
      action: "inventory_count_started",
      entityType: "InventoryCount",
      entityId: countId,
      details: { countNumber: count.countNumber, itemCount: itemCreations.length, startedByName },
    },
  });

  return updated;
}

export async function recordCountItems(countId: string, input: RecordCountItemsInput, userId: string) {
  const count = await prisma.inventoryCount.findUnique({
    where: { id: countId },
    include: { items: true },
  });
  if (!count) throw new Error("Inventory count not found");
  if (count.status !== "IN_PROGRESS") {
    throw new Error(`Cannot record items in '${count.status}' status. Must be IN_PROGRESS.`);
  }

  for (const itemRecord of input.items) {
    const targetItem = count.items.find(
      (i) => i.productId === itemRecord.productId && (itemRecord.binId ? i.binId === itemRecord.binId : !i.binId)
    );

    if (targetItem) {
      const sysQty = stockUnits(targetItem.systemQuantity) / STOCK_SCALE;
      const cntQty = stockUnits(itemRecord.countedQuantity) / STOCK_SCALE;
      const varQty = addStock(cntQty, -sysQty);
      let varPct = 0;
      if (sysQty > 0) {
        varPct = roundQty((varQty / sysQty) * 100);
      } else if (cntQty > 0) {
        varPct = 100;
      }

      await prisma.inventoryCountItem.update({
        where: { id: targetItem.id },
        data: {
          countedQuantity: cntQty,
          varianceQuantity: varQty,
          variancePercentage: varPct,
          notes: itemRecord.notes || targetItem.notes,
          countedBy: userId,
          countedAt: new Date(),
        },
      });
    }
  }

  return await getInventoryCountById(countId);
}

export async function submitInventoryCount(countId: string, userId: string) {
  const count = await prisma.inventoryCount.findUnique({
    where: { id: countId },
    include: { items: true },
  });
  if (!count) throw new Error("Inventory count not found");
  if (count.status !== "IN_PROGRESS") {
    throw new Error(`Cannot submit count in '${count.status}' status. Must be IN_PROGRESS.`);
  }

  const uncounted = count.items.filter((i) => i.countedQuantity === null);
  if (uncounted.length > 0) {
    throw new Error(`Cannot submit count. ${uncounted.length} items have not been counted yet.`);
  }

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, username: true } });

  const updated = await prisma.inventoryCount.update({
    where: { id: countId },
    data: {
      status: "SUBMITTED",
      submittedBy: userId,
      submittedAt: new Date(),
    },
    include: { warehouse: true, items: { include: { product: true, bin: true } } },
  });

  const totalVariance = count.items.reduce((sum, i) => sum + Math.abs(i.varianceQuantity || 0), 0);
  if (totalVariance > 0) {
    await prisma.auditLog.create({
      data: {
        userId,
        action: "inventory_variance_detected",
        entityType: "InventoryCount",
        entityId: countId,
        details: { countNumber: count.countNumber, totalVariance: roundQty(totalVariance) },
      },
    });
  }

  await prisma.auditLog.create({
    data: {
      userId,
      action: "inventory_count_submitted",
      entityType: "InventoryCount",
      entityId: countId,
      details: { countNumber: count.countNumber, status: "SUBMITTED" },
    },
  });

  return updated;
}

export async function approveInventoryCount(countId: string, userId: string) {
  const count = await prisma.inventoryCount.findUnique({
    where: { id: countId },
  });
  if (!count) throw new Error("Inventory count not found");
  if (count.status !== "SUBMITTED") {
    throw new Error(`Cannot approve count in '${count.status}' status. Must be SUBMITTED.`);
  }

  const updated = await prisma.inventoryCount.update({
    where: { id: countId },
    data: {
      status: "APPROVED",
      approvedBy: userId,
      approvedAt: new Date(),
    },
    include: { warehouse: true, items: { include: { product: true, bin: true } } },
  });

  await prisma.auditLog.create({
    data: {
      userId,
      action: "inventory_count_approved",
      entityType: "InventoryCount",
      entityId: countId,
      details: { countNumber: count.countNumber, status: "APPROVED" },
    },
  });

  return updated;
}

export async function postInventoryCount(countId: string, userId: string) {
  return inventoryTransaction(prisma, async (tx: any) => {
  const count = await tx.inventoryCount.findUnique({
    where: { id: countId },
    include: { items: true },
  });
  if (!count) throw new Error("Inventory count not found");
  await authorizeInventoryPosting(tx, userId, count.warehouseId, "INVENTORY_COUNT_POST", !["POSTED", "CLOSED"].includes(count.status));
  if (count.status === "POSTED" || count.status === "CLOSED") return count;
  if (count.status !== "APPROVED") {
    throw new Error(`Cannot post inventory count in '${count.status}' status. Must be APPROVED.`);
  }

  const varianceItems = count.items.filter((i: any) => i.varianceQuantity !== null && i.varianceQuantity !== 0);

  // Fence the count document before any stock, generated document or ledger write.
  await tx.inventoryCount.update({ where: { id: countId, status: "APPROVED" }, data: { updatedAt: new Date() } });
  for (const productId of [...new Set<string>(count.items.map((item: any) => item.productId))].sort()) {
    await tx.product.update({ where: { id: productId }, data: { updatedAt: new Date() } });
  }
  for (const item of count.items) {
    const allocation = item.binId
      ? await tx.stockLocationAllocation.findUnique({ where: { productId_binId: { productId: item.productId, binId: item.binId } } })
      : await tx.stockAllocation.findUnique({ where: { productId_warehouseId: { productId: item.productId, warehouseId: count.warehouseId } } });
    if (stockUnits(allocation?.quantity || 0) !== stockUnits(item.systemQuantity)) throw new Error("Stock changed since counting; recount before posting");
  }
  let adjustmentId: string | null = null;
  if (varianceItems.length > 0) {
    const adjInput = {
      warehouseId: count.warehouseId,
      reason: `Cycle Count Adjustment for ${count.countNumber}`,
      adjustmentType: "CORRECTION" as const,
      notes: `Generated from Inventory Count ${count.countNumber}`,
      items: varianceItems.map((item: any) => ({
        productId: item.productId,
        binId: item.binId,
        unitId: item.unitId,
        unitSymbol: item.unitSymbol,
        systemQuantity: item.systemQuantity,
        adjustmentQuantity: item.varianceQuantity!,
        resultingQuantity: item.countedQuantity!,
        reason: `Count Variance: Counted ${item.countedQuantity}, System ${item.systemQuantity}`,
        notes: item.notes,
      })),
    };

    const draftAdj = await createAdjustment(adjInput, userId, tx);
    // Inherit approval from the already-approved physical count.
    await tx.stockAdjustment.update({ where: { id: draftAdj.id, status: "DRAFT" }, data: {
      status: "APPROVED", approvedBy: count.approvedBy, approvedAt: count.approvedAt,
    } });
    const postedAdj = await postAdjustmentInTx(tx, draftAdj.id, userId);
    adjustmentId = postedAdj?.id || draftAdj.id;
  }

  const updated = await tx.inventoryCount.update({
    where: { id: countId },
    data: {
      status: "POSTED",
      postedBy: userId,
      postedAt: new Date(),
      adjustmentId,
    },
    include: { warehouse: true, items: { include: { product: true, bin: true } } },
  });

  await tx.auditLog.create({
    data: {
      userId,
      action: "inventory_count_posted",
      entityType: "InventoryCount",
      entityId: countId,
      details: { countNumber: count.countNumber, adjustmentId, status: "POSTED" },
    },
  });

  return updated;
  });
}

export async function closeInventoryCount(countId: string, userId: string) {
  const count = await prisma.inventoryCount.findUnique({
    where: { id: countId },
  });
  if (!count) throw new Error("Inventory count not found");

  const updated = await prisma.inventoryCount.update({
    where: { id: countId },
    data: {
      status: "CLOSED",
      closedBy: userId,
      closedAt: new Date(),
    },
    include: { warehouse: true, items: { include: { product: true, bin: true } } },
  });

  await prisma.auditLog.create({
    data: {
      userId,
      action: "inventory_count_closed",
      entityType: "InventoryCount",
      entityId: countId,
      details: { countNumber: count.countNumber, status: "CLOSED" },
    },
  });

  return updated;
}

export async function getCountById(countId: string, isManager: boolean = true) {
  const count = await prisma.inventoryCount.findUnique({
    where: { id: countId },
    include: {
      warehouse: true,
      items: {
        include: { product: true, bin: true },
      },
    },
  });

  if (!count) return null;

  if (count.countMode === "BLIND_COUNT" && !isManager && count.status !== "POSTED" && count.status !== "APPROVED") {
    const maskedItems = count.items.map((item) => ({
      ...item,
      systemQuantity: 0,
      varianceQuantity: null,
      variancePercentage: null,
    }));
    return {
      ...count,
      items: maskedItems,
    };
  }

  return count;
}

export async function getInventoryCountById(countId: string) {
  return await prisma.inventoryCount.findUnique({
    where: { id: countId },
    include: {
      warehouse: true,
      items: {
        include: { product: true, bin: true },
      },
    },
  });
}

export async function getInventoryCounts(query: {
  warehouseId?: string;
  status?: string;
  scopeType?: string;
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
  if (query.scopeType) where.scopeType = query.scopeType;
  if (query.search) {
    where.OR = [
      { countNumber: { contains: query.search, mode: "insensitive" } },
      { scopeName: { contains: query.search, mode: "insensitive" } },
      { createdByName: { contains: query.search, mode: "insensitive" } },
    ];
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

  return {
    data: counts,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}
