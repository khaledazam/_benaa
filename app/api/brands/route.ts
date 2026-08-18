import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/requireRole";
import { getOrCreateBrand, getAllBrands } from "@/lib/brands/brandService";
import { BuildStockPermissions } from "@/lib/auth/permissions";

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request, BuildStockPermissions.BRAND_VIEW);
  if (auth instanceof NextResponse) return auth;

  try {
    const brands = await getAllBrands();
    return NextResponse.json(brands);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request, BuildStockPermissions.BRAND_CREATE);
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json();
    const { name, description } = body;

    if (!name || typeof name !== "string") {
      return NextResponse.json({ error: "Brand name is required" }, { status: 400 });
    }

    const brand = await getOrCreateBrand(name, description);
    return NextResponse.json(brand, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
