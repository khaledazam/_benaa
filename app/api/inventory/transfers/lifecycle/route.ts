import { NextRequest, NextResponse } from "next/server";
import { applyTransferOperation, TransferError } from "@/lib/inventory/transferLifecycle";
import { prisma } from "@/prisma/client";
import { scheduleInvalidateStockAllocationCaches } from "@/lib/cache/post-mutation";
import { inventoryRouteAccess, canAccessInventoryWarehouse, isInventoryAdmin } from "@/lib/auth/inventory-route-access";

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
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
 * GET /api/inventory/transfers/lifecycle
 * List transfers with full lifecycle state, warehouse names, and audit history
 */
export async function GET(request: NextRequest) {
  try {
    const session = await inventoryRouteAccess(request, "STOCK_VIEW");
    if (session instanceof NextResponse) return session;
    const { searchParams } = new URL(request.url);
    const warehouseId = searchParams.get("warehouseId");
    const status = searchParams.get("status");

    const where: any = {};
    if (!isInventoryAdmin(session)) {
      const warehouseIds = [...new Set([session.primaryWarehouseId, ...(session.warehouseIds || [])].filter(Boolean))];
      where.AND = [{ OR: [{ fromWarehouseId: { in: warehouseIds } }, { toWarehouseId: { in: warehouseIds } }] }];
    }
    if (warehouseId) {
      where.OR = [{ fromWarehouseId: warehouseId }, { toWarehouseId: warehouseId }];
    }
    if (status) {
      where.status = status;
    }

    const [transfers, warehouses, products] = await Promise.all([
      prisma.stockTransfer.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
      prisma.warehouse.findMany({ select: { id: true, name: true, code: true } }),
      prisma.product.findMany({ select: { id: true, name: true, sku: true, price: true } }),
    ]);

    const whMap = new Map(warehouses.map((w) => [w.id, w]));
    const prodMap = new Map(products.map((p) => [p.id, p]));

    const formatted = transfers.map((t) => {
      const fromWh = whMap.get(t.fromWarehouseId);
      const toWh = whMap.get(t.toWarehouseId);
      const product = prodMap.get(t.productId);

      return {
        id: t.id,
        transferNumber: t.transferNumber || `TRF-${t.id.slice(-6)}`,
        productId: t.productId,
        productName: product ? product.name : "صنف بناء وديكور",
        productSku: product ? product.sku : "SKU-N/A",
        fromWarehouseId: t.fromWarehouseId,
        fromWarehouseName: fromWh ? fromWh.name : "مستودع المصدر",
        fromWarehouseCode: fromWh ? fromWh.code : null,
        toWarehouseId: t.toWarehouseId,
        toWarehouseName: toWh ? toWh.name : "مستودع الوجهة",
        toWarehouseCode: toWh ? toWh.code : null,
        quantity: t.quantity,
        receivedQuantity: t.receivedQuantity != null ? t.receivedQuantity : null,
        status: t.status, // REQUESTED, APPROVED, DISPATCHED, IN_TRANSIT, RECEIVED, COMPLETED, CANCELLED
        notes: t.notes,
        cancellationReason: t.cancellationReason,
        discrepancyNotes: t.discrepancyNotes,
        auditHistory: t.auditHistory || [],
        createdAt: t.createdAt.toISOString(),
        completedAt: t.completedAt ? t.completedAt.toISOString() : null,
      };
    });

    return NextResponse.json(
      {
        success: true,
        total: formatted.length,
        transfers: formatted,
      },
      { headers: corsHeaders() }
    );
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || "Failed to list transfers" },
      { status: 500, headers: corsHeaders() }
    );
  }
}

/**
 * POST /api/inventory/transfers/lifecycle
 * Execute lifecycle transition:
 * Actions: REQUEST | APPROVE | DISPATCH | RECEIVE | CANCEL
 */
export async function POST(request: NextRequest) {
  const response = await processLifecycle(request);
  if (response.ok) await scheduleInvalidateStockAllocationCaches();
  return response;
}

async function processLifecycle(request: NextRequest) {
  try {
    const session = await inventoryRouteAccess(request, "STOCK_TRANSFER");
    if (session instanceof NextResponse) return session;
    const body = await request.json();
    // Identity and authority always come from the verified, current session.
    body.userId = session.id;
    body.actorEmail = session.email;
    body.actorName = session.name;
    body.actorRole = session.role;
    const {
      action,
      transferId,
      productId,
      fromWarehouseId,
      toWarehouseId,
      quantity,
      receivedQuantity,
      userId,
      actorName = "مستخدم نظام بناء",
      actorRole = "STOREKEEPER",
      notes,
      reason,
    } = body;

    if (action === "REQUEST") {
      if (!canAccessInventoryWarehouse(session, fromWarehouseId) && !canAccessInventoryWarehouse(session, toWarehouseId)) {
        return NextResponse.json({ success: false, error: "Forbidden warehouse" }, { status: 403 });
      }
    } else if (transferId) {
      const scopedTransfer = await prisma.stockTransfer.findUnique({ where: { id: transferId } });
      if (!scopedTransfer) return NextResponse.json({ success: false, error: "Transfer not found" }, { status: 404 });
      const allowed = action === "RECEIVE"
        ? canAccessInventoryWarehouse(session, scopedTransfer.toWarehouseId)
        : action === "CANCEL"
          ? canAccessInventoryWarehouse(session, scopedTransfer.fromWarehouseId) || canAccessInventoryWarehouse(session, scopedTransfer.toWarehouseId)
          : canAccessInventoryWarehouse(session, scopedTransfer.fromWarehouseId);
      if (!allowed) return NextResponse.json({ success: false, error: "Forbidden warehouse" }, { status: 403 });
      if (action === "APPROVE" && !isInventoryAdmin(session) && session.role !== "WAREHOUSE_MANAGER") {
        return NextResponse.json({ success: false, error: "Transfer approval requires a warehouse manager" }, { status: 403 });
      }
    }

    const result = await applyTransferOperation(prisma, session, body, request.headers.get("Idempotency-Key"));
    return NextResponse.json(result, { status: body.action === "REQUEST" && !result.replayed ? 201 : 200, headers: corsHeaders() });
  } catch (error: any) {
    const isConflict = error instanceof TransferError
      ? error.status === 409
      : (error?.code === "P2034" || /writeconflict|concurrent/i.test(error?.message || ""));
    const status = error instanceof TransferError ? error.status : (isConflict ? 409 : 503);
    return NextResponse.json(
      { success: false, error: error instanceof TransferError ? error.message : (isConflict ? "Concurrent operation conflict" : "Transfer operation failed safely") },
      { status, headers: corsHeaders() }
    );
  }
}
