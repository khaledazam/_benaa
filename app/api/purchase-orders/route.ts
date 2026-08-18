import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/requireRole";
import { prisma } from "@/prisma/client";
import { createPurchaseOrderSchema } from "@/lib/validations/procurement";
import { createPurchaseOrder } from "@/lib/procurement/procurementService";
import { BuildStockPermissions } from "@/lib/auth/permissions";

import { createCorsHeaders, handleCorsPreflight } from "@/lib/api/cors";

export async function GET(request: NextRequest) {
  const corsHeaders = createCorsHeaders(request);
  const auth = await requireAuth(request, BuildStockPermissions.PURCHASE_ORDER_VIEW);
  if (auth instanceof NextResponse) return auth;

  try {
    const { searchParams } = new URL(request.url);
    const supplierId = searchParams.get("supplierId");
    const warehouseId = searchParams.get("warehouseId");
    const status = searchParams.get("status");

    const where: any = {};
    if (supplierId) where.supplierId = supplierId;
    if (warehouseId) where.warehouseId = warehouseId;
    if (status) where.status = status;

    const purchaseOrders = await prisma.purchaseOrder.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        items: true,
      },
    });

    return NextResponse.json(purchaseOrders, { headers: corsHeaders });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500, headers: corsHeaders });
  }
}

export async function POST(request: NextRequest) {
  const corsHeaders = createCorsHeaders(request);
  const auth = await requireAuth(request, BuildStockPermissions.PURCHASE_ORDER_CREATE);
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json();
    const validated = createPurchaseOrderSchema.parse(body);

    const po = await createPurchaseOrder({
      ...validated,
      userId: auth.session.id,
    });

    return NextResponse.json(po, { status: 201, headers: corsHeaders });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400, headers: corsHeaders });
  }
}

export async function OPTIONS(request: NextRequest) {
  return handleCorsPreflight(request);
}
