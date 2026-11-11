import { prisma } from "@/prisma/client";
import { addStock, stockUnits } from "./quantity";

export interface CreateBatchInput {
  productId: string;
  warehouseId: string;
  supplierId?: string | null;
  goodsReceiptId?: string | null;
  batchNumber?: string | null;
  lotNumber?: string | null;
  heatNumber?: string | null;
  manufactureDate?: Date | string | null;
  expiryDate?: Date | string | null;
  quantity: number;
  notes?: string | null;
}

export interface BatchSuggestion {
  batchId: string;
  batchNumber: string;
  lotNumber: string | null;
  heatNumber: string | null;
  physicalQuantity: number;
  reservedQuantity: number;
  availableQuantity: number;
  manufactureDate: Date | null;
  expiryDate: Date | null;
  suggestedQuantity: number;
  suggestionReason: string;
}

export async function generateBatchNumber(): Promise<string> {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const prefix = `BAT-${dateStr}-`;

  const last = await prisma.inventoryBatch.findFirst({
    where: { batchNumber: { startsWith: prefix } },
    orderBy: { batchNumber: "desc" },
    select: { batchNumber: true },
  });

  let seq = 1;
  if (last?.batchNumber) {
    const parts = last.batchNumber.split("-");
    const lastPart = parts[parts.length - 1];
    const lastSeq = lastPart ? parseInt(lastPart, 10) : NaN;
    if (!isNaN(lastSeq)) seq = lastSeq + 1;
  }

  return `${prefix}${seq.toString().padStart(4, "0")}`;
}

/**
 * Validates product tracking mode rules server-side before stock mutations.
 */
export async function validateProductTrackingModeInTx(
  tx: any,
  productId: string,
  batchData?: {
    batchId?: string | null;
    batchNumber?: string | null;
    lotNumber?: string | null;
    heatNumber?: string | null;
  }
): Promise<any> {
  const productGetter = tx?.product || prisma.product;
  if (!productGetter?.findUnique) return null;

  const product = await productGetter.findUnique({ where: { id: productId } });
  if (!product) return null;

  const mode = product.trackingMode || "NONE";
  if (mode === "NONE") return product;

  if (mode === "BATCH" && !batchData?.batchId && !batchData?.batchNumber) {
    throw new Error(`Product '${product.name}' tracking mode is BATCH — batch number or batch ID is required.`);
  }

  if (mode === "LOT" && !batchData?.batchId && !batchData?.lotNumber && !batchData?.batchNumber) {
    throw new Error(`Product '${product.name}' tracking mode is LOT — lot number or batch ID is required.`);
  }

  if (mode === "HEAT" && !batchData?.batchId && !batchData?.heatNumber && !batchData?.batchNumber) {
    throw new Error(`Product '${product.name}' tracking mode is HEAT — heat certification number or batch ID is required.`);
  }

  return product;
}

/**
 * Reserves available stock on a specific batch inside a transaction.
 */
export async function reserveBatchQuantityInTx(
  tx: any,
  batchId: string,
  reserveQuantity: number
): Promise<any> {
  if (!Number.isFinite(reserveQuantity) || reserveQuantity <= 0) throw new Error("Batch reservation must be positive");
  stockUnits(reserveQuantity);

  const batch = await tx.inventoryBatch.findUnique({ where: { id: batchId } });
  if (!batch) throw new Error(`Inventory batch '${batchId}' not found for reservation.`);

  const available = Math.max(0, batch.quantity - batch.reservedQuantity);
  if (available < reserveQuantity) {
    throw new Error(
      `Insufficient available stock in batch '${batch.batchNumber}'. Available: ${available}, Attempted Reserve: ${reserveQuantity}`
    );
  }

  const updated = await tx.inventoryBatch.update({
    where: { id: batchId },
    data: {
      reservedQuantity: addStock(batch.reservedQuantity, reserveQuantity),
      updatedAt: new Date(),
    },
  });

  return updated;
}

