import { withWarehouseScope } from "@/lib/auth/warehouse-route-scope";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth-server";
import { mapSessionToAppUser } from "@/lib/auth/map-session-user";
import { hasPermission, BuildStockPermissions } from "@/lib/auth/permissions";
import { cancelDispatchSchema } from "@/lib/validations/dispatch-validations";
import { cancelDispatch } from "@/lib/dispatch/dispatchService";

async function scopedPOST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const user = session ? mapSessionToAppUser(session) : null;
    const role = user?.role || "VIEWER";

    if (!user || !hasPermission(user, BuildStockPermissions.DISPATCH_CANCEL)) {
      return NextResponse.json({ error: "Forbidden: Insufficient permissions to cancel Dispatch" }, { status: 403 });
    }

    const { id } = await params;
    const body = await req.json();
    const data = cancelDispatchSchema.parse(body);

    const dispatch = await cancelDispatch(id, data.reason, user.id);
    return NextResponse.json(dispatch);
  } catch (error: any) {
    console.error(`POST /api/dispatches/[id]/cancel error:`, error);
    return NextResponse.json(
      { error: error.message || "Failed to cancel dispatch" },
      { status: error.status || 400 }
    );
  }
}

export const POST = withWarehouseScope(scopedPOST);
