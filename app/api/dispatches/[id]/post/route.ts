import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth-server";
import { mapSessionToAppUser } from "@/lib/auth/map-session-user";
import { hasPermission, BuildStockPermissions } from "@/lib/auth/permissions";
import { postDispatch } from "@/lib/dispatch/dispatchService";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    const user = session ? mapSessionToAppUser(session) : null;
    const role = user?.role || "VIEWER";

    if (!user || !hasPermission(role, BuildStockPermissions.DISPATCH_POST)) {
      return NextResponse.json({ error: "Forbidden: Insufficient permissions to post Dispatch" }, { status: 403 });
    }

    const { id } = await params;
    const dispatch = await postDispatch(id, user.id);
    return NextResponse.json(dispatch);
  } catch (error: any) {
    console.error(`POST /api/dispatches/[id]/post error:`, error);
    return NextResponse.json(
      { error: error.message || "Failed to post dispatch" },
      { status: error.status || 400 }
    );
  }
}
