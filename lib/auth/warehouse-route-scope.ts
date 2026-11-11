import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { hasPermission } from "./permissions";
import { prisma } from "@/prisma/client";
import { canAccessInventoryWarehouse, isInventoryAdmin } from "./inventory-route-access";

const models: Record<string, string> = { "dispatches": "dispatch", "reservations": "stockReservation", "pick-lists": "pickList", "sales-orders": "salesOrder", "purchase-orders": "purchaseOrder", "goods-receipts": "goodsReceipt", "stock-allocations": "stockAllocation", "stock-adjustments": "stockAdjustment", "inventory-counts": "inventoryCount", "warehouses": "warehouse" };
Object.assign(models, { adjustments: "stockAdjustment", counts: "inventoryCount", batches: "inventoryBatch", zones: "warehouseZone", racks: "warehouseRack", shelves: "warehouseShelf", bins: "warehouseBin" });
const references: Record<string, string> = { salesOrderId: "salesOrder", purchaseOrderId: "purchaseOrder", pickListId: "pickList", reservationId: "stockReservation", dispatchId: "dispatch", goodsReceiptId: "goodsReceipt", zoneId: "warehouseZone", rackId: "warehouseRack", shelfId: "warehouseShelf", binId: "warehouseBin", fromBinId: "warehouseBin", toBinId: "warehouseBin", sourceBinId: "warehouseBin", destinationBinId: "warehouseBin", batchId: "inventoryBatch" };
class ScopeError extends Error { constructor(message: string, public status: number) { super(message); } }
const objectId = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{24}$/i.test(value);

/** Route-local wrapper: authenticate current persisted assignments before invoking legacy handlers.
 * List handlers receive an explicit authorized warehouse; detail/body references are checked before mutation.
 */
export function withWarehouseScope<T extends (...args: any[]) => Promise<any>>(handler: T): T {
  return (async (request: NextRequest, context: any = {}) => {
    try {
      const actor = await getSessionFromRequest(request);
      if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      const admin = isInventoryAdmin(actor);
      const allowed = [...new Set([actor.primaryWarehouseId, ...(actor.warehouseIds || [])].filter(Boolean))] as string[];
      const assertWarehouse = (id: unknown) => {
        if (!objectId(id) || !canAccessInventoryWarehouse(actor, id)) throw new ScopeError("Forbidden warehouse", 403);
      };
      const assertReference = async (model: string, id: unknown) => {
        if (!objectId(id)) throw new ScopeError("Invalid resource ID", 400);
        const document = await (prisma as any)[model].findUnique({ where: { id } });
        if (!document) throw new ScopeError("Resource not found", 404);
        assertWarehouse(model === "warehouse" ? document.id : document.warehouseId);
        return document;
      };
      const url = new URL(request.url);
      const segments = url.pathname.split("/").filter(Boolean);
      const resource = ["inventory", "locations"].includes(segments[1] || "") ? (segments[2] || "") : (segments[1] || "");
      const params = await context.params;
      if (params?.id && models[resource]) await assertReference(models[resource], params.id);
      for (const [key, value] of url.searchParams) {
        if (key === "warehouseId") assertWarehouse(value);
        if (references[key] && value) await assertReference(references[key], value);
      }
      if (resource === "stock-allocations" && !["GET", "HEAD", "OPTIONS"].includes(request.method)) return NextResponse.json({ error: "Direct stock snapshots are disabled. Use an approved ledger-backed receipt, dispatch, transfer or adjustment.", code: "STOCK_OPERATION_REQUIRED" }, { status: 409 });
      if (resource === "stock-allocations" && !hasPermission(actor, "STOCK_VIEW")) throw new ScopeError("Forbidden", 403);
      if (resource === "warehouses" && request.method === "GET" && !hasPermission(actor, "WAREHOUSE_VIEW")) throw new ScopeError("Forbidden", 403);
      let body: any;
      if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
        try { body = await request.clone().json(); } catch { /* Handler owns optional/invalid JSON response. */ }
        const visit = async (value: any, depth = 0): Promise<void> => {
          if (depth > 8) throw new ScopeError("Nested request exceeds supported depth", 400);
          if (!value || typeof value !== "object") return;
          for (const [key, entry] of Object.entries(value)) {
            if (["warehouseId", "fromWarehouseId", "toWarehouseId"].includes(key) && entry != null) assertWarehouse(entry);
            if (references[key] && entry != null) await assertReference(references[key], entry);
            if (typeof entry === "object") await visit(entry, depth + 1);
          }
        };
        await visit(body);
        if (resource === "warehouses" && request.method === "POST" && !admin) throw new ScopeError("Warehouse creation requires administrator authorization", 403);
        if (resource === "warehouses" && !["GET", "HEAD"].includes(request.method) && !admin) throw new ScopeError("Warehouse administration requires administrator authorization", 403);
      }
      if (!admin && request.method === "GET" && !params?.id && resource !== "warehouses") {
        if (!allowed.length) throw new ScopeError("No warehouse assignment", 403);
        if (!url.searchParams.has("warehouseId")) url.searchParams.set("warehouseId", actor.primaryWarehouseId && allowed.includes(actor.primaryWarehouseId) ? actor.primaryWarehouseId : allowed[0]!);
        // Stock allocation legacy product/summary branches ignore warehouse filters; query safely here.
        if (resource === "stock-allocations") {
          const warehouseId = url.searchParams.get("warehouseId")!;
          if (url.searchParams.get("summary") === "true") {
            const allocations = await prisma.stockAllocation.findMany({ where: { warehouseId }, select: { quantity: true, reservedQuantity: true, productId: true } });
            const warehouse = await prisma.warehouse.findUnique({ where: { id: warehouseId }, select: { id: true, name: true, type: true } });
            const products = await prisma.product.findMany({ where: { id: { in: allocations.map(a => a.productId) } }, select: { id: true, price: true } });
            const prices = new Map(products.map(p => [p.id, p.price]));
            return NextResponse.json(warehouse ? [{ warehouseId, warehouseName: warehouse.name, warehouseType: warehouse.type, totalProducts: allocations.length, totalQuantity: allocations.reduce((sum, a) => sum + a.quantity, 0), totalReserved: allocations.reduce((sum, a) => sum + a.reservedQuantity, 0), totalValue: allocations.reduce((sum, a) => sum + a.quantity * (prices.get(a.productId) || 0), 0) }] : []);
          }
          const productId = url.searchParams.get("productId");
          const allocations = await prisma.stockAllocation.findMany({ where: { warehouseId, ...(productId ? { productId } : {}) } });
          const [products, warehouse] = await Promise.all([
            prisma.product.findMany({ where: { id: { in: allocations.map(a => a.productId) } }, select: { id: true, name: true, sku: true, imageUrl: true, price: true } }),
            prisma.warehouse.findUnique({ where: { id: warehouseId }, select: { id: true, name: true, status: true, address: true, type: true } }),
          ]);
          const productMap = new Map(products.map(p => [p.id, p]));
          return NextResponse.json(allocations.map(a => ({ ...a, product: productMap.get(a.productId), warehouse })));
        }
        request = new NextRequest(url, { headers: request.headers });
      }
      if (resource === "warehouses" && request.method === "GET" && !params?.id) {
        return NextResponse.json(await prisma.warehouse.findMany({ where: admin ? {} : { id: { in: allowed } } }));
      }
      return await handler(request, context);
    } catch (error) {
      if (error instanceof ScopeError) return NextResponse.json({ error: error.message }, { status: error.status });
      return NextResponse.json({ error: "Warehouse authorization unavailable" }, { status: 503 });
    }
  }) as T;
}
