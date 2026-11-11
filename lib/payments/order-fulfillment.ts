import { createHash } from "node:crypto";
import { executeStockMutationInTx } from "@/lib/inventory/stockService";
import { getStockAvailabilityInTx } from "@/lib/inventory/availability";
import { addStock, stockUnits } from "@/lib/inventory/quantity";

export async function fulfillPaidOrderInTx(tx: any, order: any) {
  const operationKey = `order-fulfillment:${order.id}`;
  const requestHash = createHash("sha256").update(JSON.stringify(order.items.map((i: any) => ({ productId: i.productId, warehouseId: i.warehouseId || null, quantity: i.quantity })))).digest("hex");
  const existing = await tx.inventoryOperation.findUnique({ where: { operationKey } });
  if (existing) {
    if (existing.requestHash !== requestHash) throw new Error("Fulfilled order lines cannot be changed without a reversal");
    return;
  }
  if (order.status !== "pending") throw new Error("Historical fulfillment requires reconciliation before retry");
  if (!order.items.length) throw new Error("Cannot fulfill an empty order");
  for (const line of order.items) {
    stockUnits(line.quantity);
    if (line.quantity <= 0) throw new Error("Invalid order quantity");
    const product = await tx.product.findUnique({ where: { id: line.productId } });
    if (!product) throw new Error("Order product not found");
    if (line.warehouseId) {
      const allocation = await tx.stockAllocation.findUnique({ where: { productId_warehouseId: { productId: line.productId, warehouseId: line.warehouseId } } });
      if (!allocation || allocation.reservedQuantity < line.quantity) throw new Error("Order reservation requires reconciliation");
      await tx.stockAllocation.update({ where: { id: allocation.id }, data: { reservedQuantity: addStock(allocation.reservedQuantity, -line.quantity) } });
      await executeStockMutationInTx(tx, { productId: line.productId, warehouseId: line.warehouseId, quantity: line.quantity,
        movementType: "SALE", referenceType: "Order", referenceId: order.id, performedBy: order.createdBy || order.userId });
    } else {
      if (product.reservedQuantity < line.quantity) throw new Error("Catalog reservation requires reconciliation");
      await tx.product.update({ where: { id: product.id }, data: { reservedQuantity: addStock(product.reservedQuantity, -line.quantity) } });
      const allocations = await tx.stockAllocation.findMany({ where: { productId: product.id }, orderBy: { quantity: "desc" } });
      const candidates = [];
      for (const allocation of allocations) {
        const available = await getStockAvailabilityInTx(tx, product.id, allocation.warehouseId);
        if (!available.consistent) throw new Error("Inventory commitments require reconciliation");
        candidates.push({ allocation, available: available.availableStock });
      }
      // Preserve the existing legacy largest-available-allocation selection.
      candidates.sort((a, b) => b.available - a.available || a.allocation.id.localeCompare(b.allocation.id));
      let remaining = line.quantity;
      for (const candidate of candidates) {
        if (remaining === 0) break;
        const take = Math.min(remaining, candidate.available);
        if (take <= 0) continue;
        await executeStockMutationInTx(tx, { productId: product.id, warehouseId: candidate.allocation.warehouseId, quantity: take,
          movementType: "SALE", referenceType: "Order", referenceId: order.id, performedBy: order.createdBy || order.userId });
        remaining = addStock(remaining, -take);
      }
      if (remaining !== 0) throw new Error("Explicit warehouse allocation is required for unallocated stock");
    }
  }
  await tx.inventoryOperation.create({ data: { operationKey, actorId: order.userId, requestHash, response: { orderId: order.id, stockFulfilled: true } } });
}
