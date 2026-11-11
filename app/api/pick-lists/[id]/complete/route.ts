import { withWarehouseScope } from "@/lib/auth/warehouse-route-scope";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth-server";
import { mapSessionToAppUser } from "@/lib/auth/map-session-user";
import { hasPermission, BuildStockPermissions } from "@/lib/auth/permissions";
import { completePickList } from "@/lib/picking/pickingService";
import { completePickListSchema } from "@/lib/validations/picking-validations";

async function scopedPOST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const user = session ? mapSessionToAppUser(session) : null;
    const role = user?.role || "VIEWER";

    if (!hasPermission(user, BuildStockPermissions.PICK_LIST_COMPLETE)) {
      return NextResponse.json({ error: "Forbidden: Insufficient permissions to complete Pick List" }, { status: 403 });
    }

    const { id } = await context.params;
    let body = {};
    try {
      body = await req.json();
    } catch {
      // Body optional if standard complete without body
    }

    const parsed = completePickListSchema.parse(body);

    const completed = await completePickList(id, user?.id || "system", {
      allowShort: parsed.allowShort,
    });

    return NextResponse.json(completed);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to complete Pick List" }, { status: 400 });
  }
}

export const POST = withWarehouseScope(scopedPOST);
