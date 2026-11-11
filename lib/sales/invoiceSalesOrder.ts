import { createHash } from "node:crypto";
import { inventoryTransaction } from "@/lib/inventory/transaction";
import { stockUnits, addStock } from "@/lib/inventory/quantity";
import { convertUnitQuantity } from "@/lib/units/unitService";
import { canAccessInventoryWarehouse } from "@/lib/auth/inventory-route-access";
import { hasPermission } from "@/lib/auth/permissions";
import { resolveStoreOwnerUserId } from "@/lib/orders/order-party";

const fail = (message: string, status = 409): never => { throw Object.assign(new Error(message), { status }); };

/** Approved release policy: one invoice for the entire approved order. No
 * proration of header discounts/tax. Require complete physical dispatch before
 * issuing it; a COMPLETED flag alone is not evidence of stock fulfillment. */
export async function invoiceSalesOrder(db: any, actorId: string, salesOrderId: string, dueDate: string, key: string | null) {
  if (!key || !/^[A-Za-z0-9_.:-]{1,128}$/.test(key)) fail("A stable Idempotency-Key is required", 400);
  if (!Number.isFinite(new Date(dueDate).getTime())) fail("An explicit valid invoice due date is required", 400);
  const normalizedDueDate = new Date(dueDate).toISOString();
  const requestHash = createHash("sha256").update(JSON.stringify({ salesOrderId, dueDate: normalizedDueDate })).digest("hex");
  const operationKey = `sales-order-invoice:${salesOrderId}`;
  const commandKey = `sales-invoice-command:${actorId}:${key}`;
  return inventoryTransaction(db, async tx => {
    const actor = await tx.user.findUnique({ where: { id: actorId } });
    const now = new Date();
    const so = await tx.salesOrder.findUnique({ where: { id: salesOrderId }, include: { items: true, customer: true } });
    if (!so) fail("Sales order not found", 404);
    if (!actor || actor.status !== true || actor.isSubscriptionActive === false ||
        (actor.subscriptionStartDate && actor.subscriptionStartDate > now) ||
        (actor.subscriptionEndDate && actor.subscriptionEndDate < now) ||
        !hasPermission(actor, "SALES_ORDER_APPROVE") || !canAccessInventoryWarehouse(actor, so.warehouseId)) fail("Forbidden invoice operation", 403);
    const priorCommand = await tx.inventoryOperation.findUnique({ where: { operationKey: commandKey } });
    if (priorCommand && priorCommand.requestHash !== requestHash) fail("Idempotency key payload conflict");
    const prior = await tx.inventoryOperation.findUnique({ where: { operationKey } });
    if (prior) {
      if (prior.requestHash !== requestHash) fail("Invoice already issued; invoice terms cannot be changed by replay");
      if (!priorCommand) {
        await tx.user.update({ where: { id: actorId }, data: { updatedAt: now } });
        await tx.inventoryOperation.create({ data: { operationKey: commandKey, actorId, requestHash, response: prior.response } });
      }
      return prior.response;
    }
    await tx.user.update({ where: { id: actorId }, data: { updatedAt: now } });
    await tx.salesOrder.update({ where: { id: so.id }, data: { updatedAt: now } });
    if (so.status !== "COMPLETED" || !so.items.length) fail("Full posted dispatch is required before invoicing the entire sales order");
    const dispatches = await tx.dispatch.findMany({ where: { salesOrderId, status: "POSTED" }, include: { items: true } });
    const posted = new Map<string, number>();
    const products = new Map<string, any>();
    for (const item of so.items) {
      const product = await tx.product.findUnique({ where: { id: item.productId } });
      if (!product) fail("Historical product requires reconciliation");
      products.set(product.id, product);
      stockUnits(item.orderedQuantity);
    }
    for (const dispatch of dispatches) {
      if (dispatch.warehouseId !== so.warehouseId) fail("Dispatch warehouse requires reconciliation");
      for (const line of dispatch.items) {
        const original = so.items.find((item: any) => item.id === line.salesOrderItemId && item.productId === line.productId);
        if (!original) fail("Dispatch line requires reconciliation");
        const product = products.get(line.productId);
        const quantity = await convertUnitQuantity({ quantity: line.dispatchedQuantity, fromUnitId: line.unitId || product.unitId, toUnitId: original.unitId || product.unitId, productId: product.id }, tx);
        posted.set(original.id, addStock(posted.get(original.id) || 0, quantity));
      }
    }
    for (const item of so.items) if (stockUnits(posted.get(item.id) || 0) !== stockUnits(item.orderedQuantity)) fail("Sales line is not fully physically dispatched");
    const reservations = await tx.stockReservationItem.findMany({ where: { reservation: { salesOrderId, status: { in: ["ACTIVE", "PARTIALLY_FULFILLED"] } } } });
    if (reservations.some((r: any) => r.remainingQuantity !== 0)) fail("Sales reservations require reconciliation");
    const ownerId = resolveStoreOwnerUserId(so.items.map((item: any) => products.get(item.productId).userId));
    if (!ownerId) fail("Catalog owner is missing");
    const order = await tx.order.create({ data: {
      orderNumber: `ERP-${so.salesOrderNumber}`, erpSalesOrderId: so.id, customerId: so.customerId,
      userId: ownerId, clientId: null, createdBy: actorId, status: "confirmed", paymentStatus: "unpaid",
      subtotal: so.subtotal, tax: so.tax, discount: so.discount, total: so.total,
      notes: `ERP customer ${so.customerCodeSnapshot || so.customerId}; ${so.customerNameSnapshot || so.customer.name}`,
      items: { create: so.items.map((item: any) => ({ productId: item.productId, productName: item.productName, sku: item.productSku,
        quantity: item.orderedQuantity, price: item.unitPrice, subtotal: item.lineTotal, warehouseId: so.warehouseId })) },
    }, include: { items: true } });
    // Existing payment recovery recognizes this receipt. Stock was already
    // posted by dispatch and must never be deducted by a later payment event.
    const fulfillmentHash = createHash("sha256").update(JSON.stringify(order.items.map((i: any) => ({ productId: i.productId, warehouseId: i.warehouseId || null, quantity: i.quantity })))).digest("hex");
    await tx.inventoryOperation.create({ data: { operationKey: `order-fulfillment:${order.id}`, actorId, requestHash: fulfillmentHash,
      response: { orderId: order.id, stockFulfilled: true, salesOrderId, dispatchIds: dispatches.map((d: any) => d.id) } } });
    const invoice = await tx.invoice.create({ data: {
      invoiceNumber: `INV-${so.salesOrderNumber}`, orderId: order.id, userId: ownerId, clientId: null, createdBy: actorId,
      status: "sent", subtotal: so.subtotal, tax: so.tax, discount: so.discount, total: so.total,
      amountPaid: 0, amountDue: so.total, dueDate: new Date(normalizedDueDate), sentAt: now,
      notes: order.notes,
    } });
    const response = JSON.parse(JSON.stringify({ invoice, orderId: order.id, salesOrderId, customerId: so.customerId }));
    await tx.auditLog.create({ data: { userId: actorId, action: "sales_order_invoiced", entityType: "SalesOrder", entityId: so.id,
      details: { orderId: order.id, invoiceId: invoice.id, customerId: so.customerId, dispatchIds: dispatches.map((d: any) => d.id), policy: "ONE_FULL_APPROVED_ORDER_INVOICE" } } });
    for (const receiptKey of [operationKey, commandKey]) await tx.inventoryOperation.create({ data: { operationKey: receiptKey, actorId, requestHash, response } });
    return response;
  });
}
