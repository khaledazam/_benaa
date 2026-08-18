import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/requireRole";
import { submitPurchaseOrder } from "@/lib/procurement/procurementService";
import { BuildStockPermissions } from "@/lib/auth/permissions";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(request, BuildStockPermissions.PURCHASE_ORDER_SUBMIT);
  if (auth instanceof NextResponse) return auth;

  try {
    const { id } = await params;
    const po = await submitPurchaseOrder(id);
    return NextResponse.json(po);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}