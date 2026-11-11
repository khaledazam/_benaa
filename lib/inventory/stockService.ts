import { prisma } from "@/prisma/client";
import { convertUnitQuantity } from "@/lib/units/unitService";
import { getStockAvailabilityInTx } from "./availability";
import { inventoryTransaction } from "./transaction";
import { randomUUID } from "node:crypto";
import { stockUnits, STOCK_SCALE, addStock } from "./quantity";
import { createOrUpdateBatchOnReceiptInTx } from "./batchService";

// Internal proof that a trusted service manages batch counters in this same tx.
// JSON callers cannot forge a symbol; generic mutations manage their own batch.
export const BATCH_MANAGED_IN_TX = Symbol("batch-managed-in-current-transaction");

export const StockMovementTypes = {
  OPENING_BALANCE: "OPENING_BALANCE",
  PURCHASE: "PURCHASE",
  TRANSFER_IN: "TRANSFER_IN",
  TRANSFER_OUT: "TRANSFER_OUT",
  RELOCATION: "RELOCATION",
  SALE: "SALE",
  CUSTOMER_RETURN: "CUSTOMER_RETURN",
  SUPPLIER_RETURN: "SUPPLIER_RETURN",
  ADJUSTMENT_IN: "ADJUSTMENT_IN",
  ADJUSTMENT_OUT: "ADJUSTMENT_OUT",
  DAMAGE: "DAMAGE",
  LOSS: "LOSS",
  PROJECT_ISSUE: "PROJECT_ISSUE",
  PROJECT_RETURN: "PROJECT_RETURN",
} as const;

export type StockMovementType = keyof typeof StockMovementTypes | string;

import { calculateStockStatus, type StockStatus } from "./stock-status";
export { StockStatuses, calculateStockStatus } from "./stock-status";
export type { StockStatus } from "./stock-status";

export interface StockMutationParams {
  batchId?: string | null;
  batchAccounting?: typeof BATCH_MANAGED_IN_TX;
  productId: string;
  warehouseId: string;
  quantity: number;
  unitId?: string | null;
  binId?: string | null;
  sourceBinId?: string | null;
  destinationBinId?: string | null;
  movementType: StockMovementType;
  referenceType?: string | null;
  referenceId?: string | null;
  reason?: string | null;
  performedBy: string;
  approvedBy?: string | null;
}

export interface StockMutationResult {
  success: boolean;
  movementId: string;
  movementNumber: string;
  productId: string;
  warehouseId: string;
  previousWarehouseStock: number;
  newWarehouseStock: number;
  previousProductStock: number;
  newProductStock: number;
  status: StockStatus;
}

function generateMovementNumber(): string {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const randomSuffix = randomUUID();
  return `MOV-${dateStr}-${randomSuffix}`;
}

/**
 * Transactional Stock Service helper: Executes stock mutation inside an existing Prisma transaction.
 */
