import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/requireRole";
import { prisma } from "@/prisma/client";
import { seedDefaultUnits } from "@/lib/units/unitService";
import { BuildStockPermissions } from "@/lib/auth/permissions";

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request, BuildStockPermissions.UNIT_VIEW);
  if (auth instanceof NextResponse) return auth;

  try {
    await seedDefaultUnits();
    const units = await prisma.unit.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
    });
    return NextResponse.json(units);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request, BuildStockPermissions.UNIT_CREATE);
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json();
    const { name, code, symbol, type, isBaseUnit } = body;

    if (!name || !code || !symbol || !type) {
      return NextResponse.json(
        { error: "Missing required fields: name, code, symbol, type" },
        { status: 400 }
      );
    }

    const existing = await prisma.unit.findUnique({ where: { code: code.toUpperCase() } });
    if (existing) {
      return NextResponse.json({ error: "Unit with this code already exists" }, { status: 409 });
    }

    const unit = await prisma.unit.create({
      data: {
        name,
        code: code.toUpperCase(),
        symbol,
        type,
        isBaseUnit: !!isBaseUnit,
        active: true,
      },
    });

    return NextResponse.json(unit, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
