import { prisma } from "@/prisma/client";
import { convertUnitQuantity } from "@/lib/units/unitService";

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
} as const;

export type StockMovementType = keyof typeof StockMovementTypes | string;

export const StockStatuses = {
  IN_STOCK: "IN_STOCK",
  LOW_STOCK: "LOW_STOCK",
  OUT_OF_STOCK: "OUT_OF_STOCK",
  OVERSTOCK: "OVERSTOCK",
} as const;

export type StockStatus = keyof typeof StockStatuses;

/**
 * Calculates stock status based on current quantity and product min/max thresholds.
 */
export function calculateStockStatus(
  currentQuantity: number,
  minimumStock: number = 0,
  maximumStock?: number | null
): StockStatus {
  if (currentQuantity <= 0) {
    return StockStatuses.OUT_OF_STOCK;
  }
  if (maximumStock != null && maximumStock > 0 && currentQuantity > maximumStock) {
    return StockStatuses.OVERSTOCK;
  }
  if (minimumStock > 0 && currentQuantity <= minimumStock) {
    return StockStatuses.LOW_STOCK;
  }
  return StockStatuses.IN_STOCK;
}

export interface StockMutationParams {
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
  const randomSuffix = Math.floor(100000 + Math.random() * 900000);
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

  const warehouse = await tx.warehouse.findUnique({ where: { id: warehouseId } });
  if (!warehouse) {
    throw new Error(`Warehouse not found with id: ${warehouseId}`);
  }

  const baseQuantity = await convertUnitQuantity({
    quantity,
    fromUnitId: unitId,
    toUnitId: product.unitId,
    productId,
  });

  const isIncoming = [
    StockMovementTypes.OPENING_BALANCE,
    StockMovementTypes.PURCHASE,
    StockMovementTypes.TRANSFER_IN,
    StockMovementTypes.CUSTOMER_RETURN,
    StockMovementTypes.ADJUSTMENT_IN,
    "FOUND",
  ].includes(movementType as any);

  const delta = isIncoming ? baseQuantity : -baseQuantity;

  let allocation = await tx.stockAllocation.findUnique({
    where: { productId_warehouseId: { productId, warehouseId } },
  });

  const previousWarehouseStock = allocation ? Number(allocation.quantity) : 0;
  const newWarehouseStock = previousWarehouseStock + delta;

  if (newWarehouseStock < 0) {
    throw new Error(
      `Insufficient warehouse stock. Current: ${previousWarehouseStock}, Attempted Deduction: ${baseQuantity}`
    );
  }

  const previousProductStock = Number(product.quantity);
  const newProductStock = previousProductStock + delta;

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

  if (targetBinId) {
    const bin = await tx.warehouseBin.findUnique({ where: { id: targetBinId } });
    if (!bin) throw new Error(`Destination bin not found: ${targetBinId}`);
    if (bin.warehouseId !== warehouseId) {
      throw new Error(`Destination bin ${bin.code} belongs to warehouse ${bin.warehouseId}, not ${warehouseId}`);
    }
  }

  if (srcBinId) {
    const bin = await tx.warehouseBin.findUnique({ where: { id: srcBinId } });
    if (!bin) throw new Error(`Source bin not found: ${srcBinId}`);
    if (bin.warehouseId !== warehouseId) {
      throw new Error(`Source bin ${bin.code} belongs to warehouse ${bin.warehouseId}, not ${warehouseId}`);
    }
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
      unitId: unitId || product.unitId || null,
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
    const newBinStock = isIncoming ? prevBinStock + baseQuantity : Math.max(0, prevBinStock - baseQuantity);

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
        unitId: unitId || product.unitId || null,
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
  return await prisma.$transaction(async (tx) => {
    return await executeStockMutationInTx(tx, params);
  });
}

/**
 * Execute Stock Transfer between two warehouses with paired StockMovement entries
 */
export async function executeStockTransfer(params: {
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

  return await prisma.$transaction(async (tx) => {
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
    });

    // 2. Transfer In to destination warehouse
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
    });

    // 3. Record StockTransfer entry
    const transferRecord = await tx.stockTransfer.create({
      data: {
        transferNumber: `TRF-${outResult.movementNumber.replace("MOV-", "")}`,
        productId,
        fromWarehouseId,
        toWarehouseId,
        fromBinId: fromBinId || null,
        toBinId: toBinId || null,
        quantity,
        unitId: unitId || null,
        status: "completed",
        notes: notes || null,
        userId: performedBy,
        completedAt: new Date(),
      },
    });

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

  if (quantity <= 0) {
    throw new Error("Relocation quantity must be greater than 0");
  }

  // Verify bins belong to warehouseId
  const [fromBin, toBin, product] = await Promise.all([
    prisma.warehouseBin.findUnique({ where: { id: fromBinId } }),
    prisma.warehouseBin.findUnique({ where: { id: toBinId } }),
    prisma.product.findUnique({ where: { id: productId } }),
  ]);

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
    fromUnitId: unitId,
    toUnitId: product.unitId,
    productId,
  });

  // Verify source bin has sufficient stock
  const sourceAlloc = await prisma.stockLocationAllocation.findUnique({
    where: { productId_binId: { productId, binId: fromBinId } },
  });

  const sourceCurrentStock = sourceAlloc ? sourceAlloc.quantity : 0;

  if (sourceCurrentStock < baseQuantity) {
    throw new Error(
      `Insufficient stock in source bin ${fromBin.code}. Current: ${sourceCurrentStock}, Attempted relocation: ${baseQuantity}`
    );
  }

  const allocation = await prisma.stockAllocation.findUnique({
    where: { productId_warehouseId: { productId, warehouseId } },
  });
  const warehouseTotalStock = allocation ? allocation.quantity : 0;

  const movementNumber = generateMovementNumber();

  return prisma.$transaction(async (tx) => {
    // 1. Decrement source bin allocation
    const newSourceStock = sourceCurrentStock - baseQuantity;
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
    const newDestStock = destCurrentStock + baseQuantity;

    const updatedDestAlloc = await tx.stockLocationAllocation.upsert({
      where: { productId_binId: { productId, binId: toBinId } },
      create: {
        productId,
        warehouseId,
        binId: toBinId,
        quantity: newDestStock,
        unitId: unitId || product.unitId || null,
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
