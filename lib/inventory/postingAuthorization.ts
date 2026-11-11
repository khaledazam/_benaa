import { hasPermission, type PermissionName } from "@/lib/auth/permissions";
import { canAccessInventoryWarehouse } from "@/lib/auth/inventory-route-access";

export async function authorizeInventoryPosting(tx: any, actorId: string, warehouseId: string, permission: PermissionName, fence = true) {
  const actor = await tx.user.findUnique({ where: { id: actorId } });
  const now = new Date();
  if (!actor || actor.status !== true || actor.isSubscriptionActive === false ||
      (actor.subscriptionStartDate && actor.subscriptionStartDate > now) ||
      (actor.subscriptionEndDate && actor.subscriptionEndDate < now) ||
      !hasPermission(actor, permission) || !canAccessInventoryWarehouse(actor, warehouseId)) {
    throw Object.assign(new Error("Forbidden inventory posting or current warehouse assignment"), { status: 403 });
  }
  // Reassignment or access revocation must conflict with this transaction.
  if (fence) await tx.user.update({ where: { id: actorId }, data: { updatedAt: now } });
  return actor;
}
