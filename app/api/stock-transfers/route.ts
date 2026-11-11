import { withWarehouseScope } from "@/lib/auth/warehouse-route-scope";
/**
 * BuildStock Stock Transfers API — integrated with StockMovement Ledger
 */

import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { logger } from "@/lib/logger";
import { createStockTransferSchema } from "@/lib/validations/stock-allocation";
import { withRateLimit, defaultRateLimits } from "@/lib/api/rate-limit";
import { executeStockTransfer } from "@/lib/inventory/stockService";
import { hasPermission, BuildStockPermissions } from "@/lib/auth/permissions";
import { scheduleInvalidateStockAllocationCaches } from "@/lib/cache";

async function scopedPOST(request: NextRequest) {
  try {
    const rateLimitResponse = await withRateLimit(
      request,
      defaultRateLimits.standard,
    );
    if (rateLimitResponse) return rateLimitResponse;

    const session = await getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const role = session.role || "VIEWER";
    if (!hasPermission(session, BuildStockPermissions.STOCK_TRANSFER)) {
      return NextResponse.json(
        { error: "Forbidden — STOCK_TRANSFER permission required" },
        { status: 403 }
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const validationResult = createStockTransferSchema.safeParse(body);
    if (!validationResult.success) {
      logger.warn("Invalid stock transfer request", {
        errors: validationResult.error.issues,
      });
      return NextResponse.json(
        { error: "Invalid request body", details: validationResult.error.issues },
        { status: 400 },
      );
    }

    const data = validationResult.data;

    if (data.fromWarehouseId === data.toWarehouseId) {
      return NextResponse.json(
        { error: "Source and destination warehouses must differ" },
        { status: 400 },
      );
    }

    const result = await executeStockTransfer({
      productId: data.productId,
      fromWarehouseId: data.fromWarehouseId,
      toWarehouseId: data.toWarehouseId,
      quantity: data.quantity,
      unitId: data.unitId,
      performedBy: session.id,
      notes: data.notes,
    });

    scheduleInvalidateStockAllocationCaches();

    return NextResponse.json(result.transferRecord, { status: 201 });
  } catch (error: any) {
    logger.error("Stock transfer error", { error: error.message });
    return NextResponse.json(
      { error: error.message || "Failed to execute stock transfer" },
      { status: 400 }
    );
  }
}

export const POST = withWarehouseScope(scopedPOST);
