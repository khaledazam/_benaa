import { withWarehouseScope } from "@/lib/auth/warehouse-route-scope";
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/requireRole";
import { prisma } from "@/prisma/client";
import { createGoodsReceiptSchema } from "@/lib/validations/procurement";
import { createGoodsReceiptDraft } from "@/lib/procurement/procurementService";
import { BuildStockPermissions } from "@/lib/auth/permissions";

async function scopedGET(request: NextRequest) {
  const auth = await requireAuth(request, BuildStockPermissions.GOODS_RECEIPT_VIEW);
  if (auth instanceof NextResponse) return auth;

  try {
    const { searchParams } = new URL(request.url);
    const purchaseOrderId = searchParams.get("purchaseOrderId");
    const warehouseId = searchParams.get("warehouseId");
    const supplierId = searchParams.get("supplierId");
    const status = searchParams.get("status");

    const where: any = {};
    if (purchaseOrderId) where.purchaseOrderId = purchaseOrderId;
    if (warehouseId) where.warehouseId = warehouseId;
    if (supplierId) where.supplierId = supplierId;
    if (status) where.status = status;

    const receipts = await prisma.goodsReceipt.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        items: true,
      },
    });

    return NextResponse.json(receipts);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

async function scopedPOST(request: NextRequest) {
  const auth = await requireAuth(request, BuildStockPermissions.GOODS_RECEIPT_CREATE);
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json();
    const validated = createGoodsReceiptSchema.parse(body);

    const draftReceipt = await createGoodsReceiptDraft({
      ...validated,
      userId: auth.session.id,
    });

    return NextResponse.json(draftReceipt, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}

export const GET = withWarehouseScope(scopedGET);
export const POST = withWarehouseScope(scopedPOST);
