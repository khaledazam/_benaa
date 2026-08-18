import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/requireRole";
import { postGoodsReceipt } from "@/lib/procurement/procurementService";
import { BuildStockPermissions } from "@/lib/auth/permissions";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(request, BuildStockPermissions.GOODS_RECEIPT_POST);
  if (auth instanceof NextResponse) return auth;

  try {
    const { id } = await params;
    const result = await postGoodsReceipt(id, auth.session.id);
    return NextResponse.json(result);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}