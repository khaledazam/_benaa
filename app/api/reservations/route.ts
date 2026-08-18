import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth-server";
import { mapSessionToAppUser } from "@/lib/auth/map-session-user";
import { hasPermission, BuildStockPermissions } from "@/lib/auth/permissions";
import { createStockReservation, getReservations } from "@/lib/reservations/reservationService";

export async function GET(req: NextRequest) {
  try {
    const session = await getSession();
    const user = session ? mapSessionToAppUser(session) : null;
    const role = user?.role || "VIEWER";

    if (!hasPermission(role, BuildStockPermissions.RESERVATION_VIEW)) {
      return NextResponse.json({ error: "Forbidden: Insufficient permissions to view stock reservations" }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const search = searchParams.get("search") || undefined;
    const status = searchParams.get("status") || undefined;
    const warehouseId = searchParams.get("warehouseId") || undefined;
    const salesOrderId = searchParams.get("salesOrderId") || undefined;
    const page = parseInt(searchParams.get("page") || "1", 10);
    const limit = parseInt(searchParams.get("limit") || "20", 10);

    const result = await getReservations({
      search,
      status,
      warehouseId,
      salesOrderId,
      page,
      limit,
    });

    return NextResponse.json(result);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to fetch stock reservations" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    const user = session ? mapSessionToAppUser(session) : null;
    const role = user?.role || "VIEWER";

    if (!hasPermission(role, BuildStockPermissions.RESERVATION_CREATE)) {
      return NextResponse.json({ error: "Forbidden: Insufficient permissions to create stock reservation" }, { status: 403 });
    }

    const body = await req.json();
    const { salesOrderId } = body;

    if (!salesOrderId) {
      return NextResponse.json({ error: "salesOrderId is required" }, { status: 400 });
    }

    const reservation = await createStockReservation(salesOrderId, user?.id || "system");
    return NextResponse.json(reservation, { status: 201 });
  } catch (error: any) {
    const status = error.message?.includes("Insufficient available stock") || error.message?.includes("already has an active reservation") || error.message?.includes("Only APPROVED") ? 400 : 500;
    return NextResponse.json({ error: error.message || "Failed to create stock reservation" }, { status });
  }
}
