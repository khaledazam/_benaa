import { withWarehouseScope } from "@/lib/auth/warehouse-route-scope";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth-server";
import { mapSessionToAppUser } from "@/lib/auth/map-session-user";
import { hasPermission, BuildStockPermissions } from "@/lib/auth/permissions";
import { getPickLists, createPickList } from "@/lib/picking/pickingService";
import { createPickListSchema } from "@/lib/validations/picking-validations";

async function scopedGET(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const user = session ? mapSessionToAppUser(session) : null;
    const role = user?.role || "VIEWER";

    if (!hasPermission(user, BuildStockPermissions.PICK_LIST_VIEW)) {
      return NextResponse.json({ error: "Forbidden: Insufficient permissions to view Pick Lists" }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const search = searchParams.get("search") || undefined;
    const status = searchParams.get("status") || undefined;
    const warehouseId = searchParams.get("warehouseId") || undefined;
    const salesOrderId = searchParams.get("salesOrderId") || undefined;
    const assignedTo = searchParams.get("assignedTo") || undefined;
    const page = parseInt(searchParams.get("page") || "1", 10);
    const limit = parseInt(searchParams.get("limit") || "10", 10);
    const sortBy = (searchParams.get("sortBy") as any) || "createdAt";
    const sortOrder = (searchParams.get("sortOrder") as any) || "desc";

    const result = await getPickLists({
      search,
      status,
      warehouseId,
      salesOrderId,
      assignedTo,
      page,
      limit,
      sortBy,
      sortOrder,
    });

    return NextResponse.json(result);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to fetch Pick Lists" }, { status: 500 });
  }
}

async function scopedPOST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const user = session ? mapSessionToAppUser(session) : null;
    const role = user?.role || "VIEWER";

    if (!hasPermission(user, BuildStockPermissions.PICK_LIST_CREATE)) {
      return NextResponse.json({ error: "Forbidden: Insufficient permissions to create Pick List" }, { status: 403 });
    }

    const body = await req.json();
    const parsed = createPickListSchema.parse(body);

    const pickList = await createPickList({
      reservationId: parsed.reservationId,
      assignedTo: parsed.assignedTo,
      userId: user?.id || "system",
    });

    return NextResponse.json(pickList, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to create Pick List" }, { status: 400 });
  }
}

export const GET = withWarehouseScope(scopedGET);
export const POST = withWarehouseScope(scopedPOST);
