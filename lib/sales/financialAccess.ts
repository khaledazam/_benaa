import { hasPermission } from "@/lib/auth/permissions";
import { canAccessInventoryWarehouse } from "@/lib/auth/inventory-route-access";

/** null means a legacy order: preserve its existing authorization policy. ERP
 * financial records always require current manager permission and warehouse
 * assignment, including when the employee originally owned the catalog. */
export async function erpFinancialAccess(db: any, actorId: string, orderId: string): Promise<boolean | null> {
  const order = await db.order.findUnique({ where: { id: orderId } });
  if (!order?.erpSalesOrderId) return null;
  const [actor, sale] = await Promise.all([
    db.user.findUnique({ where: { id: actorId } }),
    db.salesOrder.findUnique({ where: { id: order.erpSalesOrderId } }),
  ]);
  const now = new Date();
  return !!(actor && actor.status === true && actor.isSubscriptionActive !== false &&
    (!actor.subscriptionStartDate || actor.subscriptionStartDate <= now) &&
    (!actor.subscriptionEndDate || actor.subscriptionEndDate >= now) &&
    sale && sale.customerId === order.customerId &&
    hasPermission(actor, "SALES_ORDER_APPROVE") && canAccessInventoryWarehouse(actor, sale.warehouseId));
}
