import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth-server";
import { mapSessionToAppUser } from "@/lib/auth/map-session-user";
import { hasPermission, BuildStockPermissions } from "@/lib/auth/permissions";
import { startPickList } from "@/lib/picking/pickingService";

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    const user = session ? mapSessionToAppUser(session) : null;
    const role = user?.role || "VIEWER";

    if (!hasPermission(role, BuildStockPermissions.PICK_LIST_START)) {
      return NextResponse.json({ error: "Forbidden: Insufficient permissions to start Pick List" }, { status: 403 });
    }

    const { id } = await context.params;
    const updated = await startPickList(id, user?.id || "system");

    return NextResponse.json(updated);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to start Pick List" }, { status: 400 });
  }
}
