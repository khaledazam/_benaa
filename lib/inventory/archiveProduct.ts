import { inventoryTransaction } from "./transaction";
import { hasPermission } from "@/lib/auth/permissions";
import { ManualMovementError } from "./manualMovement";

/** Preserve every inventory/history row. Archival and stock mutations contend
 * on the same product document inside MongoDB transactions. */
export async function archiveEmptyProduct(db: any, actorId: string, productId: string) {
  return inventoryTransaction(db, async tx => {
    const actor = await tx.user.findUnique({ where: { id: actorId } });
    if (!actor || actor.status !== true || actor.isSubscriptionActive === false || (actor.subscriptionStartDate && actor.subscriptionStartDate > new Date()) || (actor.subscriptionEndDate && actor.subscriptionEndDate < new Date()) || !hasPermission(actor, "PRODUCT_DELETE")) throw new ManualMovementError("Forbidden product archival", 403);
    const product = await tx.product.findUnique({ where: { id: productId } });
    if (!product || product.userId !== actorId) throw new ManualMovementError("Product not found or unauthorized", 404);
    if (product.deletedAt) return { success: true, mode: "soft", replayed: true };
    const [allocations, locations, batches, projectItems, transfers, sales, purchaseItems, commercial] = await Promise.all([
      tx.stockAllocation.findMany({ where: { productId } }),
      tx.stockLocationAllocation.findMany({ where: { productId } }),
      tx.inventoryBatch.findMany({ where: { productId } }),
      tx.projectMaterialIssueItem.findMany({ where: { productId } }),
      tx.stockTransfer.findMany({ where: { productId, status: { notIn: ["COMPLETED", "CANCELLED", "REJECTED"] } } }),
      tx.stockReservationItem.findMany({ where: { productId, reservation: { status: { in: ["ACTIVE", "PARTIALLY_FULFILLED"] } } } }),
      tx.purchaseOrderItem.findMany({ where: { productId, purchaseOrder: { status: { notIn: ["CANCELLED", "CLOSED", "COMPLETED", "RECEIVED"] } } } }),
      tx.orderItem.findMany({ where: { productId, order: { status: { notIn: ["delivered", "cancelled", "refunded"] } } } }),
    ]);
    const nonzero = (row: any) => Number(row.quantity || 0) !== 0 || Number(row.reservedQuantity || 0) !== 0;
    if (nonzero(product) || allocations.some(nonzero) || locations.some(nonzero) || batches.some(nonzero) ||
        projectItems.some((line: any) => line.remainingQuantity > 0 || line.dispatchedQuantity !== line.returnedQuantity) ||
        transfers.length || sales.some((line: any) => line.remainingQuantity > 0) || purchaseItems.length || commercial.length) {
      throw new ManualMovementError("Product has stock, custody or open business commitments; reconcile these before archival", 409);
    }
    const now = new Date();
    await tx.user.update({ where: { id: actorId }, data: { updatedAt: now } });
    await tx.product.update({ where: { id: productId }, data: { deletedAt: now, deletedBy: actorId, updatedAt: now, updatedBy: actorId } });
    await tx.auditLog.create({ data: { userId: actorId, action: "archive", entityType: "product", entityId: productId, details: { mode: "soft", reason: "Empty product; inventory and business history retained" } } });
    return { success: true, mode: "soft" };
  });
}