/**
 * Releases reserved stock on a specific batch inside a transaction.
 */
export async function releaseBatchReservationInTx(
  tx: any,
  batchId: string,
  releaseQuantity: number
): Promise<any> {
  if (!Number.isFinite(releaseQuantity) || releaseQuantity <= 0) throw new Error("Batch release must be positive");

  const batch = await tx.inventoryBatch.findUnique({ where: { id: batchId } });
  if (!batch) throw new Error("Batch reservation not found");

  if (releaseQuantity > batch.reservedQuantity) throw new Error("Batch release exceeds reservation");
  const newReserved = addStock(batch.reservedQuantity, -releaseQuantity);

  const updated = await tx.inventoryBatch.update({
    where: { id: batchId },
    data: {
      reservedQuantity: newReserved,
      updatedAt: new Date(),
    },
  });

  return updated;
}

/**
 * Creates or updates an InventoryBatch entry inside a Prisma transaction (e.g. during GRN POST).
 */
export async function createOrUpdateBatchOnReceiptInTx(
  tx: any,
  input: CreateBatchInput
): Promise<any> {
  const { productId, warehouseId, quantity } = input;
  if (!productId || !warehouseId || !Number.isFinite(quantity) || quantity <= 0) {
    throw new Error("Invalid batch receipt input: productId, warehouseId, and positive quantity required.");
  }
  stockUnits(quantity);

  const product = await tx.product.findUnique({ where: { id: productId } });
  if (!product) throw new Error("Product not found");

  const batchNumber = input.batchNumber?.trim() || (await generateBatchNumber());

  const existing = await tx.inventoryBatch.findUnique({
    where: {
      batchNumber_productId_warehouseId: {
        batchNumber,
        productId,
        warehouseId,
      },
    },
  });

  const mfgDate = input.manufactureDate ? new Date(input.manufactureDate) : null;
  const expDate = input.expiryDate ? new Date(input.expiryDate) : product.expirationDate ? new Date(product.expirationDate) : null;

  if (existing) {
    if (!["ACTIVE", "EXHAUSTED"].includes(existing.status)) throw new Error("Receipt cannot release a quarantined or inactive batch");
    const updated = await tx.inventoryBatch.update({
      where: { id: existing.id },
      data: {
        quantity: addStock(existing.quantity, quantity),
        lotNumber: input.lotNumber || existing.lotNumber,
        heatNumber: input.heatNumber || existing.heatNumber,
        manufactureDate: mfgDate || existing.manufactureDate,
        expiryDate: expDate || existing.expiryDate,
        status: "ACTIVE",
        updatedAt: new Date(),
      },
    });
    return updated;
  }

  const created = await tx.inventoryBatch.create({
    data: {
      batchNumber,
      lotNumber: input.lotNumber || null,
      heatNumber: input.heatNumber || null,
      productId,
      warehouseId,
      supplierId: input.supplierId || null,
      goodsReceiptId: input.goodsReceiptId || null,
      manufactureDate: mfgDate,
      expiryDate: expDate,
      quantity,
      reservedQuantity: 0,
      status: "ACTIVE",
      notes: input.notes || null,
    },
  });

  return created;
}

/**
 * Deducts batch stock inside a Prisma transaction (e.g. during Dispatch POST).
 */
export async function deductBatchQuantityInTx(
  tx: any,
  batchId: string,
  deductQuantity: number
): Promise<any> {
  if (!Number.isFinite(deductQuantity) || deductQuantity <= 0) throw new Error("Batch deduction must be positive");

  const batch = await tx.inventoryBatch.findUnique({ where: { id: batchId } });
  if (!batch) throw new Error(`Inventory batch '${batchId}' not found`);

  const available = Math.max(0, batch.quantity - batch.reservedQuantity);
  if (available < deductQuantity) {
    throw new Error(
      `Insufficient available stock in batch '${batch.batchNumber}'. Available: ${available}, Attempted Deduction: ${deductQuantity}`
    );
  }

  const newQty = addStock(batch.quantity, -deductQuantity);
  const newStatus = newQty <= 0 ? "EXHAUSTED" : batch.status;

  const updated = await tx.inventoryBatch.update({
    where: { id: batchId },
    data: {
      quantity: newQty,
      status: newStatus,
      updatedAt: new Date(),
    },
  });

  return updated;
}

