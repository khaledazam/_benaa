import { handleCorsPreflight } from "@/lib/api/cors";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/prisma/client";
import { inventoryRouteAccess, canAccessInventoryWarehouse, isInventoryAdmin } from "@/lib/auth/inventory-route-access";
import { applyTransferOperation, TransferError } from "@/lib/inventory/transferLifecycle";
import { applyProjectOperation, ProjectIssueError } from "@/lib/projects/projectMaterialIssueService";
import { scheduleInvalidateStockAllocationCaches } from "@/lib/cache/post-mutation";

const headers = { "Cache-Control": "no-store" };
const reply = (body: any, status = 200) => NextResponse.json(body, { status, headers });
export async function OPTIONS(request: NextRequest) { return handleCorsPreflight(request); }

async function pull(request: NextRequest, warehouseId?: unknown, afterAllocationId?: unknown) {
  const actor = await inventoryRouteAccess(request, "STOCK_VIEW");
  if (actor instanceof NextResponse) return actor;
  const requested = warehouseId || new URL(request.url).searchParams.get("warehouseId");
  if (requested && (typeof requested !== "string" || !canAccessInventoryWarehouse(actor, requested))) return reply({ success: false, error: "Forbidden warehouse" }, 403);
  const ids = [...new Set([actor.primaryWarehouseId, ...(actor.warehouseIds || [])].filter(Boolean))] as string[];
  const where: any = requested ? { warehouseId: requested } : isInventoryAdmin(actor) ? {} : { warehouseId: { in: ids } };
  const cursor = afterAllocationId ?? new URL(request.url).searchParams.get("afterAllocationId");
  if (cursor != null && (typeof cursor !== "string" || !/^[a-f0-9]{24}$/i.test(cursor))) return reply({ success: false, error: "Invalid allocation cursor" }, 422);
  const pageSize = 500;
  const page = await prisma.stockAllocation.findMany({ where: { ...where, ...(cursor ? { id: { gt: cursor } } : {}) }, orderBy: { id: "asc" }, take: pageSize + 1 });
  const hasMore = page.length > pageSize;
  const allocations = page.slice(0, pageSize);
  const nextCursor = hasMore ? allocations[allocations.length - 1]!.id : null;
  const [products, warehouses] = await Promise.all([
    prisma.product.findMany({ where: { id: { in: allocations.map(a => a.productId) } }, select: { id: true, name: true, sku: true, barcode: true, unitId: true } }),
    prisma.warehouse.findMany({ where: { id: { in: allocations.map(a => a.warehouseId) } }, select: { id: true, name: true } }),
  ]);
  const productMap = new Map(products.map(p => [p.id, p]));
  const warehouseMap = new Map(warehouses.map(w => [w.id, w]));
  // This contract intentionally has no financial fields. Base stock is authoritative per warehouse.
  return reply({ success: true, action: "pull_items", count: allocations.length, truncated: hasMore, hasMore, nextCursor,
    items: allocations.filter(a => productMap.has(a.productId) && warehouseMap.has(a.warehouseId)).map(a => ({ id: a.productId, productId: a.productId, warehouseId: a.warehouseId,
      code: productMap.get(a.productId)!.sku || productMap.get(a.productId)!.barcode || a.productId, name: productMap.get(a.productId)!.name, currentStock: a.quantity,
      reservedStock: a.reservedQuantity, unitId: productMap.get(a.productId)!.unitId, location: warehouseMap.get(a.warehouseId)!.name })) });
}
export async function GET(request: NextRequest) {
  try { return await pull(request); } catch { return reply({ success: false, error: "Inventory pull unavailable; retain local queue" }, 503); }
}
export async function POST(request: NextRequest) {
  try {
    const actor = await inventoryRouteAccess(request, "STOCK_VIEW");
    if (actor instanceof NextResponse) return actor;
    let body: any;
    try { body = await request.json(); } catch { return reply({ success: false, error: "Invalid JSON" }, 400); }
    if (body.action === "pull_items") return await pull(request, body.warehouseId, body.afterAllocationId);
    if (["sync_items", "full_sync", "record_movement"].includes(body.action)) return reply({ success: false, error: "Snapshot synchronization is disabled. Retain queued records and submit a supported sync_operation with a stable operationId.", code: "OPERATION_CONTRACT_REQUIRED" }, 409);
    if (["sync_user", "register_user"].includes(body.action)) return reply({ success: false, error: "Use the authorized admin employee provisioning endpoint", code: "USE_ADMIN_EMPLOYEES" }, 410);
    if (body.action !== "sync_operation" || !["TRANSFER_LIFECYCLE", "MATERIAL_ISSUE_LIFECYCLE"].includes(body.operationType)) return reply({ success: false, error: "Unsupported offline operation; retain it for operator review" }, 422);
    if (typeof body.operationId !== "string" || !/^[a-zA-Z0-9:_-]{1,128}$/.test(body.operationId)) return reply({ success: false, error: "A stable operationId is required" }, 422);
    if (body.actorId !== actor.id || typeof body.warehouseId !== "string" || !canAccessInventoryWarehouse(actor, body.warehouseId)) return reply({ success: false, error: "Operation actor or warehouse does not match current authorization" }, 403);
    const payload = body.payload;
    if (body.operationType === "MATERIAL_ISSUE_LIFECYCLE") {
      if (!payload || !["CREATE", "REQUEST", "APPROVE", "REJECT", "RESERVE", "DISPATCH", "COMPLETE", "CANCEL", "RELEASE", "RETURN"].includes(payload.action)) return reply({ success: false, error: "Unsupported material issue operation" }, 422);
      if (payload.action === "CREATE") {
        if (payload.warehouseId !== body.warehouseId) return reply({ success: false, error: "Operation warehouse does not match material issue" }, 403);
      } else {
        if (typeof payload.issueId !== "string" || !/^[a-f0-9]{24}$/i.test(payload.issueId)) return reply({ success: false, error: "Invalid material issue ID" }, 422);
        const issue = await prisma.projectMaterialIssue.findUnique({ where: { id: payload.issueId } });
        if (!issue) return reply({ success: false, error: "Material issue not found" }, 404);
        if (issue.warehouseId !== body.warehouseId) return reply({ success: false, error: "Operation warehouse does not match material issue" }, 403);
      }
      const result = await applyProjectOperation(prisma, actor, payload, body.operationId);
      await scheduleInvalidateStockAllocationCaches();
      return reply({ ...result, operationId: body.operationId });
    }
    if (!payload || !["REQUEST", "APPROVE", "DISPATCH", "RECEIVE", "CANCEL"].includes(payload.action)) return reply({ success: false, error: "Unsupported transfer operation" }, 422);
    if (payload.action === "REQUEST") {
      if (![payload.fromWarehouseId, payload.toWarehouseId].includes(body.warehouseId)) return reply({ success: false, error: "Operation warehouse does not match transfer" }, 403);
    } else {
      if (typeof payload.transferId !== "string" || !/^[a-f0-9]{24}$/i.test(payload.transferId)) return reply({ success: false, error: "Invalid transfer ID" }, 422);
      const transfer = await prisma.stockTransfer.findUnique({ where: { id: payload.transferId } });
      if (!transfer) return reply({ success: false, error: "Transfer not found" }, 404);
      const scope = payload.action === "RECEIVE" ? [transfer.toWarehouseId] : payload.action === "CANCEL" ? [transfer.fromWarehouseId, transfer.toWarehouseId] : [transfer.fromWarehouseId];
      if (!scope.includes(body.warehouseId)) return reply({ success: false, error: "Operation warehouse does not match transfer action" }, 403);
    }
    const result = await applyTransferOperation(prisma, actor, payload, body.operationId);
    await scheduleInvalidateStockAllocationCaches();
    return reply({ success: true, operationId: body.operationId, ...result });
  } catch (error: any) {
    return reply({ success: false, error: (error instanceof TransferError || error instanceof ProjectIssueError) ? error.message : "Synchronization unavailable; retain queued operation" }, (error instanceof TransferError || error instanceof ProjectIssueError) ? error.status : 503);
  }
}
