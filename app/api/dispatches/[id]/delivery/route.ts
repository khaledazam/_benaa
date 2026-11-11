import { withWarehouseScope } from "@/lib/auth/warehouse-route-scope";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth-server";
import { mapSessionToAppUser } from "@/lib/auth/map-session-user";
import { hasPermission, BuildStockPermissions } from "@/lib/auth/permissions";
import { updateDeliveryStatus } from "@/lib/dispatch/dispatchService";
import { z } from "zod";

const deliverySchema = z.object({
  deliveryStatus: z.enum(["POSTED", "OUT_FOR_DELIVERY", "DELIVERED", "CANCELLED"]),
  driverName: z.string().optional(),
  driverPhone: z.string().optional(),
  vehicleNumber: z.string().optional(),
  deliveryAddress: z.string().optional(),
  routeNotes: z.string().optional(),
});

async function scopedPOST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const user = session ? mapSessionToAppUser(session) : null;
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const role = user.role || "VIEWER";

    if (!hasPermission(user, BuildStockPermissions.DISPATCH_POST)) {
      return NextResponse.json({ error: "Forbidden — DISPATCH_POST permission required" }, { status: 403 });
    }

    const { id } = await params;
    const body = await req.json();
    const parsed = deliverySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation error", details: parsed.error.format() }, { status: 400 });
    }

    const updated = await updateDeliveryStatus(
      id,
      parsed.data.deliveryStatus,
      {
        driverName: parsed.data.driverName,
        driverPhone: parsed.data.driverPhone,
        vehicleNumber: parsed.data.vehicleNumber,
        deliveryAddress: parsed.data.deliveryAddress,
        routeNotes: parsed.data.routeNotes,
      },
      user.id
    );

    return NextResponse.json(updated);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to update delivery status" }, { status: 400 });
  }
}

export const POST = withWarehouseScope(scopedPOST);
