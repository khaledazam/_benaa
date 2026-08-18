import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/requireRole";
import { prisma } from "@/prisma/client";
import { BuildStockPermissions } from "@/lib/auth/permissions";

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request, BuildStockPermissions.UNIT_VIEW);
  if (auth instanceof NextResponse) return auth;

  try {
    const { searchParams } = new URL(request.url);
    const productId = searchParams.get("productId");

    const conversions = await prisma.unitConversion.findMany({
      where: productId ? { OR: [{ productId }, { productId: null }] } : undefined,
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json(conversions);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request, BuildStockPermissions.UNIT_CREATE);
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json();
    const { fromUnitId, toUnitId, factor, productId } = body;

    if (!fromUnitId || !toUnitId || typeof factor !== "number" || factor <= 0) {
      return NextResponse.json(
        { error: "Invalid parameters: fromUnitId, toUnitId, and positive factor required" },
        { status: 400 }
      );
    }

    if (fromUnitId === toUnitId) {
      return NextResponse.json(
        { error: "Source unit and target unit must be different" },
        { status: 400 }
      );
    }

    const conversion = await prisma.unitConversion.create({
      data: {
        fromUnitId,
        toUnitId,
        factor,
        productId: productId || null,
      },
    });

    return NextResponse.json(conversion, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
