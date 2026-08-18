import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth-server";
import { mapSessionToAppUser } from "@/lib/auth/map-session-user";
import { hasPermission, BuildStockPermissions } from "@/lib/auth/permissions";
import { postAdjustment } from "@/lib/inventory/adjustmentService";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    const user = session ? mapSessionToAppUser(session) : null;
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const role = user.role || "VIEWER";

    if (!hasPermission(role, BuildStockPermissions.INVENTORY_ADJUSTMENT_POST)) {
      return NextResponse.json({ error: "Forbidden — INVENTORY_ADJUSTMENT_POST permission required" }, { status: 403 });
    }

    const { id } = await params;
    const posted = await postAdjustment(id, user.id);
    return NextResponse.json(posted);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to post adjustment" }, { status: 400 });
  }
}
