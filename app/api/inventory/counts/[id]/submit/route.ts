import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth-server";
import { mapSessionToAppUser } from "@/lib/auth/map-session-user";
import { hasPermission, BuildStockPermissions } from "@/lib/auth/permissions";
import { submitInventoryCount } from "@/lib/inventory/countingService";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    const user = session ? mapSessionToAppUser(session) : null;
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const role = user.role || "VIEWER";

    if (!hasPermission(role, BuildStockPermissions.INVENTORY_COUNT_SUBMIT)) {
      return NextResponse.json({ error: "Forbidden — INVENTORY_COUNT_SUBMIT permission required" }, { status: 403 });
    }

    const { id } = await params;
    const submitted = await submitInventoryCount(id, user.id);
    return NextResponse.json(submitted);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to submit inventory count" }, { status: 400 });
  }
}
