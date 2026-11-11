import { withWarehouseScope } from "@/lib/auth/warehouse-route-scope";
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/requireRole";
import { prisma } from "@/prisma/client";
import { createShelf } from "@/lib/locations/locationService";
import { BuildStockPermissions } from "@/lib/auth/permissions";

async function scopedGET(request: NextRequest) {
  const auth = await requireAuth(request, BuildStockPermissions.LOCATION_VIEW);
  if (auth instanceof NextResponse) return auth;

  try {
    const { searchParams } = new URL(request.url);
    const rackId = searchParams.get("rackId");

    const where: any = { active: true };
    if (rackId) where.rackId = rackId;
    const warehouseId = searchParams.get("warehouseId");
    if (warehouseId) where.warehouseId = warehouseId;

    const shelves = await prisma.warehouseShelf.findMany({
      where,
      orderBy: { code: "asc" },
      include: { bins: true },
    });

    return NextResponse.json(shelves);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

async function scopedPOST(request: NextRequest) {
  const auth = await requireAuth(request, BuildStockPermissions.LOCATION_CREATE);
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json();
    const shelf = await createShelf(body);
    return NextResponse.json(shelf, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}

export const GET = withWarehouseScope(scopedGET);
export const POST = withWarehouseScope(scopedPOST);
