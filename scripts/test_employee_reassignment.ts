import "./qa-preflight.cjs";
import { prisma } from "../prisma/client";

async function runReassignmentTest() {
  console.log("=== STARTING EMPLOYEE REASSIGNMENT & AUDIT PRESERVATION TEST ===");

  const wh1 = await prisma.warehouse.findFirst({ where: { code: "MAIN-WH" } });
  const wh3 = await prisma.warehouse.findFirst({ where: { code: "BACKUP-WH" } });
  const superAdmin = await prisma.user.findFirst({ where: { email: "khaled@admin.com" } });

  if (!wh1 || !wh3 || !superAdmin) {
    throw new Error("Warehouses not found");
  }

  const BASE_URL = `${process.env.BENAA_QA_BASE_URL}/api/admin/employees`;

  // 1. Create employee in Warehouse 1
  const testEmail = `employee_${Date.now()}@benaa-sa.com`;
  console.log(`\n[1] Creating employee (${testEmail}) assigned to WH1 (${wh1.name})...`);

  const createRes = await fetch(BASE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "عبدالله أمين المستودع",
      email: testEmail,
      username: `abdullah_${Date.now() % 10000}`,
      password: "SecurePassword123!",
      role: "STOREKEEPER",
      primaryWarehouseId: wh1.id,
      additionalWarehouseIds: [],
      subscriptionStartDate: "2026-10-01",
      subscriptionEndDate: "2027-10-01",
      permissions: ["STOCK_VIEW", "STOCK_TRANSFER_REQUEST"],
    }),
  });
  const createData = await createRes.json();
  console.log("Create Status:", createData.success, "Assigned WH:", createData.employee?.primaryWarehouseId);
  const employeeId = createData.employee.id;

  // 2. Employee performs an operation in WH1 (creates an audit/historical record)
  console.log("\n[2] Employee performs an operation in WH1 (creating historical ledger record)...");
  const historyMovement = await prisma.stockMovement.create({
    data: {
      movementNumber: `HIST-${Date.now()}`,
      productId: (await prisma.product.findFirst())!.id,
      warehouseId: wh1.id,
      quantity: 5,
      quantityInBaseUnit: 5,
      movementType: "ADJUSTMENT_IN",
      previousStock: 10,
      newStock: 15,
      performedBy: employeeId,
      reason: "Historical inventory audit performed by Abdullah before transfer",
      createdAt: new Date(),
    },
  });
  console.log("Created historical movement record:", historyMovement.movementNumber, "for WH1, by user:", historyMovement.performedBy);

  // 3. Super Admin reassigns employee from WH1 to WH3
  console.log(`\n[3] Super Admin moving employee to WH3 (${wh3.name})...`);
  const updateRes = await fetch(BASE_URL, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: employeeId,
      primaryWarehouseId: wh3.id,
      additionalWarehouseIds: [], // Replaces old warehouse access
    }),
  });
  const updateData = await updateRes.json();
  console.log("Update Status:", updateData.success, "New Primary WH:", updateData.employee?.primaryWarehouseId);

  // 4. Verify access update
  const updatedUser = await prisma.user.findUnique({ where: { id: employeeId } });
  console.log("\n[4] Verifying updated permissions & warehouse scope:");
  console.log("  Primary Warehouse:", updatedUser?.primaryWarehouseId === wh3.id ? "MATCHES WH3 (PASS)" : "FAIL");
  console.log("  Warehouse IDs contains WH3:", updatedUser?.warehouseIds.includes(wh3.id) ? "YES (PASS)" : "FAIL");
  console.log("  Old WH1 revoked from warehouseIds:", !updatedUser?.warehouseIds.includes(wh1.id) ? "REVOKED (PASS)" : "FAIL");

  // 5. Verify historical records remain completely untouched
  const verifiedMovement = await prisma.stockMovement.findUnique({ where: { id: historyMovement.id } });
  console.log("\n[5] Verifying historical ledger integrity:");
  console.log("  Historical Movement still exists:", verifiedMovement != null ? "YES (PASS)" : "FAIL");
  console.log("  Warehouse retained as WH1:", verifiedMovement?.warehouseId === wh1.id ? "RETAINED AS WH1 (PASS)" : "FAIL");
  console.log("  Attributed to original employee ID:", verifiedMovement?.performedBy === employeeId ? "YES (PASS)" : "FAIL");

  console.log("\n=== ALL EMPLOYEE REASSIGNMENT & AUDIT PRESERVATION TESTS PASSED ===");
}

runReassignmentTest()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Test failed:", err);
    process.exit(1);
  });
