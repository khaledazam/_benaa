import { expect, it } from "vitest";
import { assertPilotTarget, seedPilot } from "@/scripts/seed-pilot-customer-acceptance";
it("refuses absent, Atlas, ordinary local, credentialed and remote synthetic targets", () => {
  for (const url of [undefined, "mongodb+srv://example.invalid/benaa_cert_test", "mongodb://127.0.0.1/buildstock", "mongodb://example.invalid/benaa_cert_test", "mongodb://user:password@127.0.0.1/benaa_cert_test"]) {
    expect(() => assertPilotTarget(url)).toThrow();
  }
  expect(assertPilotTarget("mongodb://127.0.0.1:27017/benaa_cert_codex_test?replicaSet=test")).toContain("benaa_cert_codex_test");
});
it("refuses to overwrite existing records before any transaction or fixture write", async () => {
  const db = { $runCommandRaw: async (command: any) => command.listCollections ? { cursor: { firstBatch: [{ name: "Product" }] } } : { n: 1 },
    $transaction: () => { throw Error("Unexpected fixture write"); } };
  await expect(seedPilot(db as any, "SyntheticPassword2026!")).rejects.toThrow("refuses any existing records");
});
