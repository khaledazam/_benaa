import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { hasPermission, type PermissionName } from "@/lib/auth/permissions";

export async function inventoryRouteAccess(request: NextRequest, permission: PermissionName) {
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  if (!hasPermission(session, permission)) {
    return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
  }
  return session;
}

export function isInventoryAdmin(session: { role: string | null }) {
  return session.role === "SUPER_ADMIN" || session.role === "admin";
}

export function canAccessInventoryWarehouse(session: { role: string | null; primaryWarehouseId?: string | null; warehouseIds?: string[] }, warehouseId: string) {
  return isInventoryAdmin(session) || session.primaryWarehouseId === warehouseId || (session.warehouseIds || []).includes(warehouseId);
}
