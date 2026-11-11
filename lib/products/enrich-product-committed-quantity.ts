/**
 * REQ-0103 — display-only committed quantity for product lists.
 * DB fields stay disjoint; lists expose committedQuantity for badges/available.
 */

import { prisma } from "@/prisma/client";
import { withCommittedQuantity } from "./committed-quantity-display";
export { computeCommittedQuantity, withCommittedQuantity, getDisplayCommittedQuantity } from "./committed-quantity-display";
export type { ProductWithCommittedFields } from "./committed-quantity-display";
import { ACTIVE_SALES_RESERVATIONS, ACTIVE_PROJECT_ISSUES, salesReservationBaseQuantity, validReservedQuantity } from "@/lib/inventory/reservation-quantities";
import { addStock } from "@/lib/inventory/quantity";

/** Sum disjoint allocation, ERP sales, and project commitments in base units. Historical exported name is retained for server callers. */
export async function batchSumAllocationReserved(
  productIds: string[],
): Promise<Map<string, number>> {
  const sums = new Map<string, number>();
  if (productIds.length === 0) return sums;

  const [rows, sales, projects] = await Promise.all([
    prisma.stockAllocation.findMany({ where: { productId: { in: productIds } }, select: { productId: true, reservedQuantity: true } }),
    prisma.stockReservationItem.findMany({ where: { productId: { in: productIds }, reservation: { status: { in: ACTIVE_SALES_RESERVATIONS } } }, include: { product: { select: { id: true, unitId: true } } } }),
    prisma.projectMaterialIssueItem.findMany({ where: { productId: { in: productIds }, issue: { status: { in: ACTIVE_PROJECT_ISSUES } } }, select: { productId: true, remainingQuantity: true } }),
  ]);
  const add = (productId: string, quantity: number) => sums.set(productId, addStock(sums.get(productId) ?? 0, validReservedQuantity(quantity)));
  for (const row of rows) add(row.productId, row.reservedQuantity ?? 0);
  for (const item of sales) add(item.productId, await salesReservationBaseQuantity(prisma, item, item.product));
  for (const item of projects) add(item.productId, item.remainingQuantity);

  return sums;
}

/** Batch-enrich a product list response. */
export async function enrichProductsWithCommittedQuantity<
  T extends { id: string; reservedQuantity?: number | null },
>(products: T[]): Promise<Array<T & { committedQuantity: number }>> {
  const allocationSums = await batchSumAllocationReserved(
    products.map((p) => p.id),
  );
  return products.map((product) =>
    withCommittedQuantity(
      product,
      allocationSums.get(product.id) ?? 0,
    ),
  );
}

/** REQ-0105 — single product detail/API enrich (one allocation sum query). */
export async function enrichProductDetailWithCommittedQuantity<
  T extends { id: string; reservedQuantity?: number | null },
>(product: T): Promise<T & { committedQuantity: number }> {
  const allocationSums = await batchSumAllocationReserved([product.id]);
  return withCommittedQuantity(
    product,
    allocationSums.get(product.id) ?? 0,
  );
}

