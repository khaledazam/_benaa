import "./qa-preflight.cjs";
import {
  computeAuthoritativeMetrics,
  generateBenaaAiIntelligence,
} from "../lib/ai/benaa-analytics-engine";
import { getNaraBaseUrl, getNaraModel, isNaraRouterConfigured } from "../lib/ai/nararouter";

async function main() {
  console.log("==========================================");
  console.log("BENAA INTELLIGENCE — AI ENGINE VERIFICATION");
  console.log("==========================================");
  console.log("Provider: NaraRouter");
  console.log("Base URL:", getNaraBaseUrl());
  console.log("Model ID:", getNaraModel());
  console.log("API Key Configured:", isNaraRouterConfigured());

  console.log("\n1. Computing authoritative metrics from MongoDB Atlas...");
  const metrics = await computeAuthoritativeMetrics();

  console.log(`✓ Total Products in Catalog: ${metrics.inventory.totalItems}`);
  console.log(`✓ Total Valuation: ${metrics.inventory.totalValuation.toLocaleString()} SAR`);
  console.log(`✓ Low Stock Items Detected: ${metrics.inventory.lowStockItems.length}`);
  for (const item of metrics.inventory.lowStockItems) {
    console.log(`   - [${item.sku}] ${item.name}: Stock=${item.currentStock}, Burn=${item.dailyBurnRate}/day, Stockout in ${item.estimatedDaysToStockout} days, Reorder=${item.suggestedReorder}`);
  }

  console.log(`✓ Slow Moving Items: ${metrics.inventory.slowMovingItems.length}`);
  console.log(`✓ Total Outstanding Debt: ${metrics.financial.totalOutstandingDebt.toLocaleString()} SAR`);

  console.log("\n2. Generating Intelligence Insights (NaraRouter / Deterministic Engine)...");
  const result = await generateBenaaAiIntelligence(metrics);

  console.log(`✓ Generated ${result.insights.length} Actionable Arabic Insights!`);
  console.log(`✓ Provider: ${result.provider}`);
  console.log(`✓ Cloud AI Generated: ${result.isCloudAiGenerated}`);

  console.log("\n3. Generated Insights Samples:");
  for (const insight of result.insights) {
    console.log(`\n[${insight.severity.toUpperCase()}] [${insight.category}] ${insight.title}`);
    console.log(`   ${insight.description}`);
    console.log(`   Action: ${insight.recommendedAction} -> (${insight.actionRoute})`);
  }

  console.log("\n==========================================");
  console.log("AI INTEGRATION TEST COMPLETED SUCCESSFULLY");
  console.log("==========================================");
}

main().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
