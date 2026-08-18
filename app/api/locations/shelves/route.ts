import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/requireRole";
import { prisma } from "@/prisma/client";
import { createShelf } from "@/lib/locations/locationService";
import { BuildStockPermissions } from "@/lib/auth/permissions";

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request, BuildStockPermissions.LOCATION_VIEW);
  if (auth instanceof NextResponse) return auth;

  try {
    const { searchParams } = new URL(request.url);
    const rackId = searchParams.get("rackId");

    const where: any = { active: true };
    if (rackId) where.rackId = rackId;

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

export async function POST(request: NextRequest) {
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
