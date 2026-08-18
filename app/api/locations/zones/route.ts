import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/requireRole";
import { prisma } from "@/prisma/client";
import { createZone } from "@/lib/locations/locationService";
import { BuildStockPermissions } from "@/lib/auth/permissions";

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request, BuildStockPermissions.LOCATION_VIEW);
  if (auth instanceof NextResponse) return auth;

  try {
    const { searchParams } = new URL(request.url);
    const warehouseId = searchParams.get("warehouseId");

    const where: any = { active: true };
    if (warehouseId) where.warehouseId = warehouseId;

    const zones = await prisma.warehouseZone.findMany({
      where,
      orderBy: { code: "asc" },
      include: { racks: true },
    });

    return NextResponse.json(zones);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request, BuildStockPermissions.LOCATION_CREATE);
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json();
    const zone = await createZone(body);
    return NextResponse.json(zone, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