export async function executeStockMutationInTx(
  tx: any,
  params: StockMutationParams
): Promise<StockMutationResult> {
  const {
    productId,
    warehouseId,
    quantity,
    unitId,
    binId,
    sourceBinId,
    destinationBinId,
    movementType,
    referenceType,
    referenceId,
    reason,
    performedBy,
    approvedBy,
  } = params;

  if (!productId || !warehouseId || !performedBy) {
    throw new Error("Missing required parameters: productId, warehouseId, performedBy");
  }
  if (isNaN(quantity) || !isFinite(quantity) || quantity <= 0) {
    throw new Error("Quantity must be a positive number");
  }

  const product = await tx.product.findUnique({ where: { id: productId } });
  if (!product) {
    throw new Error(`Product not found with id: ${productId}`);
  }
  if (product.deletedAt) throw new Error("Archived product cannot receive stock mutations");

  const warehouse = await tx.warehouse.findUnique({ where: { id: warehouseId } });
  if (!warehouse) {
    throw new Error(`Warehouse not found with id: ${warehouseId}`);
  }
  if (warehouse.status === false) throw new Error("Warehouse is inactive");

  const baseQuantity = await convertUnitQuantity({
    quantity,
    fromUnitId: unitId || product.unitId,
    toUnitId: product.unitId,
    productId,
  }, tx);

  const isIncoming = [
    StockMovementTypes.OPENING_BALANCE,
    StockMovementTypes.PURCHASE,
    StockMovementTypes.TRANSFER_IN,
    StockMovementTypes.CUSTOMER_RETURN,
    StockMovementTypes.ADJUSTMENT_IN,
    StockMovementTypes.PROJECT_RETURN,
    "FOUND",
  ].includes(movementType as any);
  if (movementType === "RELOCATION") throw new Error("Use the atomic bin relocation operation");
  if (!Object.values(StockMovementTypes).includes(movementType as any) && movementType !== "FOUND") throw new Error("Unknown stock movement type");
  if (!Number.isFinite(baseQuantity) || baseQuantity <= 0) throw new Error("Invalid base-unit quantity");
  stockUnits(baseQuantity);
  if (!isIncoming) {
    const available = await getStockAvailabilityInTx(tx, productId, warehouseId);
    if (!available.consistent || baseQuantity > available.availableStock + 1e-9) throw new Error("Insufficient uncommitted stock");
  }

  const delta = isIncoming ? baseQuantity : -baseQuantity;

  let allocation = await tx.stockAllocation.findUnique({
    where: { productId_warehouseId: { productId, warehouseId } },
  });

  const previousWarehouseStock = allocation ? Number(allocation.quantity) : 0;
  const newWarehouseStock = addStock(previousWarehouseStock, delta);

  if (newWarehouseStock < 0) {
    throw new Error(
      `Insufficient warehouse stock. Current: ${previousWarehouseStock}, Attempted Deduction: ${baseQuantity}`
    );
  }

  const previousProductStock = Number(product.quantity);
  const newProductStock = addStock(previousProductStock, delta);

  if (newProductStock < 0) {
    throw new Error(
      `Insufficient overall product stock. Current: ${previousProductStock}, Attempted Deduction: ${baseQuantity}`
    );
  }

  const movementNumber = generateMovementNumber();
  const calculatedStatus = calculateStockStatus(
    newProductStock,
    product.minimumStock || 0,
    product.maximumStock
  );

  const targetBinId = destinationBinId || (isIncoming ? binId : null) || null;
  const srcBinId = sourceBinId || (!isIncoming ? binId : null) || null;
  const effectiveBinId = srcBinId || targetBinId;
  if ((isIncoming && (sourceBinId || (!destinationBinId && sourceBinId))) || (!isIncoming && destinationBinId)) throw new Error("Bin direction does not match stock movement");
  if (srcBinId && targetBinId) throw new Error("A stock mutation cannot specify both source and destination bins");

  const tracked = ["BATCH", "LOT", "HEAT"].includes(product.trackingMode);
  if (tracked && !params.batchId) throw new Error("Tracked stock mutation requires a batch");
  let batch: any = null;
  if (params.batchId) {
    batch = await tx.inventoryBatch.findUnique({ where: { id: params.batchId } });
    if (!batch || batch.productId !== productId || batch.warehouseId !== warehouseId ||
        (!isIncoming && batch.status !== "ACTIVE") || (isIncoming && !["ACTIVE", "EXHAUSTED"].includes(batch.status))) throw new Error("Invalid stock batch scope or status");
    if (params.batchAccounting !== BATCH_MANAGED_IN_TX) {
      if (!isIncoming && batch.quantity - batch.reservedQuantity < baseQuantity) throw new Error("Insufficient uncommitted batch stock");
      const batchQuantity = addStock(batch.quantity, isIncoming ? baseQuantity : -baseQuantity);
      await tx.inventoryBatch.update({ where: { id: batch.id }, data: { quantity: batchQuantity, status: batchQuantity === 0 ? "EXHAUSTED" : "ACTIVE" } });
    }
  }

  if (targetBinId) {
    const bin = await tx.warehouseBin.findUnique({ where: { id: targetBinId } });
    if (!bin) throw new Error(`Destination bin not found: ${targetBinId}`);
    if (bin.active === false) throw new Error("Destination bin is inactive");
    if (bin.warehouseId !== warehouseId) {
      throw new Error(`Destination bin ${bin.code} belongs to warehouse ${bin.warehouseId}, not ${warehouseId}`);
    }
  }

  if (srcBinId) {
    const bin = await tx.warehouseBin.findUnique({ where: { id: srcBinId } });
    if (!bin) throw new Error(`Source bin not found: ${srcBinId}`);
    if (bin.active === false) throw new Error("Source bin is inactive");
    if (bin.warehouseId !== warehouseId) {
      throw new Error(`Source bin ${bin.code} belongs to warehouse ${bin.warehouseId}, not ${warehouseId}`);
    }
  }

  // A product already tracked in bins cannot bypass location accounting.
  if (!effectiveBinId && await tx.stockLocationAllocation.count({ where: { productId, warehouseId } }) > 0) {
    throw new Error("A bin is required for location-tracked stock");
  }

  const createdMovement = await tx.stockMovement.create({
    data: {
      movementNumber,
      productId,
      warehouseId,
      sourceBinId: srcBinId,
      destinationBinId: targetBinId,
      quantity,
      unitId: unitId || product.unitId || null,
      quantityInBaseUnit: baseQuantity,
      movementType,
      previousStock: previousWarehouseStock,
      newStock: newWarehouseStock,
      referenceType: referenceType || null,
      referenceId: referenceId || null,
      reason: reason || null,
      performedBy,
      approvedBy: approvedBy || null,
      batchId: batch?.id || null,
      batchNumber: batch?.batchNumber || null,
    },
  });

  await tx.stockAllocation.upsert({
    where: { productId_warehouseId: { productId, warehouseId } },
    create: {
      productId,
      warehouseId,
      quantity: newWarehouseStock,
      reservedQuantity: 0,
      userId: performedBy,
      unitId: product.unitId || null,
    },
    update: {
      quantity: newWarehouseStock,
      updatedAt: new Date(),
    },
  });

  await tx.product.update({
    where: { id: productId },
    data: {
      quantity: newProductStock,
      status: calculatedStatus,
      updatedAt: new Date(),
    },
  });

  if (effectiveBinId) {
    const locAlloc = await tx.stockLocationAllocation.findUnique({
      where: { productId_binId: { productId, binId: effectiveBinId } },
    });
    const prevBinStock = locAlloc ? Number(locAlloc.quantity) : 0;
    const newBinStock = addStock(prevBinStock, isIncoming ? baseQuantity : -baseQuantity);

    if (!isIncoming && prevBinStock < baseQuantity) {
      throw new Error(
        `Insufficient bin stock in bin. Available: ${prevBinStock}, Attempted Deduction: ${baseQuantity}`
      );
    }

    await tx.stockLocationAllocation.upsert({
      where: { productId_binId: { productId, binId: effectiveBinId } },
      create: {
        productId,
        warehouseId,
        binId: effectiveBinId,
        quantity: newBinStock,
        unitId: product.unitId || null,
        quantityInBaseUnit: newBinStock,
      },
      update: {
        quantity: newBinStock,
        quantityInBaseUnit: newBinStock,
        updatedAt: new Date(),
      },
    });
  }

  return {
    success: true,
    movementId: createdMovement.id,
    movementNumber: createdMovement.movementNumber,
    productId,
    warehouseId,
    previousWarehouseStock,
    newWarehouseStock,
    previousProductStock,
    newProductStock,
    status: calculatedStatus,
  };
}

