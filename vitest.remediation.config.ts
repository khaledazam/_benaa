import path from "node:path";
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { environment: "node", include: ["scripts/remediation-*.integration.ts"], maxWorkers: 1, hookTimeout: 60000, testTimeout: 120000 },
  resolve: { alias: { "@": path.resolve(__dirname, ".") } },
});
