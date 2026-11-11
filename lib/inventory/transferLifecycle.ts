import { createHash, randomUUID } from "node:crypto";
import { inventoryTransaction } from "./transaction";
import { executeStockMutationInTx, BATCH_MANAGED_IN_TX } from "./stockService";
import { canAccessInventoryWarehouse, isInventoryAdmin } from "@/lib/auth/inventory-route-access";
import { getStockAvailabilityInTx } from "./availability";
import { hasPermission } from "@/lib/auth/permissions";
import { createOrUpdateBatchOnReceiptInTx } from "./batchService";
import { stockUnits, STOCK_SCALE, addStock } from "./quantity";

export class TransferError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
const positive = (n: unknown): n is number => {
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) return false;
  try { stockUnits(n); return true; } catch { return false; }
};
const id = (n: unknown): n is string => typeof n === "string" && /^[a-f0-9]{24}$/i.test(n);

export async function applyTransferOperation(db: any, actor: any, body: any, headerKey?: string | null): Promise<any> {
  const { action, transferId, productId, fromWarehouseId, toWarehouseId } = body;
  if (!["REQUEST", "APPROVE", "DISPATCH", "RECEIVE", "CANCEL"].includes(action)) throw new TransferError("Invalid transfer action");
  // Natural single-step operations have a stable key. Partial receipts and new
  // requests require a client-generated key retained across network retries.
  const key = headerKey || body.idempotencyKey || (!["REQUEST", "RECEIVE"].includes(action) ? `${transferId}:${action}` : null);
  if (typeof key !== "string" || !/^[a-zA-Z0-9:_-]{1,128}$/.test(key)) throw new TransferError("A stable Idempotency-Key is required");
  const data = { action, transferId: transferId || null, productId: productId || null,
    fromWarehouseId: fromWarehouseId || null, toWarehouseId: toWarehouseId || null,
    quantity: body.quantity ?? null, receivedQuantity: body.receivedQuantity ?? null,
    unitId: body.unitId || null, fromBinId: body.fromBinId || null, toBinId: body.toBinId || null, batchId: body.batchId || null,
    notes: body.notes || null, reason: body.reason || null };
  const requestHash = createHash("sha256").update(JSON.stringify(data)).digest("hex");
  const operationKey = `${actor.id}:${action}:${key}`;
  return inventoryTransaction(db, async tx => {
    // Current persisted assignment and subscription must still authorize a replay.
    const current = await tx.user.findUnique({ where: { id: actor.id } });
    const now = new Date();
    if (!current || !current.status || (current.subscriptionEndDate && current.subscriptionEndDate < now) ||
        (current.subscriptionStartDate && current.subscriptionStartDate > now)) throw new TransferError("Account access revoked", 403);
    const authority = { ...current };
    if (!hasPermission(current, "STOCK_TRANSFER")) throw new TransferError("Transfer permission revoked", 403);
    let transfer: any;
    if (action === "REQUEST") {
      if (![productId, fromWarehouseId, toWarehouseId].every(id) || fromWarehouseId === toWarehouseId || !positive(body.quantity)) throw new TransferError("Invalid transfer quantity or warehouses");
      if (!canAccessInventoryWarehouse(authority, fromWarehouseId) && !canAccessInventoryWarehouse(authority, toWarehouseId)) throw new TransferError("Forbidden warehouse", 403);
    } else {
      if (!id(transferId)) throw new TransferError("Invalid transfer ID");
      transfer = await tx.stockTransfer.findUnique({ where: { id: transferId } });
      if (!transfer) throw new TransferError("Transfer not found", 404);
      const warehouse = action === "RECEIVE" ? transfer.toWarehouseId : transfer.fromWarehouseId;
      if (!canAccessInventoryWarehouse(authority, warehouse) && !(action === "CANCEL" && canAccessInventoryWarehouse(authority, transfer.toWarehouseId))) throw new TransferError("Forbidden warehouse", 403);
      if (action === "APPROVE" && !isInventoryAdmin(authority) && authority.role !== "WAREHOUSE_MANAGER") throw new TransferError("Transfer approval requires a warehouse manager", 403);
    }
    const replay = await tx.inventoryOperation.findUnique({ where: { operationKey } });
    if (replay) {
      if (replay.requestHash !== requestHash) throw new TransferError("Idempotency key was already used for a different request", 409);
      return { ...(replay.response as object), replayed: true };
    }
    // Serialize a fresh mutation with concurrent account/assignment changes.
    // Replays remain read-only and have already checked current persisted scope.
    await tx.user.update({ where: { id: current.id }, data: { updatedAt: now } });
    const audit = (stage: string) => [...(Array.isArray(transfer?.auditHistory) ? transfer.auditHistory : []), {
      stage, actorId: current.id, actorName: current.name, actorRole: current.role, timestamp: now.toISOString(), notes: body.notes || body.reason || null,
    }];
    if (action === "REQUEST") {
      const [product, source, destination] = await Promise.all([
        tx.product.findUnique({ where: { id: productId } }), tx.warehouse.findUnique({ where: { id: fromWarehouseId } }), tx.warehouse.findUnique({ where: { id: toWarehouseId } }),
      ]);
      if (!product || product.deletedAt || !source?.status || !destination?.status) throw new TransferError("Product and active warehouses are required");
      const tracked = ["BATCH", "LOT", "HEAT"].includes(product.trackingMode);
      if (tracked && !id(body.batchId)) throw new TransferError("A source batch is required for tracked transfers");
      if (body.batchId) {
        const batch = await tx.inventoryBatch.findUnique({ where: { id: body.batchId } });
        if (!batch || batch.productId !== productId || batch.warehouseId !== fromWarehouseId || batch.status !== "ACTIVE" || batch.quantity - batch.reservedQuantity < body.quantity) throw new TransferError("Insufficient or invalid source batch");
        await tx.inventoryBatch.update({ where: { id: batch.id }, data: { reservedQuantity: addStock(batch.reservedQuantity, body.quantity) } });
      }
      if (body.unitId && body.unitId !== product.unitId) throw new TransferError("Transfer quantity must use the product base unit");
      const allocation = await tx.stockAllocation.findUnique({ where: { productId_warehouseId: { productId, warehouseId: fromWarehouseId } } });
      const available = await getStockAvailabilityInTx(tx, productId, fromWarehouseId);
      if (!allocation || !available.consistent || available.availableStock + 1e-9 < body.quantity) throw new TransferError("Insufficient available stock", 409);
      await tx.stockAllocation.update({ where: { id: allocation.id }, data: { reservedQuantity: addStock(allocation.reservedQuantity, body.quantity), updatedAt: now } });
      // Serialize global catalog commitments even when competing warehouses differ.
      await tx.product.update({ where: { id: productId }, data: { updatedAt: now } });
      transfer = await tx.stockTransfer.create({ data: {
        transferNumber: `TRF-${randomUUID()}`, productId, fromWarehouseId, toWarehouseId, quantity: body.quantity,
        unitId: product.unitId, fromBinId: body.fromBinId || null, toBinId: body.toBinId || null, batchId: body.batchId || null,
        status: "REQUESTED", receivedQuantity: 0, inTransitQuantity: 0, userId: current.id, requestedBy: current.id,
        notes: body.notes || null, requestedAt: now, auditHistory: audit("REQUESTED"),
      } });
    } else {
      const allowed: Record<string, string[]> = { APPROVE: ["REQUESTED"], DISPATCH: ["APPROVED"], RECEIVE: ["DISPATCHED", "IN_TRANSIT"], CANCEL: ["REQUESTED", "APPROVED"] };
      if (!allowed[action]?.includes(transfer.status)) throw new TransferError("Invalid transfer state transition", 409);
      const update: any = { auditHistory: audit(action) };
      if (action === "APPROVE") Object.assign(update, { status: "APPROVED", approvedBy: current.id, approvedAt: now });
      if (action === "DISPATCH" || action === "CANCEL") {
        const product = await tx.product.findUnique({ where: { id: transfer.productId } });
        if (!product) throw new TransferError("Product not found");
        if (["BATCH", "LOT", "HEAT"].includes(product.trackingMode) && !transfer.batchId) throw new TransferError("Tracked transfer requires source batch reconciliation", 409);
        if (transfer.batchId) {
          const batch = await tx.inventoryBatch.findUnique({ where: { id: transfer.batchId } });
          if (!batch || batch.productId !== transfer.productId || batch.warehouseId !== transfer.fromWarehouseId || batch.reservedQuantity < transfer.quantity || (action === "DISPATCH" && batch.quantity < transfer.quantity)) throw new TransferError("Source batch requires reconciliation", 409);
          await tx.inventoryBatch.update({ where: { id: batch.id }, data: { reservedQuantity: addStock(batch.reservedQuantity, -transfer.quantity), ...(action === "DISPATCH" ? { quantity: addStock(batch.quantity, -transfer.quantity) } : {}) } });
        }
        const allocation = await tx.stockAllocation.findUnique({ where: { productId_warehouseId: { productId: transfer.productId, warehouseId: transfer.fromWarehouseId } } });
        if (!allocation || allocation.reservedQuantity < transfer.quantity) throw new TransferError("Transfer reservation requires reconciliation", 409);
        await tx.stockAllocation.update({ where: { id: allocation.id }, data: { reservedQuantity: addStock(allocation.reservedQuantity, -transfer.quantity), updatedAt: now } });
        if (action === "DISPATCH") {
          const movement = await executeStockMutationInTx(tx, { productId: transfer.productId, warehouseId: transfer.fromWarehouseId, quantity: transfer.quantity,
            unitId: transfer.unitId, sourceBinId: transfer.fromBinId, batchId: transfer.batchId, batchAccounting: BATCH_MANAGED_IN_TX, movementType: "TRANSFER_OUT", referenceType: "StockTransfer", referenceId: transfer.id, performedBy: current.id });
          if (transfer.batchId) await tx.stockMovement.update({ where: { id: movement.movementId }, data: { batchId: transfer.batchId } });
          Object.assign(update, { status: "DISPATCHED", inTransitQuantity: transfer.quantity, dispatchedBy: current.id, dispatchedAt: now });
        } else Object.assign(update, { status: "CANCELLED", cancelledBy: current.id, cancellationReason: body.reason || null });
      }
      if (action === "RECEIVE") {
        const amount = body.receivedQuantity;
        if (!positive(amount) || !positive(transfer.inTransitQuantity) || amount > transfer.inTransitQuantity) throw new TransferError("Receipt must be positive and cannot exceed dispatched outstanding quantity");
        // Legacy DISPATCHED documents without authoritative in-transit quantity
        // are blocked for explicit reconciliation, never silently backfilled.
        const received = (stockUnits(transfer.receivedQuantity || 0) + stockUnits(amount)) / STOCK_SCALE;
        if (received > transfer.quantity) throw new TransferError("Receipt exceeds transfer quantity");
        const transit = (stockUnits(transfer.inTransitQuantity) - stockUnits(amount)) / STOCK_SCALE;
        const product = await tx.product.findUnique({ where: { id: transfer.productId } });
        if (["BATCH", "LOT", "HEAT"].includes(product?.trackingMode) && !transfer.batchId) throw new TransferError("Tracked transfer requires source batch reconciliation", 409);
        let destinationBatch: any = null;
        if (transfer.batchId) {
          const sourceBatch = await tx.inventoryBatch.findUnique({ where: { id: transfer.batchId } });
          if (!sourceBatch || sourceBatch.productId !== transfer.productId || sourceBatch.warehouseId !== transfer.fromWarehouseId) throw new TransferError("Invalid source batch", 409);
          destinationBatch = await createOrUpdateBatchOnReceiptInTx(tx, { productId: transfer.productId, warehouseId: transfer.toWarehouseId,
            batchNumber: sourceBatch.batchNumber, lotNumber: sourceBatch.lotNumber, heatNumber: sourceBatch.heatNumber,
            manufactureDate: sourceBatch.manufactureDate, expiryDate: sourceBatch.expiryDate, supplierId: sourceBatch.supplierId, quantity: amount });
        }
        await executeStockMutationInTx(tx, { productId: transfer.productId, warehouseId: transfer.toWarehouseId, quantity: amount,
          unitId: transfer.unitId, destinationBinId: transfer.toBinId, batchId: destinationBatch?.id, batchAccounting: BATCH_MANAGED_IN_TX,
          movementType: "TRANSFER_IN", referenceType: "StockTransfer", referenceId: transfer.id, performedBy: current.id });
        Object.assign(update, { status: transit === 0 ? "COMPLETED" : "IN_TRANSIT", receivedQuantity: received, inTransitQuantity: transit,
          receivedBy: current.id, receivedAt: now, completedAt: transit === 0 ? now : null });
      }
      // The compare-and-swap and every stock/ledger write share one transaction.
      const claimed = await tx.stockTransfer.updateMany({ where: { id: transfer.id, status: transfer.status, receivedQuantity: transfer.receivedQuantity }, data: update });
      if (claimed.count !== 1) throw new TransferError("Transfer changed concurrently", 409);
      transfer = await tx.stockTransfer.findUnique({ where: { id: transfer.id } });
    }
    const response = { success: true, action, transfer: JSON.parse(JSON.stringify(transfer)) };
    await tx.inventoryOperation.create({ data: { operationKey, actorId: current.id, requestHash, response } });
    return response;
  });
}
