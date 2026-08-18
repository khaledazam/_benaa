import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth-server";
import { mapSessionToAppUser } from "@/lib/auth/map-session-user";
import { hasPermission, BuildStockPermissions } from "@/lib/auth/permissions";
import { updateAllocationSchema } from "@/lib/validations/picking-validations";
import { prisma } from "@/prisma/client";
import { roundQty } from "@/lib/picking/pickingService";

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string; allocationId: string }> }
) {
  try {
    const session = await getSession();
    const user = session ? mapSessionToAppUser(session) : null;
    const role = user?.role || "VIEWER";

    if (!hasPermission(role, BuildStockPermissions.PICK_LIST_UPDATE)) {
      return NextResponse.json({ error: "Forbidden: Insufficient permissions to update Pick Allocation" }, { status: 403 });
    }

    const { id: pickListId, allocationId } = await context.params;
    const body = await req.json();
    const parsed = updateAllocationSchema.parse(body);

    const pickList = await prisma.pickList.findUnique({
      where: { id: pickListId },
    });

    if (!pickList) throw new Error("Pick List not found");
    if (["COMPLETED", "CANCELLED"].includes(pickList.status)) {
      throw new Error(`Cannot modify allocations for Pick List in '${pickList.status}' status.`);
    }

    const allocation = await prisma.pickAllocation.findUnique({
      where: { id: allocationId },
      include: { pickListItem: true },
    });

    if (!allocation || allocation.pickListItem.pickListId !== pickListId) {
      throw new Error("Pick Allocation not found in this Pick List.");
    }

    const pickedQty = roundQty(parsed.pickedQuantity);
    if (pickedQty > allocation.requestedQuantity) {
      throw new Error(`Picked quantity (${pickedQty}) cannot exceed requested bin allocation (${allocation.requestedQuantity}).`);
    }

    const updated = await prisma.$transaction(async (tx) => {
      await tx.pickAllocation.update({
        where: { id: allocationId },
        data: {
          pickedQuantity: pickedQty,
          updatedAt: new Date(),
        },
      });

      // Recalculate item picked quantity
      const allItemAllocations = await tx.pickAllocation.findMany({
        where: { pickListItemId: allocation.pickListItemId },
      });

      const totalItemPicked = roundQty(allItemAllocations.reduce((sum, a) => sum + a.pickedQuantity, 0));
      const remaining = roundQty(Math.max(0, allocation.pickListItem.requestedQuantity - totalItemPicked));
      
      let itemStatus = "PENDING";
      if (totalItemPicked >= allocation.pickListItem.requestedQuantity) {
        itemStatus = "PICKED";
      } else if (totalItemPicked > 0) {
        itemStatus = "PARTIALLY_PICKED";
      }

      await tx.pickListItem.update({
        where: { id: allocation.pickListItemId },
        data: {
          pickedQuantity: totalItemPicked,
          remainingQuantity: remaining,
          status: itemStatus,
          updatedAt: new Date(),
        },
      });

      await tx.auditLog.create({
        data: {
          userId: user?.id || "system",
          action: "pick_allocation_updated",
          entityType: "PickAllocation",
          entityId: allocationId,
          details: {
            pickListNumber: pickList.pickListNumber,
            allocationId,
            pickedQuantity: pickedQty,
          },
        },
      });

      return await tx.pickList.findUnique({
        where: { id: pickListId },
        include: {
          items: {
            include: {
              product: true,
              allocations: { include: { bin: true } },
            },
          },
          salesOrder: { include: { customer: true } },
          warehouse: true,
        },
      });
    });

    return NextResponse.json(updated);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to update allocation" }, { status: 400 });
  }
}
