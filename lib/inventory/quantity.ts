// Explicit base-stock precision, independent of monetary/tax policies. Reject
// unsupported input instead of silently rounding only one side of a movement.
export const STOCK_SCALE = 1_000_000;
export function stockUnits(quantity: number): number {
  const units = Math.round(quantity * STOCK_SCALE);
  if (!Number.isFinite(quantity) || !Number.isSafeInteger(units) || units / STOCK_SCALE !== quantity) {
    throw new Error("Stock quantity must have at most six decimal places within the supported range");
  }
  return units;
}
export function addStock(left: number, right: number): number {
  const units = stockUnits(left) + stockUnits(right);
  if (!Number.isSafeInteger(units)) throw new Error("Stock total exceeds supported range");
  return units / STOCK_SCALE;
}
