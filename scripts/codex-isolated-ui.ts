/** Local audit server. Owns a fresh disposable replica; never imports .env. */
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { PrismaClient } from "@prisma/client";
import { createServer } from "node:http";
import path from "node:path";
import { assertPilotTarget, seedPilot } from "./seed-pilot-customer-acceptance";

async function main() {
  process.env.MONGOMS_RUNTIME_DOWNLOAD = "false";
  const replica = await MongoMemoryReplSet.create({
    binary: { systemBinary: path.join(process.env.USERPROFILE!, ".cache/mongodb-binaries/mongod-x64-win32-8.2.6.exe"), version: "8.2.6" },
    replSet: { count: 1, ip: "127.0.0.1" },
  });
  const url = assertPilotTarget(replica.getUri(`benaa_cert_codex_ui_${Date.now()}`));
  process.env.DATABASE_URL = url;
  process.env.JWT_SECRET = "isolated-codex-ui-signing-key-not-for-deployment";
  process.env.NEXT_PUBLIC_API_URL = "http://127.0.0.1:3217";
  process.env.NEXT_TELEMETRY_DISABLED = "1";
  process.env.BENAA_LOCAL_AUDIT_DIST_DIR = ".next-codex-ui";
  process.env.NARA_API_KEY = "disabled-for-isolated-audit";
  const db = new PrismaClient({ datasources: { db: { url } } });
  globalThis.prisma = db;
  for (const [collection, key] of [["InventoryOperation", { operationKey: 1 }], ["StockAllocation", { productId: 1, warehouseId: 1 }],
    ["StockLocationAllocation", { productId: 1, binId: 1 }], ["User", { email: 1 }], ["Product", { sku: 1 }]]) {
    await db.$runCommandRaw({ createIndexes: collection, indexes: [{ key, name: "codex_unique", unique: true }] });
  }
  console.log("ISOLATION_VERIFIED", new URL(url).pathname, "loopback-only; fresh replica owned by audit");
  console.log("SYNTHETIC_SEED", await seedPilot(db, "CodexSyntheticOnly2026!"));
  const next = require("next");
  const app = next({ dev: true, hostname: "127.0.0.1", port: 3217, dir: process.cwd(), conf: { distDir: ".next-codex-ui" } });
  await app.prepare();
  const server = createServer(app.getRequestHandler());
  server.listen(3217, "127.0.0.1", () => console.log("ISOLATED_UI_READY http://127.0.0.1:3217"));
  async function stop() { server.close(); await app.close(); await db.$disconnect(); await replica.stop(); process.exit(0); }
  process.on("SIGINT", stop); process.on("SIGTERM", stop);
  setTimeout(stop, 45 * 60 * 1000).unref();
}
main().catch(() => { console.error("Isolated UI bootstrap failed; no production target used"); process.exitCode = 1; });
