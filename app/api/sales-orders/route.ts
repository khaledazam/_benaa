import { withWarehouseScope } from "@/lib/auth/warehouse-route-scope";
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/requireRole";
import { BuildStockPermissions } from "@/lib/auth/permissions";
import { getSalesOrders } from "@/lib/sales/salesOrderService";
import { createSalesOrderCommand } from "@/lib/sales/createSalesOrderCommand";
import { createCorsHeaders, handleCorsPreflight } from "@/lib/api/cors";

async function scopedGET(req: NextRequest) {
  const corsHeaders = createCorsHeaders(req);
  const auth = await requireAuth(req, BuildStockPermissions.SALES_ORDER_VIEW);
  if (auth instanceof NextResponse) return auth;

  try {
    const { searchParams } = new URL(req.url);
    const search = searchParams.get("search") || undefined;
    const customerId = searchParams.get("customerId") || undefined;
    const warehouseId = searchParams.get("warehouseId") || undefined;
    const status = searchParams.get("status") || undefined;
    const startDate = searchParams.get("startDate") || undefined;
    const endDate = searchParams.get("endDate") || undefined;
    const page = parseInt(searchParams.get("page") || "1", 10);
    const limit = parseInt(searchParams.get("limit") || "100", 10);

    const result = await getSalesOrders({
      search,
      customerId,
      warehouseId,
      status,
      startDate,
      endDate,
      page,
      limit,
    });

    return NextResponse.json(result, { headers: corsHeaders });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to fetch sales orders" }, { status: 500, headers: corsHeaders });
  }
}

async function scopedPOST(req: NextRequest) {
  const corsHeaders = createCorsHeaders(req);
  const auth = await requireAuth(req, BuildStockPermissions.SALES_ORDER_CREATE);
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await req.json();
    const salesOrder = await createSalesOrderCommand(body, auth.session.id, req.headers.get("Idempotency-Key"));
    return NextResponse.json(salesOrder, { status: 201, headers: corsHeaders });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to create sales order" }, { status: error.status || 400, headers: corsHeaders });
  }
}

export async function OPTIONS(request: NextRequest) {
  return handleCorsPreflight(request);
}

export const GET = withWarehouseScope(scopedGET);
export const POST = withWarehouseScope(scopedPOST);
