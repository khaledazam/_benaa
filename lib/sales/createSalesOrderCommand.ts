import { createHash } from "node:crypto";
import { prisma } from "@/prisma/client";
import { inventoryTransaction } from "@/lib/inventory/transaction";
import { stockUnits } from "@/lib/inventory/quantity";
import { convertUnitQuantity } from "@/lib/units/unitService";
import { hasPermission } from "@/lib/auth/permissions";
import { canAccessInventoryWarehouse } from "@/lib/auth/inventory-route-access";
import { createSalesOrderDraft, type CreateSalesOrderInput } from "./salesOrderService";

const fail = (message: string, status = 400): never => { throw Object.assign(new Error(message), { status }); };
const money = (value: unknown, label: string) => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) fail(`Invalid ${label}`);
};

/** A draft does not reserve or deduct stock. Approval and reservation retain
 * their existing separate lifecycles. Header, items, audit and retry receipt
 * must commit together, with current employee authorization inside the TX. */
export async function createSalesOrderCommand(data: CreateSalesOrderInput, actorId: string, key: string | null, db: any = prisma) {
  if (!key || !/^[A-Za-z0-9_.:-]{1,128}$/.test(key)) fail("A stable Idempotency-Key is required");
  if (!data || !/^[a-f0-9]{24}$/i.test(data.customerId || "") || !/^[a-f0-9]{24}$/i.test(data.warehouseId || "")) fail("Valid customer and warehouse IDs are required");
  if (!Array.isArray(data.items) || !data.items.length || data.items.length > 500) fail("Sales orders require 1–500 lines");
  const allowedFields = new Set(["customerId", "warehouseId", "requestedDeliveryDate", "notes", "discount", "tax", "items"]);
  if (Object.keys(data).some(field => !allowedFields.has(field))) fail("Unsupported sales fields; legacy fees or financial policies must not be silently discarded");
  money(data.discount ?? 0, "order discount"); money(data.tax ?? 0, "order tax");
  for (const item of data.items) {
    if (!/^[a-f0-9]{24}$/i.test(item.productId || "")) fail("Invalid product ID");
    stockUnits(item.orderedQuantity);
    if (item.orderedQuantity <= 0) fail("Sales quantities must be finite and positive");
    if (item.unitPrice !== undefined) money(item.unitPrice, "unit price");
    money(item.discount ?? 0, "line discount"); money(item.tax ?? 0, "line tax");
  }
  if (data.requestedDeliveryDate && !Number.isFinite(new Date(data.requestedDeliveryDate).getTime())) fail("Invalid delivery date");
  const canonical = (value: any): any => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object"
    ? Object.fromEntries(Object.keys(value).sort().map(field => [field, canonical(value[field])])) : value;
  const requestHash = createHash("sha256").update(JSON.stringify(canonical(data))).digest("hex");
  const operationKey = `sales-order-create:${actorId}:${key}`;
  return inventoryTransaction(db, async tx => {
    const actor = await tx.user.findUnique({ where: { id: actorId } });
    const now = new Date();
    if (!actor || actor.status !== true || actor.isSubscriptionActive === false ||
        (actor.subscriptionStartDate && actor.subscriptionStartDate > now) ||
        (actor.subscriptionEndDate && actor.subscriptionEndDate < now) ||
        !hasPermission(actor, "SALES_ORDER_CREATE") || !canAccessInventoryWarehouse(actor, data.warehouseId)) fail("Forbidden sales warehouse or employee", 403);
    const warehouse = await tx.warehouse.findUnique({ where: { id: data.warehouseId } });
    if (!warehouse || warehouse.status === false) fail("Warehouse is inactive or missing");
    const previous = await tx.inventoryOperation.findUnique({ where: { operationKey } });
    if (previous) {
      if (previous.requestHash !== requestHash) fail("Idempotency key payload conflict", 409);
      return previous.response;
    }
    await tx.user.update({ where: { id: actorId }, data: { updatedAt: now } });
    for (const item of data.items) {
      const product = await tx.product.findUnique({ where: { id: item.productId } });
      if (!product || product.deletedAt) fail("Product is missing or archived");
      const base = await convertUnitQuantity({ quantity: item.orderedQuantity, fromUnitId: item.unitId || product.unitId, toUnitId: product.unitId, productId: product.id }, tx);
      stockUnits(base);
      const line = item.orderedQuantity * (item.unitPrice ?? product.price) - (item.discount || 0) + (item.tax || 0);
      if (!Number.isFinite(line) || line < 0) fail("Invalid sales line total");
    }
    // Preserve the existing line/header discount and tax arithmetic unchanged.
    const order = await createSalesOrderDraft(data, actorId, tx);
    if (!Number.isFinite(order.total) || order.total < 0) fail("Invalid sales order total");
    const response = JSON.parse(JSON.stringify(order));
    await tx.inventoryOperation.create({ data: { operationKey, actorId, requestHash, response } });
    return response;
  });
}
