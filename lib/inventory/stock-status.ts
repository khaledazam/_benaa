export const StockStatuses = {
  IN_STOCK: "IN_STOCK",
  LOW_STOCK: "LOW_STOCK",
  OUT_OF_STOCK: "OUT_OF_STOCK",
  OVERSTOCK: "OVERSTOCK",
} as const;

export type StockStatus = keyof typeof StockStatuses;

/**
 * Calculates stock status based on current quantity and product min/max thresholds.
 */
export function calculateStockStatus(
  currentQuantity: number,
  minimumStock: number = 0,
  maximumStock?: number | null
): StockStatus {
  if (currentQuantity <= 0) {
    return StockStatuses.OUT_OF_STOCK;
  }
  if (maximumStock != null && maximumStock > 0 && currentQuantity > maximumStock) {
    return StockStatuses.OVERSTOCK;
  }
  if (minimumStock > 0 && currentQuantity <= minimumStock) {
    return StockStatuses.LOW_STOCK;
  }
  return StockStatuses.IN_STOCK;
}

