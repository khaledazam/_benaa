import { ACTIVE_SALES_RESERVATIONS, ACTIVE_PROJECT_ISSUES, salesReservationBaseQuantity, validReservedQuantity } from "./reservation-quantities";
import { addStock } from "./quantity";

/** Existing allocation commitments (transfers/legacy orders) and ERP sales
 * commitments are disjoint. Sum both without rewriting historical documents. */
export async function getStockAvailabilityInTx(tx: any, productId: string, warehouseId: string) {
  const product = await tx.product.findUnique({ where: { id: productId } });
  if (!product) throw new Error("Product not found");
  const allocations = await tx.stockAllocation.findMany({ where: { productId } });
  const items = await tx.stockReservationItem.findMany({ where: { productId, reservation: { status: { in: ACTIVE_SALES_RESERVATIONS } } } });
  const projectItems = await tx.projectMaterialIssueItem.findMany({ where: { productId, issue: { status: { in: ACTIVE_PROJECT_ISSUES } } } });
  let salesReservedStock = 0, allSalesReserved = 0;
  for (const item of items) {
    const base = await salesReservationBaseQuantity(tx, item, { ...product, id: productId });
    allSalesReserved = addStock(allSalesReserved, base);
    if (item.warehouseId === warehouseId) salesReservedStock = addStock(salesReservedStock, base);
  }
  const local = allocations.filter((a: any) => a.warehouseId === warehouseId);
  const allProjectReserved = projectItems.reduce((sum: number, item: any) => addStock(sum, validReservedQuantity(item.remainingQuantity)), 0);
  const projectReservedStock = projectItems.filter((item: any) => item.warehouseId === warehouseId).reduce((sum: number, item: any) => addStock(sum, validReservedQuantity(item.remainingQuantity)), 0);
  const physicalStock = local.reduce((s: number, a: any) => addStock(s, a.quantity), 0);
  const transferReservedStock = local.reduce((s: number, a: any) => addStock(s, validReservedQuantity(a.reservedQuantity)), 0);
  const reservedStock = addStock(addStock(transferReservedStock, salesReservedStock), projectReservedStock);
  const allAllocationReserved = allocations.reduce((s: number, a: any) => addStock(s, validReservedQuantity(a.reservedQuantity)), 0);
  const globalAvailable = addStock(addStock(addStock(addStock(product.quantity, -validReservedQuantity(product.reservedQuantity || 0)), -allAllocationReserved), -allSalesReserved), -allProjectReserved);
  return { physicalStock, transferReservedStock, salesReservedStock, projectReservedStock, reservedStock,
    availableStock: Math.max(0, Math.min(addStock(physicalStock, -reservedStock), globalAvailable)),
    consistent: physicalStock >= reservedStock && globalAvailable >= -1e-9 };
}
