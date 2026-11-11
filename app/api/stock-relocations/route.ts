import { withWarehouseScope } from "@/lib/auth/warehouse-route-scope";
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/requireRole";
import { executeStockRelocation } from "@/lib/inventory/stockService";
import { BuildStockPermissions } from "@/lib/auth/permissions";
import { z } from "zod";

const relocateSchema = z.object({
  productId: z.string().min(1, "Product is required"),
  warehouseId: z.string().min(1, "Warehouse is required"),
  fromBinId: z.string().min(1, "Source bin is required"),
  toBinId: z.string().min(1, "Destination bin is required"),
  quantity: z.number().positive("Relocation quantity must be greater than 0"),
  unitId: z.string().optional().or(z.null()),
  reason: z.string().optional().or(z.null()),
});

async function scopedPOST(request: NextRequest) {
  const auth = await requireAuth(request, BuildStockPermissions.STOCK_RELOCATE);
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json();
    const validated = relocateSchema.parse(body);

    const result = await executeStockRelocation({
      ...validated,
      performedBy: auth.session.id,
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}

export const POST = withWarehouseScope(scopedPOST);