/**
 * Computes FEFO / FIFO suggested batches for picking or dispatch.
 */
export async function getBatchSuggestions(params: {
  productId: string;
  warehouseId: string;
  requiredQuantity: number;
}): Promise<BatchSuggestion[]> {
  const { productId, warehouseId, requiredQuantity } = params;

  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product || product.trackingMode === "NONE") return [];

  const batches = await prisma.inventoryBatch.findMany({
    where: {
      productId,
      warehouseId,
      status: "ACTIVE",
      quantity: { gt: 0 },
    },
  });

  if (batches.length === 0) return [];

  const hasExpiry = batches.some((b) => b.expiryDate !== null) || Boolean(product.expirationDate);

  // Sort FEFO (Expiry Date ASC) if expiry dates exist, else FIFO (Creation Date ASC)
  batches.sort((a, b) => {
    if (hasExpiry) {
      const expA = a.expiryDate ? new Date(a.expiryDate).getTime() : Number.MAX_SAFE_INTEGER;
      const expB = b.expiryDate ? new Date(b.expiryDate).getTime() : Number.MAX_SAFE_INTEGER;
      if (expA !== expB) return expA - expB;
    }
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });

  let remaining = requiredQuantity;
  const suggestions: BatchSuggestion[] = [];

  for (const batch of batches) {
    const avail = Math.max(0, batch.quantity - batch.reservedQuantity);
    if (avail <= 0) continue;

    const suggestedQuantity = Math.min(remaining, avail);
    remaining -= suggestedQuantity;

    const reason = hasExpiry
      ? `FEFO: Expiry Date ${batch.expiryDate ? new Date(batch.expiryDate).toLocaleDateString() : "N/A"}`
      : `FIFO: Received ${new Date(batch.createdAt).toLocaleDateString()}`;

    suggestions.push({
      batchId: batch.id,
      batchNumber: batch.batchNumber,
      lotNumber: batch.lotNumber,
      heatNumber: batch.heatNumber,
      physicalQuantity: batch.quantity,
      reservedQuantity: batch.reservedQuantity,
      availableQuantity: avail,
      manufactureDate: batch.manufactureDate,
      expiryDate: batch.expiryDate,
      suggestedQuantity,
      suggestionReason: reason,
    });

    if (remaining <= 0) break;
  }

  return suggestions;
}

/**
 * Paginated batch directory query handler.
 */
export async function getInventoryBatches(params: {
  warehouseId?: string;
  productId?: string;
  status?: string;
  search?: string;
  page?: number;
  limit?: number;
}) {
  const page = Math.max(1, params.page || 1);
  const limit = Math.min(100, Math.max(1, params.limit || 20));
  const skip = (page - 1) * limit;

  const where: any = {};
  if (params.warehouseId) where.warehouseId = params.warehouseId;
  if (params.productId) where.productId = params.productId;
  if (params.status) where.status = params.status;
  if (params.search) {
    where.OR = [
      { batchNumber: { contains: params.search, mode: "insensitive" } },
      { lotNumber: { contains: params.search, mode: "insensitive" } },
      { heatNumber: { contains: params.search, mode: "insensitive" } },
    ];
  }

  const [total, data] = await Promise.all([
    prisma.inventoryBatch.count({ where }),
    prisma.inventoryBatch.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: "desc" },
      include: {
        product: { select: { name: true, sku: true, trackingMode: true } },
        warehouse: { select: { name: true, code: true } },
        supplier: { select: { name: true } },
      },
    }),
  ]);

  return {
    data,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
  };
}
