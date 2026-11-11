import { withWarehouseScope } from "@/lib/auth/warehouse-route-scope";
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/requireRole";
import { prisma } from "@/prisma/client";
import { createRack } from "@/lib/locations/locationService";
import { BuildStockPermissions } from "@/lib/auth/permissions";

async function scopedGET(request: NextRequest) {
  const auth = await requireAuth(request, BuildStockPermissions.LOCATION_VIEW);
  if (auth instanceof NextResponse) return auth;

  try {
    const { searchParams } = new URL(request.url);
    const zoneId = searchParams.get("zoneId");
    const warehouseId = searchParams.get("warehouseId");

    const where: any = { active: true };
    if (zoneId) where.zoneId = zoneId;
    if (warehouseId) where.warehouseId = warehouseId;

    const racks = await prisma.warehouseRack.findMany({
      where,
      orderBy: { code: "asc" },
      include: { shelves: true },
    });

    return NextResponse.json(racks);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

async function scopedPOST(request: NextRequest) {
  const auth = await requireAuth(request, BuildStockPermissions.LOCATION_CREATE);
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json();
    const rack = await createRack(body);
    return NextResponse.json(rack, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}

export const GET = withWarehouseScope(scopedGET);
export const POST = withWarehouseScope(scopedPOST);
