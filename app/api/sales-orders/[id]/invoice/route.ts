import { scheduleInvalidateInvoiceCaches } from "@/lib/cache/post-mutation";
import { NextRequest, NextResponse } from "next/server";
import { withWarehouseScope } from "@/lib/auth/warehouse-route-scope";
import { requireAuth } from "@/lib/auth/requireRole";
import { prisma } from "@/prisma/client";
import { invoiceSalesOrder } from "@/lib/sales/invoiceSalesOrder";

export const POST = withWarehouseScope(async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
  const auth = await requireAuth(request, "SALES_ORDER_APPROVE");
  if (auth instanceof NextResponse) return auth;
  try {
    const { id } = await context.params;
    const body = await request.json();
    const result = await invoiceSalesOrder(prisma, auth.session.id, id, body.dueDate, request.headers.get("Idempotency-Key"));
    await scheduleInvalidateInvoiceCaches();
    return NextResponse.json(result, { status: 201 });
  } catch (error: any) { return NextResponse.json({ error: error.message }, { status: error.status || 400 }); }
});
