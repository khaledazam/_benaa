import { withWarehouseScope } from "@/lib/auth/warehouse-route-scope";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth-server";
import { mapSessionToAppUser } from "@/lib/auth/map-session-user";
import { hasPermission, BuildStockPermissions } from "@/lib/auth/permissions";
import { cancelPickList } from "@/lib/picking/pickingService";
import { cancelPickListSchema } from "@/lib/validations/picking-validations";

async function scopedPOST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const user = session ? mapSessionToAppUser(session) : null;
    const role = user?.role || "VIEWER";

    if (!hasPermission(user, BuildStockPermissions.PICK_LIST_CANCEL)) {
      return NextResponse.json({ error: "Forbidden: Insufficient permissions to cancel Pick List" }, { status: 403 });
    }

    const { id } = await context.params;
    let body = {};
    try {
      body = await req.json();
    } catch {
      // Optional body
    }

    const parsed = cancelPickListSchema.parse(body);

    const cancelled = await cancelPickList(id, parsed.reason, user?.id || "system");

    return NextResponse.json(cancelled);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to cancel Pick List" }, { status: 400 });
  }
}

export const POST = withWarehouseScope(scopedPOST);
