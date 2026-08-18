/**
 * BUILDSTOCK — SEED VALIDATION AUDIT SCRIPT
 * Audits all Master Stock Invariants, barcode uniqueness, SKU uniqueness,
 * data integrity, and WMS health report post-seeding.
 */

import "dotenv/config";
import { prisma } from "../prisma/client";
import { getInventoryHealthReport } from "../lib/inventory/healthService";

async function main() {
  console.log("\n==================================================");
  console.log("  BUILDSTOCK — REALISTIC SEED VALIDATION AUDIT   ");
  console.log("==================================================\n");

  let passCount = 0;
  let warningCount = 0;
  let failCount = 0;

  function assert(condition: boolean, passMsg: string, failMsg: string, isWarning = false) {
    if (condition) {
      console.log(`  [PASS] ${passMsg}`);
      passCount++;
    } else {
      if (isWarning) {
        console.log(`  [WARN] ${failMsg}`);
        warningCount++;
      } else {
        console.log(`  [FAIL] ${failMsg}`);
        failCount++;
      }
    }
  }

  // 1. Entity Count Audits
  const [
    users,
    warehouses,
    zones,
    racks,
    shelves,
    bins,
    categories,
    brands,
    products,
    suppliers,
    pos,
    grns,
    customers,
    sos,
    reservations,
    pickLists,
    dispatches,
    batches,
    counts,
    adjustments,
    movements,
    auditLogs,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.warehouse.count(),
    prisma.warehouseZone.count(),
    prisma.warehouseRack.count(),
    prisma.warehouseShelf.count(),
    prisma.warehouseBin.count(),
    prisma.category.count(),
    prisma.brand.count(),
    prisma.product.count(),
    prisma.supplier.count(),
    prisma.purchaseOrder.count(),
    prisma.goodsReceipt.count(),
    prisma.customer.count(),
    prisma.salesOrder.count(),
    prisma.stockReservation.count(),
    prisma.pickList.count(),
    prisma.dispatch.count(),
    prisma.inventoryBatch.count(),
    prisma.inventoryCount.count(),
    prisma.stockAdjustment.count(),
    prisma.stockMovement.count(),
    prisma.auditLog.count(),
  ]);

  console.log("--- SEED ENTITY SUMMARY ---");
  console.log(`  Users:               ${users}`);
  console.log(`  Warehouses:          ${warehouses}`);
  console.log(`  Zones:               ${zones}`);
  console.log(`  Racks:               ${racks}`);
  console.log(`  Shelves:             ${shelves}`);
  console.log(`  Bins:                ${bins}`);
  console.log(`  Categories:          ${categories}`);
  console.log(`  Brands:              ${brands}`);
  console.log(`  Products:            ${products}`);
  console.log(`  Suppliers:           ${suppliers}`);
  console.log(`  Purchase Orders:     ${pos}`);
  console.log(`  Goods Receipts:      ${grns}`);
  console.log(`  Customers:           ${customers}`);
  console.log(`  Sales Orders:        ${sos}`);
  console.log(`  Stock Reservations:  ${reservations}`);
  console.log(`  Pick Lists:          ${pickLists}`);
  console.log(`  Dispatches:          ${dispatches}`);
  console.log(`  Batches:             ${batches}`);
  console.log(`  Inventory Counts:    ${counts}`);
  console.log(`  Stock Adjustments:   ${adjustments}`);
  console.log(`  Stock Movements:     ${movements}`);
  console.log(`  Audit Logs:          ${auditLogs}\n`);

  console.log("--- INVARIANT & TRACEABILITY CHECKS ---");

  // 2. Barcode & SKU Uniqueness
  const allProds = await prisma.product.findMany({ select: { barcode: true, sku: true } });
  const barcodes = allProds.map((p) => p.barcode).filter(Boolean);
  const skus = allProds.map((p) => p.sku).filter(Boolean);

  assert(
    new Set(barcodes).size === barcodes.length,
    `Barcode Uniqueness verified (${barcodes.length} unique barcodes).`,
    `Duplicate barcodes detected! Unique: ${new Set(barcodes).size}, Total: ${barcodes.length}`
  );

  assert(
    new Set(skus).size === skus.length,
    `SKU Uniqueness verified (${skus.length} unique SKUs).`,
    `Duplicate SKUs detected! Unique: ${new Set(skus).size}, Total: ${skus.length}`
  );

  // 3. Physical Stock & Batch Integrity
  const negStockAlloc = await prisma.stockAllocation.count({ where: { quantity: { lt: 0 } } });
  assert(negStockAlloc === 0, "Zero negative warehouse stock allocations verified.", `Found ${negStockAlloc} negative warehouse stock allocations.`);

  const negLocAlloc = await prisma.stockLocationAllocation.count({ where: { quantity: { lt: 0 } } });
  assert(negLocAlloc === 0, "Zero negative bin stock allocations verified.", `Found ${negLocAlloc} negative bin stock allocations.`);

  const negBatches = await prisma.inventoryBatch.count({ where: { quantity: { lt: 0 } } });
  assert(negBatches === 0, "Zero negative batch quantities verified.", `Found ${negBatches} negative batch quantities.`);

  // 4. Inactive Bin Stock Isolation
  const inactiveBinStock = await prisma.stockLocationAllocation.count({
    where: { quantity: { gt: 0 }, bin: { active: false } },
  });
  assert(inactiveBinStock === 0, "Zero stock in inactive bins verified.", `Found ${inactiveBinStock} positive stock allocations in inactive bins.`);

  // 5. WMS Health Monitoring Report Check
  const health = await getInventoryHealthReport();
  assert(
    health.summary.criticalIssuesCount === 0,
    `WMS Health Monitor clean — Score: ${health.healthScore}%, Status: ${health.status}, Critical Issues: ${health.summary.criticalIssuesCount}`,
    `WMS Health Monitor returned ${health.summary.criticalIssuesCount} CRITICAL issues!`
  );

  console.log("\n==================================================");
  if (failCount === 0) {
    console.log(`  VALIDATION RESULT: PASS (${passCount} passed, ${warningCount} warnings, 0 failures)`);
  } else {
    console.log(`  VALIDATION RESULT: FAIL (${passCount} passed, ${warningCount} warnings, ${failCount} failures)`);
  }
  console.log("==================================================\n");

  if (failCount > 0) process.exit(1);
}

main()
  .catch((err) => {
    console.error("❌ Validation Error:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
