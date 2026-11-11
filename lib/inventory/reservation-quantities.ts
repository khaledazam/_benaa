import { convertUnitQuantity } from "@/lib/units/unitService";
import { stockUnits } from "./quantity";

export const ACTIVE_SALES_RESERVATIONS = ["ACTIVE", "PARTIALLY_FULFILLED"];
export const ACTIVE_PROJECT_ISSUES = ["RESERVED", "DISPATCHED"];

export function validReservedQuantity(value: number): number {
  stockUnits(value);
  if (value < 0) throw new Error("Invalid historical reservation requires reconciliation");
  return value;
}

/** The inventory engine and catalog projection use the same base-unit conversion. */
export async function salesReservationBaseQuantity(tx: any, item: any, product: any): Promise<number> {
  validReservedQuantity(item.remainingQuantity);
  if (item.remainingQuantity === 0) return 0;
  return validReservedQuantity(await convertUnitQuantity({
    quantity: item.remainingQuantity, fromUnitId: item.unitId || product.unitId,
    toUnitId: product.unitId, productId: item.productId || product.id,
  }, tx));
}
