import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/requireRole";
import { prisma } from "@/prisma/client";
import { createBin } from "@/lib/locations/locationService";
import { BuildStockPermissions } from "@/lib/auth/permissions";

export async function GET(request: NextRequest) {
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

export async function POST(request: NextRequest) {
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
