import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/requireRole";
import { prisma } from "@/prisma/client";
import { executeStockMutation, StockMovementType } from "@/lib/inventory/stockService";
import { BuildStockPermissions } from "@/lib/auth/permissions";

/**
 * GET /api/stock-movements
 * Returns Stock Movement Ledger history with optional filters.
 */
export async function GET(request: NextRequest) {
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
export async function POST(request: NextRequest) {
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

    const result = await executeStockMutation({
      productId,
      warehouseId,
      quantity,
      unitId,
      movementType: movementType as StockMovementType,
      referenceType,
      referenceId,
      reason,
      performedBy: auth.session.id,
      approvedBy,
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
