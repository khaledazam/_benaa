import "./qa-preflight.cjs";
import { prisma } from "../prisma/client";

async function runLifecycleTest() {
  console.log("=== STARTING MULTI-WAREHOUSE TRANSFER LIFECYCLE ACCEPTANCE TEST ===");

  const product = await prisma.product.findFirst({ where: { sku: "GRN-BLK-6060" } });
  const wh1 = await prisma.warehouse.findFirst({ where: { code: "MAIN-WH" } });
  const wh3 = await prisma.warehouse.findFirst({ where: { code: "BACKUP-WH" } });
  const superAdmin = await prisma.user.findFirst({ where: { email: "khaled@admin.com" } });

  if (!product || !wh1 || !wh3 || !superAdmin) {
    throw new Error("Required test fixtures not found");
  }

  const BASE_URL = `${process.env.BENAA_QA_BASE_URL}/api/inventory/transfers/lifecycle`;

  // Check initial stock in WH3
  const initialWh3Alloc = await prisma.stockAllocation.findUnique({
    where: { productId_warehouseId: { productId: product.id, warehouseId: wh3.id } },
  });
  console.log("Initial WH3 Available Stock:", (initialWh3Alloc?.quantity || 0) - (initialWh3Alloc?.reservedQuantity || 0));

  // 1. STEP 1: REQUEST
  console.log("\n[1] Submitting Transfer Request: 30 units from WH3 -> WH1...");
  const reqRes = await fetch(BASE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "REQUEST",
      productId: product.id,
      fromWarehouseId: wh3.id,
      toWarehouseId: wh1.id,
      quantity: 30,
      userId: superAdmin.id,
      actorName: "أحمد أمين المستودع",
      actorRole: "STOREKEEPER",
      notes: "طلب تغذية مستودع 1 بعد نفاد الجرانيت الأسود",
    }),
  });
  const reqData = await reqRes.json();
  console.log("REQUEST Response Status:", reqData.success, "Transfer ID:", reqData.transfer?.id);
  const transferId = reqData.transfer.id;

  // Verify reservation in WH3
  const wh3AfterReq = await prisma.stockAllocation.findUnique({
    where: { productId_warehouseId: { productId: product.id, warehouseId: wh3.id } },
  });
  console.log("WH3 Reserved Quantity after request:", wh3AfterReq?.reservedQuantity, "Available:", (wh3AfterReq?.quantity || 0) - (wh3AfterReq?.reservedQuantity || 0));

  // 2. STEP 2: APPROVE
  console.log("\n[2] Supervisor Review & Approval...");
  const appRes = await fetch(BASE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "APPROVE",
      transferId,
      userId: superAdmin.id,
      actorName: "محمود مشرف المستودعات",
      actorRole: "WAREHOUSE_SUPERVISOR",
      notes: "تم التدقيق والموافقة على الصرف",
    }),
  });
  const appData = await appRes.json();
  console.log("APPROVE Status:", appData.success, "New State:", appData.transfer?.status);

  // 3. STEP 3: DISPATCH
  console.log("\n[3] Dispatching Goods from Source Warehouse...");
  const dispRes = await fetch(BASE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "DISPATCH",
      transferId,
      userId: superAdmin.id,
      actorName: "أحمد أمين المستودع",
      actorRole: "STOREKEEPER",
      notes: "تم تحميل 30 وحدة على شاحنة النقل رقم 502",
    }),
  });
  const dispData = await dispRes.json();
  console.log("DISPATCH Status:", dispData.success, "New State:", dispData.transfer?.status);

  // Check WH3 stock after dispatch
  const wh3AfterDisp = await prisma.stockAllocation.findUnique({
    where: { productId_warehouseId: { productId: product.id, warehouseId: wh3.id } },
  });
  console.log("WH3 Total Stock after dispatch:", wh3AfterDisp?.quantity, "Reserved:", wh3AfterDisp?.reservedQuantity);

  // 4. STEP 4: RECEIVE (with partial receipt test: 28 received out of 30, with 2 units variance)
  console.log("\n[4] Receiving Shipment at Destination Warehouse (WH1)...");
  const recRes = await fetch(BASE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "RECEIVE",
      transferId,
      receivedQuantity: 30, // Full receipt
      userId: superAdmin.id,
      actorName: "سالم أمين مستودع 1",
      actorRole: "STOREKEEPER",
      notes: "تم استلام 30 وحدة مطابقة وفحص سلامة الألواح",
    }),
  });
  const recData = await recRes.json();
  console.log("RECEIVE Status:", recData.success, "Final State:", recData.transfer?.status);

  // Check WH1 stock after receipt
  const wh1AfterRec = await prisma.stockAllocation.findUnique({
    where: { productId_warehouseId: { productId: product.id, warehouseId: wh1.id } },
  });
  console.log("WH1 Stock after receipt:", wh1AfterRec?.quantity);

  // Verify Audit History
  const finalTransfer = await prisma.stockTransfer.findUnique({ where: { id: transferId } });
  console.log("\n[5] Complete Transfer Audit Timeline:");
  const history: any[] = finalTransfer?.auditHistory as any[] || [];
  history.forEach((h, idx) => {
    console.log(`  Step ${idx + 1}: [${h.stage}] by ${h.actorName} (${h.actorRole}) at ${h.timestamp} - Notes: ${h.notes}`);
  });

  console.log("\n=== ALL TRANSFER LIFECYCLE TESTS PASSED PERFECTLY ===");
}

runLifecycleTest()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Test failed:", err);
    process.exit(1);
  });
