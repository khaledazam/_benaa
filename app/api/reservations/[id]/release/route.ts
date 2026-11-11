import { withWarehouseScope } from "@/lib/auth/warehouse-route-scope";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth-server";
import { mapSessionToAppUser } from "@/lib/auth/map-session-user";
import { hasPermission, BuildStockPermissions } from "@/lib/auth/permissions";
import { releaseReservation } from "@/lib/reservations/reservationService";

async function scopedPOST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const user = session ? mapSessionToAppUser(session) : null;
    const role = user?.role || "VIEWER";

    if (!hasPermission(user, BuildStockPermissions.RESERVATION_RELEASE)) {
      return NextResponse.json({ error: "Forbidden: Insufficient permissions to release stock reservation" }, { status: 403 });
    }

    const { id } = await context.params;
    let body = {};
    try {
      body = await req.json();
    } catch {
      // Body is optional for full release
    }

    const released = await releaseReservation(id, body, user?.id || "system");
    return NextResponse.json(released);
  } catch (error: any) {
    const status = error.message?.includes("not found") ? 404 : error.message?.includes("Cannot release") ? 400 : 500;
    return NextResponse.json({ error: error.message || "Failed to release stock reservation" }, { status });
  }
}

export const POST = withWarehouseScope(scopedPOST);
