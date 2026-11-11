import { createHash } from "node:crypto";
import { inventoryTransaction } from "./transaction";
import { executeStockMutationInTx } from "./stockService";
import { hasPermission, normalizeRole } from "@/lib/auth/permissions";
import { canAccessInventoryWarehouse } from "@/lib/auth/inventory-route-access";

export class ManualMovementError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

/** Document-managed movements can only be posted by their approval lifecycle. */
export async function postManualMovement(db: any, actorId: string, body: any, key: string | null) {
  const allowed = ["OPENING_BALANCE", "DAMAGE", "LOSS", "ADJUSTMENT_IN", "ADJUSTMENT_OUT"];
  if (!allowed.includes(body.movementType)) {
    throw new ManualMovementError("Use the approved business document lifecycle for this movement type", 409);
  }
  if (!key || !/^[A-Za-z0-9_.:-]{1,128}$/.test(key)) {
    throw new ManualMovementError("A stable Idempotency-Key is required", 400);
  }
  const payload = Object.fromEntries(["productId", "warehouseId", "quantity", "unitId", "movementType", "reason", "sourceBinId", "destinationBinId", "batchId"].map(field => [field, body[field] ?? null]));
  const hash = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  const operationKey = `manual-stock:${actorId}:${key}`;
  return inventoryTransaction(db, async tx => {
    const actor = await tx.user.findUnique({ where: { id: actorId } });
    const now = new Date();
    if (!actor || actor.status !== true || actor.isSubscriptionActive === false ||
        (actor.subscriptionStartDate && actor.subscriptionStartDate > now) ||
        (actor.subscriptionEndDate && actor.subscriptionEndDate < now) ||
        !canAccessInventoryWarehouse(actor, body.warehouseId)) {
      throw new ManualMovementError("Current account or warehouse authorization is required", 403);
    }
    const adjustment = body.movementType.startsWith("ADJUSTMENT");
    const permission = adjustment ? "STOCK_ADJUST" :
      body.movementType === "OPENING_BALANCE" ? "STOCK_IN" : "STOCK_OUT";
    if (!hasPermission(actor, permission) || (adjustment &&
        !["SUPER_ADMIN", "WAREHOUSE_MANAGER", "INVENTORY_OFFICER"].includes(normalizeRole(actor.role)))) {
      throw new ManualMovementError("Insufficient movement permission", 403);
    }
    const previous = await tx.inventoryOperation.findUnique({ where: { operationKey } });
    if (previous) {
      if (previous.requestHash !== hash) throw new ManualMovementError("Idempotency key payload conflict", 409);
      return { ...(previous.response as any), replayed: true };
    }
    await tx.user.update({ where: { id: actorId }, data: { updatedAt: now } });
    const result = await executeStockMutationInTx(tx, {
      ...payload, referenceType: "ManualStockOperation", performedBy: actorId,
      // External callers cannot forge an approving employee or another document.
      approvedBy: adjustment ? actorId : undefined,
    } as any);
    const response = JSON.parse(JSON.stringify(result));
    await tx.inventoryOperation.create({ data: {
      operationKey, actorId, requestHash: hash, response,
    } });
    return response;
  });
}
