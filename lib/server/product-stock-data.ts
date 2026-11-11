/**
 * SSR stock allocations by product for product detail (REQ-0066).
 * Mirrors GET /api/stock-allocations?productId=xxx with shared enrich (REQ-0102).
 */
import { prisma } from "@/prisma/client";
import { getProductDetailForPage } from "@/lib/server/product-detail-data";
import type { SessionForDetail } from "@/lib/server/order-detail-data";
import {
  fetchStockAllocationProductMap,
  transformStockAllocationRow,
  enrichStockAllocationRows,
} from "@/lib/stock-allocation/stock-allocation-enrich";
import type { StockAllocation } from "@/types";
import { hasPermission, BuildStockRoles } from '@/lib/auth/permissions';

/** Per-warehouse allocations for a product the user can access. */
export async function getStockByProductForPage(
  session: SessionForDetail,
  productId: string,
): Promise<StockAllocation[] | null> {
  const product = await getProductDetailForPage(session, productId);
  if (!product) return null;
  if (!hasPermission(session, 'STOCK_VIEW')) return [];
  const internal = Object.values(BuildStockRoles).includes(session.role as any);
  const admin = session.role === 'SUPER_ADMIN' || session.role === 'admin';
  const allowed = [...new Set([session.primaryWarehouseId, ...(session.warehouseIds || [])].filter(Boolean))] as string[];
  if (internal && !admin && !allowed.length) return [];

  // Warehouses belong to the product owner (admin), not the viewing session (REQ-0075 AC1).
  const ownerUserId = product.userId;

  const allocations = await prisma.stockAllocation.findMany({
    where: { productId, ...(internal && !admin ? { warehouseId: { in: allowed } } : {}) },
    orderBy: { quantity: "desc" },
  });

  if (allocations.length === 0) return [];

  const warehouseIds = [...new Set(allocations.map((a) => a.warehouseId))];

  const [productMap, warehouses] = await Promise.all([
    fetchStockAllocationProductMap([productId]),
    prisma.warehouse.findMany({
      where: { id: { in: warehouseIds }, ...(!internal && !admin ? { userId: ownerUserId } : {}) },
      select: { id: true, name: true, status: true, address: true, type: true },
    }),
  ]);

  const warehouseMap = new Map(
    warehouses.map((w) => [
      w.id,
      {
        name: w.name,
        status: Boolean(w.status),
        address: w.address ?? null,
        type: w.type ?? null,
      },
    ]),
  );

  const rows = allocations
    .filter((a) => warehouseMap.has(a.warehouseId))
    .map((a) => transformStockAllocationRow(a, productMap, warehouseMap));

  return enrichStockAllocationRows(rows);
}
