import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/prisma/client";
import { getStockAvailabilityInTx } from "@/lib/inventory/availability";
import { inventoryRouteAccess, canAccessInventoryWarehouse } from "@/lib/auth/inventory-route-access";

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
  };
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(),
  });
}

/**
 * GET /api/inventory/cross-warehouse
 * Checks stock of a product across ALL warehouses in BENAA
 * Query params:
 *   - sku or productId (required)
 *   - currentWarehouseId (optional, current warehouse viewing the product)
 */
export async function GET(request: NextRequest) {
  try {
    const session = await inventoryRouteAccess(request, "STOCK_VIEW");
    if (session instanceof NextResponse) return session;
    const { searchParams } = new URL(request.url);
    const sku = searchParams.get("sku");
    const productIdParam = searchParams.get("productId");
    const currentWarehouseId = searchParams.get("currentWarehouseId");
    if (currentWarehouseId && !canAccessInventoryWarehouse(session, currentWarehouseId)) {
      return NextResponse.json({ success: false, error: "Forbidden warehouse" }, { status: 403 });
    }

    if (!sku && !productIdParam) {
      return NextResponse.json(
        { success: false, error: "sku or productId query param is required" },
        { status: 400, headers: corsHeaders() }
      );
    }

    // 1. Find product in centralized catalog
    const product = await prisma.product.findFirst({
      where: productIdParam
        ? { id: productIdParam }
        : { OR: [{ sku: sku! }, { barcode: sku! }] },
    });

    if (!product) {
      return NextResponse.json(
        { success: false, error: "Product not found in central catalog" },
        { status: 404, headers: corsHeaders() }
      );
    }

    // 2. Fetch all warehouses in BENAA
    const warehouses = await prisma.warehouse.findMany({
      where: { status: true },
      select: { id: true, name: true, code: true },
    });

    // 3. Fetch all stock allocations for this product
    const allocations = await prisma.stockAllocation.findMany({
      where: { productId: product.id },
    });
    const allocMap = new Map(allocations.map((a) => [a.warehouseId, a]));

    // 4. Build per-warehouse stock breakdown
    let currentWhStock = 0;
    let currentWhReserved = 0;
    let currentWhAvailable = 0;
    let totalCompanyStock = 0;
    const warehouseBreakdown: any[] = [];
    const otherWarehousesWithStock: any[] = [];

    for (const wh of warehouses) {
      const alloc = allocMap.get(wh.id);
      const totalQty = alloc ? alloc.quantity : 0;
      const authoritative = await getStockAvailabilityInTx(prisma, product.id, wh.id);
      const reservedQty = authoritative.reservedStock;
      const availableQty = authoritative.availableStock;

      totalCompanyStock += availableQty;

      const isCurrent = currentWarehouseId ? wh.id === currentWarehouseId : false;
      if (isCurrent) {
        currentWhStock = totalQty;
        currentWhReserved = reservedQty;
        currentWhAvailable = availableQty;
      } else if (availableQty > 0) {
        otherWarehousesWithStock.push({
          warehouseId: wh.id,
          warehouseName: wh.name,
          warehouseCode: wh.code,
          availableStock: availableQty,
          totalStock: totalQty,
          reservedStock: reservedQty,
        });
      }

      warehouseBreakdown.push({
        warehouseId: wh.id,
        warehouseName: wh.name,
        warehouseCode: wh.code,
        isCurrentWarehouse: isCurrent,
        totalStock: totalQty,
        reservedStock: reservedQty,
        availableStock: availableQty,
        status: availableQty <= 0 ? "OUT_OF_STOCK" : availableQty < 15 ? "LOW_STOCK" : "IN_STOCK",
      });
    }

    // 5. Generate Arabic prompt / display message
    let availabilityMessage = "";
    if (otherWarehousesWithStock.length > 0) {
      const bestSource = otherWarehousesWithStock[0];
      availabilityMessage = `متوفر في ${bestSource.warehouseName} — ${bestSource.availableStock} وحدة`;
    } else {
      availabilityMessage = "المنتج غير متوفر حالياً في أي من مستودعات الشركة";
    }

    return NextResponse.json(
      {
        success: true,
        product: {
          id: product.id,
          name: product.name,
          sku: product.sku,
          barcode: product.barcode,
          price: product.price,
          unit: "وحدة / متر",
        },
        currentWarehouseStock: {
          warehouseId: currentWarehouseId || null,
          totalStock: currentWhStock,
          reservedStock: currentWhReserved,
          availableStock: currentWhAvailable,
          isOutOfStock: currentWhAvailable <= 0,
        },
        currentWarehouse: {
          warehouseId: currentWarehouseId || null,
          stock: currentWhStock,
          reserved: currentWhReserved,
          available: Math.max(0, currentWhStock - currentWhReserved),
        },
        totalCompanyStock,
        availabilityMessage,
        discoveryMessage: availabilityMessage,
        hasOtherWarehouseStock: otherWarehousesWithStock.length > 0,
        otherWarehousesWithStock,
        otherWarehouses: otherWarehousesWithStock.map((w: any) => ({
          warehouseId: w.warehouseId,
          warehouseName: w.warehouseName,
          warehouseCode: w.warehouseCode,
          stock: w.totalStock,
          reserved: w.reservedStock,
          available: w.availableStock,
        })),
        bestMatch: otherWarehousesWithStock.length > 0 ? {
          warehouseId: otherWarehousesWithStock[0].warehouseId,
          warehouseName: otherWarehousesWithStock[0].warehouseName,
          warehouseCode: otherWarehousesWithStock[0].warehouseCode,
          available: otherWarehousesWithStock[0].availableStock,
        } : null,
        allWarehouses: warehouseBreakdown,
      },
      { headers: corsHeaders() }
    );
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || "Failed to query cross-warehouse stock" },
      { status: 500, headers: corsHeaders() }
    );
  }
}
