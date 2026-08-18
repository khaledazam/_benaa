import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth-server";
import { mapSessionToAppUser } from "@/lib/auth/map-session-user";
import { hasPermission, BuildStockPermissions } from "@/lib/auth/permissions";
import { getReservationById } from "@/lib/reservations/reservationService";

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    const user = session ? mapSessionToAppUser(session) : null;
    const role = user?.role || "VIEWER";

    if (!hasPermission(role, BuildStockPermissions.RESERVATION_VIEW)) {
      return NextResponse.json({ error: "Forbidden: Insufficient permissions to view stock reservation" }, { status: 403 });
    }

    const { id } = await context.params;
    const reservation = await getReservationById(id);

    if (!reservation) {
      return NextResponse.json({ error: "Stock Reservation not found" }, { status: 404 });
    }

    return NextResponse.json(reservation);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to fetch stock reservation" }, { status: 500 });
  }
}
