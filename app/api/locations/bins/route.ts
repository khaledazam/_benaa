import { withWarehouseScope } from "@/lib/auth/warehouse-route-scope";
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/requireRole";
import { prisma } from "@/prisma/client";
import { createBin } from "@/lib/locations/locationService";
import { BuildStockPermissions } from "@/lib/auth/permissions";

async function scopedGET(request: NextRequest) {
  const auth = await requireAuth(request, BuildStockPermissions.LOCATION_VIEW);
  if (auth instanceof NextResponse) return auth;

  try {
    const { searchParams } = new URL(request.url);
    const shelfId = searchParams.get("shelfId");
    const warehouseId = searchParams.get("warehouseId");

    const where: any = { active: true };
    if (shelfId) where.shelfId = shelfId;
    if (warehouseId) where.warehouseId = warehouseId;

    const bins = await prisma.warehouseBin.findMany({
      where,
      orderBy: { code: "asc" },
    });

    return NextResponse.json(bins);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

async function scopedPOST(request: NextRequest) {
  const auth = await requireAuth(request, BuildStockPermissions.LOCATION_CREATE);
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json();
    const bin = await createBin(body);
    return NextResponse.json(bin, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}

export const GET = withWarehouseScope(scopedGET);
export const POST = withWarehouseScope(scopedPOST);
