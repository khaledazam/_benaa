import { withWarehouseScope } from "@/lib/auth/warehouse-route-scope";
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/requireRole";
import { prisma } from "@/prisma/client";
import { postManualMovement, ManualMovementError } from "@/lib/inventory/manualMovement";
import { scheduleInvalidateStockAllocationCaches } from "@/lib/cache/post-mutation";
import { BuildStockPermissions } from "@/lib/auth/permissions";

/**
 * GET /api/stock-movements
 * Returns Stock Movement Ledger history with optional filters.
 */
async function scopedGET(request: NextRequest) {
  const auth = await requireAuth(request, BuildStockPermissions.STOCK_VIEW);
  if (auth instanceof NextResponse) return auth;

  try {
    const { searchParams } = new URL(request.url);
    const productId = searchParams.get("productId");
    const warehouseId = searchParams.get("warehouseId");
    const movementType = searchParams.get("movementType");
    const limit = Math.min(Number(searchParams.get("limit") || 100), 500);

    const where: any = {};
    if (productId) where.productId = productId;
    if (warehouseId) where.warehouseId = warehouseId;
    if (movementType) where.movementType = movementType;

    const movements = await prisma.stockMovement.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    return NextResponse.json(movements);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * POST /api/stock-movements
 * Executes a stock movement (OPENING_BALANCE, PURCHASE, DAMAGE, LOSS, ADJUSTMENT_IN, ADJUSTMENT_OUT, etc.)
 * through the central Stock Service.
 */
async function scopedPOST(request: NextRequest) {
  const auth = await requireAuth(request, BuildStockPermissions.STOCK_IN);
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json();
    const {
      productId,
      warehouseId,
      quantity,
      unitId,
      movementType,
      referenceType,
      referenceId,
      reason,
      approvedBy,
    } = body;

    if (!productId || !warehouseId || typeof quantity !== "number" || !movementType) {
      return NextResponse.json(
        { error: "Missing required fields: productId, warehouseId, quantity, movementType" },
        { status: 400 }
      );
    }

    // Require specific permissions for adjustments vs normal movements
    if (
      (movementType === "ADJUSTMENT_IN" || movementType === "ADJUSTMENT_OUT") &&
      auth.session.normalizedRole !== "SUPER_ADMIN" &&
      auth.session.normalizedRole !== "WAREHOUSE_MANAGER" &&
      auth.session.normalizedRole !== "INVENTORY_OFFICER"
    ) {
      return NextResponse.json(
        { error: "Forbidden: Stock adjustments require manager authorization" },
        { status: 403 }
      );
    }

    const result = await postManualMovement(prisma, auth.session.id, body, request.headers.get("idempotency-key"));
    scheduleInvalidateStockAllocationCaches();

    return NextResponse.json(result, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: error instanceof ManualMovementError ? error.status : 400 });
  }
}

export const GET = withWarehouseScope(scopedGET);
export const POST = withWarehouseScope(scopedPOST);
