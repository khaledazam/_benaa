import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth-server";
import { mapSessionToAppUser } from "@/lib/auth/map-session-user";
import { hasPermission, BuildStockPermissions } from "@/lib/auth/permissions";
import { getDispatchById } from "@/lib/dispatch/dispatchService";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    const user = session ? mapSessionToAppUser(session) : null;
    const role = user?.role || "VIEWER";

    if (!hasPermission(role, BuildStockPermissions.DISPATCH_VIEW)) {
      return NextResponse.json({ error: "Forbidden: Insufficient permissions to view Dispatch" }, { status: 403 });
    }

    const { id } = await params;
    const dispatch = await getDispatchById(id);
    return NextResponse.json(dispatch);
  } catch (error: any) {
    console.error(`GET /api/dispatches/[id] error:`, error);
    return NextResponse.json(
      { error: error.message || "Failed to fetch dispatch" },
      { status: error.status || 404 }
    );
  }
}
