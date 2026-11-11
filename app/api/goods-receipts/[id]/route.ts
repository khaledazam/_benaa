import { withWarehouseScope } from "@/lib/auth/warehouse-route-scope";
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/requireRole";
import { prisma } from "@/prisma/client";
import { BuildStockPermissions } from "@/lib/auth/permissions";

async function scopedGET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(request, BuildStockPermissions.GOODS_RECEIPT_VIEW);
  if (auth instanceof NextResponse) return auth;

  try {
    const { id } = await params;
    const receipt = await prisma.goodsReceipt.findUnique({
      where: { id },
      include: {
        items: true,
        purchaseOrder: true,
      },
    });

    if (!receipt) {
      return NextResponse.json({ error: "Goods receipt not found" }, { status: 404 });
    }

    return NextResponse.json(receipt);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
export const GET = withWarehouseScope(scopedGET);