/**
 * Central Stock Service: Executes all inventory stock mutations with full audit ledger tracking.
 */
export async function executeStockMutation(
  params: StockMutationParams
): Promise<StockMutationResult> {
  return await inventoryTransaction(prisma, async (tx) => {
    return await executeStockMutationInTx(tx, params);
  });
}

/**
 * Execute Stock Transfer between two warehouses with paired StockMovement entries
 */
export async function executeStockTransfer(params: {
  batchId?: string | null;
  productId: string;
  fromWarehouseId: string;
  toWarehouseId: string;
  fromBinId?: string | null;
  toBinId?: string | null;
  quantity: number;
  unitId?: string | null;
  performedBy: string;
  notes?: string | null;
}) {
  const { productId, fromWarehouseId, toWarehouseId, fromBinId, toBinId, quantity, unitId, performedBy, notes } = params;

  if (fromWarehouseId === toWarehouseId) {
    throw new Error("Source and destination warehouses must be different for stock transfer");
  }

  return await inventoryTransaction(prisma, async (tx) => {
    const sourceBatch = params.batchId ? await tx.inventoryBatch.findUnique({ where: { id: params.batchId } }) : null;
    // 1. Transfer Out from source warehouse
    const outResult = await executeStockMutationInTx(tx, {
      productId,
      warehouseId: fromWarehouseId,
      sourceBinId: fromBinId,
      quantity,
      unitId,
      movementType: StockMovementTypes.TRANSFER_OUT,
      reason: notes || `Transfer to warehouse ${toWarehouseId}`,
      performedBy,
      batchId: params.batchId,
    });

    // 2. Transfer In to destination warehouse
    const destinationBatch = sourceBatch ? await createOrUpdateBatchOnReceiptInTx(tx, { productId, warehouseId: toWarehouseId,
      batchNumber: sourceBatch.batchNumber, lotNumber: sourceBatch.lotNumber, heatNumber: sourceBatch.heatNumber,
      manufactureDate: sourceBatch.manufactureDate, expiryDate: sourceBatch.expiryDate, supplierId: sourceBatch.supplierId,
      quantity: outResult.previousWarehouseStock - outResult.newWarehouseStock }) : null;
    const inResult = await executeStockMutationInTx(tx, {
      productId,
      warehouseId: toWarehouseId,
      destinationBinId: toBinId,
      quantity,
      unitId,
      movementType: StockMovementTypes.TRANSFER_IN,
      referenceType: "StockMovement",
      referenceId: outResult.movementId,
      reason: notes || `Transfer from warehouse ${fromWarehouseId}`,
      performedBy,
      batchId: destinationBatch?.id,
      batchAccounting: destinationBatch ? BATCH_MANAGED_IN_TX : undefined,
    });

    // 3. Record StockTransfer entry
    const baseQuantity = (stockUnits(outResult.previousWarehouseStock) - stockUnits(outResult.newWarehouseStock)) / STOCK_SCALE;
    const product = await tx.product.findUnique({ where: { id: productId } });
    const transferRecord = await tx.stockTransfer.create({
      data: {
        transferNumber: `TRF-${outResult.movementNumber.replace("MOV-", "")}`,
        productId,
        fromWarehouseId,
        toWarehouseId,
        fromBinId: fromBinId || null,
        toBinId: toBinId || null,
        batchId: sourceBatch?.id || null,
        quantity: baseQuantity,
        unitId: product.unitId || null,
        receivedQuantity: baseQuantity,
        inTransitQuantity: 0,
        status: "COMPLETED",
        notes: notes || null,
        userId: performedBy,
        completedAt: new Date(),
      },
    });
    await tx.stockMovement.updateMany({ where: { id: { in: [outResult.movementId, inResult.movementId] } }, data: { referenceType: "StockTransfer", referenceId: transferRecord.id } });

    return {
      transferRecord,
      outResult,
      inResult,
    };
  });
}

