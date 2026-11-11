import path from "node:path";
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { environment: "node", include: ["scripts/audit-transfer.integration.ts"], maxWorkers: 1, hookTimeout: 60000, testTimeout: 30000 },
  resolve: { alias: { "@": path.resolve(__dirname, ".") } },
});
