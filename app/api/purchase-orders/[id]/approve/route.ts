import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/requireRole";
import { approvePurchaseOrder } from "@/lib/procurement/procurementService";
import { BuildStockPermissions } from "@/lib/auth/permissions";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(request, BuildStockPermissions.PURCHASE_ORDER_APPROVE);
  if (auth instanceof NextResponse) return auth;

  try {
    const { id } = await params;
    const po = await approvePurchaseOrder(id, auth.session.id);
    return NextResponse.json(po);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}