/**
 * Execute Bin Relocation inside the SAME warehouse.
 * Total warehouse stock remains UNCHANGED.
 */
export async function executeStockRelocation(params: {
  productId: string;
  warehouseId: string;
  fromBinId: string;
  toBinId: string;
  quantity: number;
  unitId?: string | null;
  performedBy: string;
  reason?: string | null;
}) {
  const { productId, warehouseId, fromBinId, toBinId, quantity, unitId, performedBy, reason } = params;

  if (!productId || !warehouseId || !fromBinId || !toBinId || !performedBy) {
    throw new Error("Missing required parameters for bin relocation");
  }

  if (fromBinId === toBinId) {
    throw new Error("Source and destination bins must be different");
  }

  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new Error("Relocation quantity must be greater than 0");
  }

  return inventoryTransaction(prisma, async (tx) => {
  // Verify bins belong to warehouseId
  const [fromBin, toBin, product] = await Promise.all([
    tx.warehouseBin.findUnique({ where: { id: fromBinId } }),
    tx.warehouseBin.findUnique({ where: { id: toBinId } }),
    tx.product.findUnique({ where: { id: productId } }),
  ]);

  if (fromBin?.active === false || toBin?.active === false) throw new Error("Inactive relocation bin");
  if (!fromBin) throw new Error(`Source bin not found: ${fromBinId}`);
  if (!toBin) throw new Error(`Destination bin not found: ${toBinId}`);
  if (!product) throw new Error(`Product not found: ${productId}`);

  if (fromBin.warehouseId !== warehouseId) {
    throw new Error(`Source bin ${fromBin.code} does not belong to warehouse ${warehouseId}`);
  }
  if (toBin.warehouseId !== warehouseId) {
    throw new Error(`Destination bin ${toBin.code} does not belong to warehouse ${warehouseId}`);
  }

  const baseQuantity = await convertUnitQuantity({
    quantity,
    fromUnitId: unitId || product.unitId,
    toUnitId: product.unitId,
    productId,
  }, tx);

  // Verify source bin has sufficient stock
  const sourceAlloc = await tx.stockLocationAllocation.findUnique({
    where: { productId_binId: { productId, binId: fromBinId } },
  });

  const sourceCurrentStock = sourceAlloc ? sourceAlloc.quantity : 0;

  if (sourceCurrentStock < baseQuantity) {
    throw new Error(
      `Insufficient stock in source bin ${fromBin.code}. Current: ${sourceCurrentStock}, Attempted relocation: ${baseQuantity}`
    );
  }

  const allocation = await tx.stockAllocation.findUnique({
    where: { productId_warehouseId: { productId, warehouseId } },
  });
  const warehouseTotalStock = allocation ? allocation.quantity : 0;

  const movementNumber = generateMovementNumber();

  stockUnits(baseQuantity);
    // 1. Decrement source bin allocation
    const newSourceStock = (stockUnits(sourceCurrentStock) - stockUnits(baseQuantity)) / STOCK_SCALE;
    await tx.stockLocationAllocation.update({
      where: { productId_binId: { productId, binId: fromBinId } },
      data: {
        quantity: newSourceStock,
        quantityInBaseUnit: newSourceStock,
        updatedAt: new Date(),
      },
    });

    // 2. Increment/upsert destination bin allocation
    const destAlloc = await tx.stockLocationAllocation.findUnique({
      where: { productId_binId: { productId, binId: toBinId } },
    });
    const destCurrentStock = destAlloc ? destAlloc.quantity : 0;
    const newDestStock = (stockUnits(destCurrentStock) + stockUnits(baseQuantity)) / STOCK_SCALE;

    const updatedDestAlloc = await tx.stockLocationAllocation.upsert({
      where: { productId_binId: { productId, binId: toBinId } },
      create: {
        productId,
        warehouseId,
        binId: toBinId,
        quantity: newDestStock,
        unitId: product.unitId || null,
        quantityInBaseUnit: newDestStock,
      },
      update: {
        quantity: newDestStock,
        quantityInBaseUnit: newDestStock,
        updatedAt: new Date(),
      },
    });

    // 3. Create RELOCATION StockMovement
    const movement = await tx.stockMovement.create({
      data: {
        movementNumber,
        productId,
        warehouseId,
        sourceBinId: fromBinId,
        destinationBinId: toBinId,
        quantity,
        unitId: unitId || product.unitId || null,
        quantityInBaseUnit: baseQuantity,
        movementType: StockMovementTypes.RELOCATION,
        previousStock: warehouseTotalStock,
        newStock: warehouseTotalStock, // Unchanged at warehouse level!
        reason: reason || `Relocated from bin ${fromBin.code} to bin ${toBin.code}`,
        performedBy,
      },
    });

    // 4. Create Audit Log
    await tx.auditLog.create({
      data: {
        userId: performedBy,
        action: "stock_relocated",
        entityType: "StockLocationAllocation",
        entityId: updatedDestAlloc.id,
        details: {
          productId,
          warehouseId,
          fromBinId,
          fromBinCode: fromBin.code,
          toBinId,
          toBinCode: toBin.code,
          quantity: baseQuantity,
        },
      },
    });

    return {
      success: true,
      movementId: movement.id,
      movementNumber: movement.movementNumber,
      productId,
      warehouseId,
      fromBinId,
      toBinId,
      relocatedQuantity: baseQuantity,
      warehouseTotalStock,
    };
  });
}
