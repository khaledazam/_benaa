import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth-server";
import { mapSessionToAppUser } from "@/lib/auth/map-session-user";
import { hasPermission, BuildStockPermissions } from "@/lib/auth/permissions";
import { cancelReservation } from "@/lib/reservations/reservationService";

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    const user = session ? mapSessionToAppUser(session) : null;
    const role = user?.role || "VIEWER";

    if (!hasPermission(role, BuildStockPermissions.RESERVATION_CANCEL)) {
      return NextResponse.json({ error: "Forbidden: Insufficient permissions to cancel stock reservation" }, { status: 403 });
    }

    const { id } = await context.params;
    let body: any = {};
    try {
      body = await req.json();
    } catch {
      // Body optional
    }

    const cancelled = await cancelReservation(id, body.reason, user?.id || "system");
    return NextResponse.json(cancelled);
  } catch (error: any) {
    const status = error.message?.includes("not found") ? 404 : error.message?.includes("already in terminal status") ? 400 : 500;
    return NextResponse.json({ error: error.message || "Failed to cancel stock reservation" }, { status });
  }
}
