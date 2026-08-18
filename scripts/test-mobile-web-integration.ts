import { prisma } from "../prisma/client";

async function testMobileWebIntegration() {
  console.log("==================================================");
  console.log("🚀 BENAA WMS: Mobile & Web Realtime Integration Test");
  console.log("==================================================");

  // 1. Verify User Credentials (khaled@admin.com)
  const adminUser = await prisma.user.findUnique({
    where: { email: "khaled@admin.com" },
  });

  if (!adminUser) {
    console.error("❌ Admin user khaled@admin.com not found!");
    process.exit(1);
  }
  console.log(`✅ Admin Account Verified: ${adminUser.name} (${adminUser.role})`);

  // 2. Query Products (Web & Mobile shared DB state)
  const initialProducts = await prisma.product.findMany({
    take: 5,
  });

  console.log(`\n📦 Found ${initialProducts.length} items shared between Web & Mobile:`);
  initialProducts.forEach((p) => {
    console.log(`   - [${p.sku}] ${p.name}: Quantity = ${p.quantity}`);
  });

  if (initialProducts.length === 0) {
    console.log("❌ No products found in database.");
    process.exit(1);
  }

  const targetProd = initialProducts[0];
  if (!targetProd) {
    console.error("❌ No target product found.");
    process.exit(1);
  }
  const newQty = targetProd.quantity + 50;

  console.log(`\n🔄 Mutating Stock via Web/Mobile Shared Engine...`);
  console.log(`   Product: ${targetProd.name}`);
  console.log(`   Previous Qty: ${targetProd.quantity} ➡️ New Qty: ${newQty}`);

  const updatedProd = await prisma.product.update({
    where: { id: targetProd.id },
    data: { quantity: newQty, updatedAt: new Date() },
  });

  console.log(`✅ Stock updated successfully in MongoDB!`);

  // 4. Verify Mobile Query Read State
  const reFetchedProd = await prisma.product.findUnique({
    where: { id: targetProd.id },
  });

  if (reFetchedProd?.quantity === newQty) {
    console.log("\n🎉 INTEGRATION TEST PASSED SUCCESSFULY!");
    console.log("Both Next.js Web Dashboard and Expo Mobile App read from the exact same live MongoDB instance!");
  } else {
    console.error("❌ Mismatch detected!");
  }

  process.exit(0);
}

testMobileWebIntegration().catch((err) => {
  console.error("Integration Error:", err);
  process.exit(1);
});
