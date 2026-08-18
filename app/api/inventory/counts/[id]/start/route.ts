import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth-server";
import { mapSessionToAppUser } from "@/lib/auth/map-session-user";
import { hasPermission, BuildStockPermissions } from "@/lib/auth/permissions";
import { startInventoryCount } from "@/lib/inventory/countingService";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    const user = session ? mapSessionToAppUser(session) : null;
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const role = user.role || "VIEWER";

    if (!hasPermission(role, BuildStockPermissions.INVENTORY_COUNT_START)) {
      return NextResponse.json({ error: "Forbidden — INVENTORY_COUNT_START permission required" }, { status: 403 });
    }

    const { id } = await params;
    const started = await startInventoryCount(id, user.id);
    return NextResponse.json(started);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to start inventory count" }, { status: 400 });
  }
}
