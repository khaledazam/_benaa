/** Independent read-only reconciliation. Fixture openings are identified explicitly,
 * never silently substituted for missing opening ledger records. No cross-unit sum. */
export async function reconcileSyntheticSnapshot(db: any, catalog: any[], products: Record<string, any>, openingWarehouse: string) {
  const incoming = new Set(["OPENING_BALANCE", "PURCHASE", "TRANSFER_IN", "PROJECT_RETURN", "CUSTOMER_RETURN", "ADJUSTMENT_IN"]);
  const outgoing = new Set(["SALE", "TRANSFER_OUT", "PROJECT_ISSUE", "SUPPLIER_RETURN", "DAMAGE", "LOSS", "ADJUSTMENT_OUT"]);
  const rows: any[] = [], defects: string[] = [];
  for (const fixture of catalog) {
    const product = await db.product.findUniqueOrThrow({ where: { id: products[fixture.sku].id } });
    const [allocations, movements, bins, batches, transfers, issues, reservations] = await Promise.all([
      db.stockAllocation.findMany({ where: { productId: product.id } }),
      db.stockMovement.findMany({ where: { productId: product.id } }),
      db.stockLocationAllocation.findMany({ where: { productId: product.id } }),
      db.inventoryBatch.findMany({ where: { productId: product.id } }),
      db.stockTransfer.findMany({ where: { productId: product.id } }),
      db.projectMaterialIssueItem.findMany({ where: { productId: product.id }, include: { issue: true } }),
      db.stockReservationItem.findMany({ where: { productId: product.id, reservation: { status: { in: ["ACTIVE", "PARTIALLY_FULFILLED"] } } } }),
    ]);
    const qty = (list: any[], field = "quantity") => list.reduce((total, row) => total + Number(row[field] ?? 0), 0);
    const signed = (list: any[]) => list.reduce((sum, movement) => sum + (incoming.has(movement.movementType) ? 1 : outgoing.has(movement.movementType) ? -1 : 0) * Number(movement.quantityInBaseUnit ?? movement.quantity), 0);
    const equal = (left: number, right: number) => Math.abs(left - right) < 0.0000005;
    if (!product.unitId) defects.push(`${fixture.sku}: no persisted canonical base unit (fixture label ${fixture.unit} only)`);
    if (!movements.some((m: any) => m.movementType === "OPENING_BALANCE")) defects.push(`${fixture.sku}: opening stock absent from movement ledger`);
    if (!equal(product.quantity, qty(allocations))) defects.push(`${fixture.sku}: product/allocation mismatch`);
    const custody = issues.reduce((sum: number, line: any) => sum + line.dispatchedQuantity - line.returnedQuantity, 0);
    const transit = qty(transfers, "inTransitQuantity");
    const expectedWithCustodyAndTransit = fixture.opening + signed(movements) + custody + transit;
    if (!equal(qty(allocations) + custody + transit, expectedWithCustodyAndTransit)) defects.push(`${fixture.sku}: conservation mismatch`);
    for (const allocation of allocations) {
      const local = (list: any[]) => list.filter(row => row.warehouseId === allocation.warehouseId);
      const localBins = qty(local(bins)), localBatches = qty(local(batches));
      const salesReserved = qty(local(reservations), "remainingQuantity");
      const projectReserved = qty(local(issues).filter((line: any) => ["RESERVED", "DISPATCHED"].includes(line.issue.status)), "remainingQuantity");
      const reserved = allocation.reservedQuantity + salesReserved + projectReserved;
      const opening = allocation.warehouseId === openingWarehouse ? fixture.opening : 0;
      const ledger = signed(local(movements));
      if (allocation.quantity < 0 || reserved < 0 || reserved > allocation.quantity) defects.push(`${fixture.sku}/${allocation.warehouseId}: invalid stock/reservation`);
      if (!equal(localBins, allocation.quantity)) defects.push(`${fixture.sku}/${allocation.warehouseId}: bin mismatch`);
      if (product.trackingMode !== "NONE" && !equal(localBatches, allocation.quantity)) defects.push(`${fixture.sku}/${allocation.warehouseId}: tracked batch mismatch`);
      if (!equal(opening + ledger, allocation.quantity)) defects.push(`${fixture.sku}/${allocation.warehouseId}: fixture opening plus movement mismatch`);
      rows.push({ sku: fixture.sku, productId: product.id, baseUnitId: product.unitId, fixtureUnitLabel: fixture.unit,
        warehouseId: allocation.warehouseId, physical: allocation.quantity, binTotal: localBins,
        trackingMode: product.trackingMode, batchTotal: localBatches, reserved, salesReserved, projectReserved,
        allocationReserved: allocation.reservedQuantity, available: allocation.quantity - reserved,
        explicitFixtureOpening: opening, persistedLedgerBalance: ledger, physicalWithFixtureOpening: opening + ledger,
        bins: local(bins).map(row => ({ binId: row.binId, quantity: row.quantity })),
        batches: local(batches).map(row => ({ batchId: row.id, quantity: row.quantity, reserved: row.reservedQuantity })),
      });
    }
    rows.push({ sku: fixture.sku, kind: "custody-and-transit", physical: qty(allocations), transit, custody });
  }
  return { status: defects.length ? "FAILED" : "VERIFIED", method: "Per product and warehouse; fixture openings distinguished from persisted ledger", rows, defects };
}
