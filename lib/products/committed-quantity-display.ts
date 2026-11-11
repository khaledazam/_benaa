/** Pure display helpers: safe to import from browser components. */
import { getReservedCommitment } from "@/lib/stock-allocation/catalog-quantity-reconcile";

export function computeCommittedQuantity(productReserved: number, otherReserved: number): number {
  return getReservedCommitment(productReserved, [{ id: "sum", quantity: 0, reservedQuantity: otherReserved }]);
}

export type ProductWithCommittedFields = { reservedQuantity?: number | null; committedQuantity?: number };

export function withCommittedQuantity<T extends { id: string; reservedQuantity?: number | null }>(
  product: T, otherReserved: number,
): T & { committedQuantity: number } {
  return { ...product, committedQuantity: computeCommittedQuantity(Number(product.reservedQuantity ?? 0), otherReserved) };
}

export function getDisplayCommittedQuantity(product: ProductWithCommittedFields): number {
  return product.committedQuantity ?? Number(product.reservedQuantity ?? 0);
}
