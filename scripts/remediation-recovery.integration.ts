import { isolatedTestMongod } from "./isolated-test-mongod";
/** Explicit opt-in, disposable replica only. Does not import .env or prisma/client.
 * Run: vitest run --config vitest.audit.config.ts
 * Passing defect characterizations document blockers, not production correctness.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { PrismaClient } from "@prisma/client";
import { NextRequest } from "next/server";
import path from "node:path";
import fs from "node:fs";
import { MongoClient } from "mongodb";
import { backupSyntheticDatabase, restoreSyntheticDatabase } from "@/lib/inventory/synthetic-backup";
import { executeStockMutationInTx } from "@/lib/inventory/stockService";
import { createGoodsReceiptDraft, postGoodsReceipt } from "@/lib/procurement/procurementService";
import { createStockReservation } from "@/lib/reservations/reservationService";
import { applyProjectManagement, applyProjectOperation } from "@/lib/projects/projectMaterialIssueService";

const state = vi.hoisted(() => ({ db: null as any, session: null as any }));
vi.mock("@/prisma/client", () => ({ prisma: new Proxy({}, { get: (_, key) => {
  if (!state.db) throw new Error("Isolated database not initialized");
  const value = state.db[key];
  return typeof value === "function" ? value.bind(state.db) : value;
} }) }));
vi.mock("@/utils/auth", () => ({ getSessionFromRequest: async () => state.session }));
vi.mock("@/lib/cache/post-mutation", () => ({ scheduleInvalidateStockAllocationCaches: vi.fn(async () => undefined) }));
import { POST } from "@/app/api/inventory/transfers/lifecycle/route";
import { GET as discover } from "@/app/api/inventory/cross-warehouse/route";

let replica: MongoMemoryReplSet | undefined;
let sourceUri = "";
let warehouses: any[] = [];
let product: any;
const fixtureId = "100000000000000000000001";

async function call(body: any) {
  return POST(new NextRequest("http://isolated.test/api/inventory/transfers/lifecycle", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  }));
}

beforeAll(async () => {
  const binary = isolatedTestMongod();
  if (!fs.existsSync(binary)) throw new Error("Cached mongod is required; downloads are prohibited for this audit");
  process.env.MONGOMS_RUNTIME_DOWNLOAD = "false";
  replica = await MongoMemoryReplSet.create({ binary: { systemBinary: binary, version: "8.2.6" }, replSet: { count: 1, ip: "127.0.0.1" } });
  const uri = replica.getUri(`benaa_audit_${Date.now()}`);
  if (!/^mongodb:\/\/127\.0\.0\.1:\d+\/benaa_audit_\d+\?/.test(uri)) throw new Error("Refusing non-isolated database URL");
  sourceUri = uri;
  state.db = new PrismaClient({ datasources: { db: { url: uri } } });
  await state.db.$connect();
  await state.db.$runCommandRaw({ createIndexes: "InventoryOperation", indexes: [{ key: { operationKey: 1 }, name: "InventoryOperation_operationKey_key", unique: true }] });
  state.session = await state.db.user.create({ data: {
    id: fixtureId, email: "audit@isolated.test", name: "Audit", password: "unused", role: "SUPER_ADMIN",
    createdAt: new Date(), warehouseIds: [], permissions: [],
  } });
  for (let n = 0; n < 5; n++) {
    warehouses.push(await state.db.warehouse.create({ data: { name: `Dynamic warehouse ${n + 1}`, code: `AUDIT-${n}`, userId: fixtureId, createdBy: fixtureId } }));
  }
  product = await state.db.product.create({ data: { name: "Audit Tile", sku: "ISOLATED-TILE", price: 10, quantity: 500, status: "IN_STOCK", supplierId: fixtureId, userId: fixtureId, createdBy: fixtureId } });
  for (const warehouse of warehouses) {
    await state.db.stockAllocation.create({ data: { productId: product.id, warehouseId: warehouse.id, quantity: 100, reservedQuantity: 0, userId: fixtureId } });
  }
}, 60000);

afterAll(async () => {
  await state.db?.$disconnect();
  await replica?.stop();
});

describe("Real synthetic staging BSON backup and isolated restore", () => {
  it("restores employees, sales, procurement, project issues, transfers and reconciled ledger", async () => {
    const db = state.db;
    for (const warehouse of warehouses) await db.stockMovement.create({ data: { movementNumber: `OPEN-${warehouse.id}`, productId: product.id, warehouseId: warehouse.id,
      quantity: 100, quantityInBaseUnit: 100, movementType: "OPENING_BALANCE", previousStock: 0, newStock: 100, performedBy: fixtureId } });
    await db.user.create({ data: { email: "storekeeper@isolated.test", name: "Synthetic employee", password: "synthetic-unusable-login", role: "STOREKEEPER", primaryWarehouseId: warehouses[0].id,
      warehouseIds: [warehouses[0].id], createdAt: new Date() } });
    const supplier = await db.supplier.create({ data: { name: "Synthetic supplier", userId: fixtureId, createdBy: fixtureId } });
    await db.product.update({ where: { id: product.id }, data: { supplierId: supplier.id } });
    const customer = await db.customer.create({ data: { customerCode: "SYNTH-CUSTOMER", name: "Synthetic customer", createdBy: fixtureId } });
    const po = await db.purchaseOrder.create({ data: { purchaseOrderNumber: "SYNTH-PO", supplierId: supplier.id, warehouseId: warehouses[0].id, status: "APPROVED", createdBy: fixtureId,
      items: { create: [{ productId: product.id, productName: "Audit Tile", orderedQuantity: 20, remainingQuantity: 20, unitPrice: 10, lineTotal: 200 }] } }, include: { items: true } });
    const receipt = await createGoodsReceiptDraft({ purchaseOrderId: po.id, userId: fixtureId, items: [{ productId: product.id, purchaseOrderItemId: po.items[0].id, receivedQuantity: 20 }] });
    await postGoodsReceipt(receipt.id, fixtureId);
    const sale = await db.salesOrder.create({ data: { salesOrderNumber: "SYNTH-SALE", customerId: customer.id, warehouseId: warehouses[0].id, status: "APPROVED", createdBy: fixtureId,
      items: { create: [{ productId: product.id, productName: "Audit Tile", orderedQuantity: 5, unitPrice: 10, lineTotal: 50 }] } } });
    await createStockReservation(sale.id, fixtureId);
    let result = await call({ action: "REQUEST", productId: product.id, fromWarehouseId: warehouses[1].id, toWarehouseId: warehouses[2].id, quantity: 5, idempotencyKey: "restore-transfer" });
    expect(result.status).toBe(201); const transferId = (await result.json()).transfer.id;
    for (const action of ["APPROVE", "DISPATCH", "RECEIVE"]) { result = await call({ action, transferId, receivedQuantity: action === "RECEIVE" ? 5 : undefined, idempotencyKey: `restore-${action}` }); expect(result.status).toBe(200); }
    const managed = await applyProjectManagement(db, state.session, { code: "SYNTH-PROJECT", name: "Synthetic construction project", location: "Isolated site", warehouseIds: [warehouses[0].id], idempotencyKey: "restore-project" });
    let issue = (await applyProjectOperation(db, state.session, { action: "CREATE", projectId: managed.project.id, warehouseId: warehouses[0].id, items: [{ productId: product.id, quantity: 10 }], idempotencyKey: "restore-issue" })).issue;
    for (const action of ["REQUEST", "APPROVE", "RESERVE"]) issue = (await applyProjectOperation(db, state.session, { action, issueId: issue.id, idempotencyKey: `restore-project-${action}` })).issue;
    for (const [action, amount] of [["DISPATCH", 10], ["RETURN", 2]] as const) issue = (await applyProjectOperation(db, state.session, { action, issueId: issue.id, quantities: [{ issueItemId: issue.items[0].id, quantity: amount }], idempotencyKey: `restore-project-${action}` })).issue;
    await applyProjectOperation(db, state.session, { action: "COMPLETE", issueId: issue.id, idempotencyKey: "restore-project-COMPLETE" });
    expect(await db.invoice.count()).toBe(0); expect(await db.order.count()).toBe(0); expect(await db.salesOrder.count()).toBe(1);
    const sourceName = new URL(sourceUri).pathname.slice(1);
    const restoredName = `benaa_restore_${Date.now()}`;
    const corruptedTarget = `${restoredName}_bad`;
    const allowed = [sourceName, restoredName, corruptedTarget];
    const client = new MongoClient(sourceUri);
    await client.connect();
    const directory = path.resolve(`../docs/PRODUCTION_CERTIFICATION/evidence/synthetic-backup-${Date.now()}`);
    const started = performance.now();
    try {
      const manifest = await backupSyntheticDatabase(client, sourceName, directory, allowed);
      const backupMs = performance.now() - started;
      const restoreStart = performance.now();
      const restored = await restoreSyntheticDatabase(client, restoredName, directory, allowed);
      const restoreMs = performance.now() - restoreStart;
      const restoredDb = client.db(restoredName);
      const allocations = await restoredDb.collection("StockAllocation").find().toArray();
      const movements = await restoredDb.collection("StockMovement").find().toArray();
      for (const allocation of allocations) {
        const ledger = movements.filter(m => String(m.warehouseId) === String(allocation.warehouseId)).reduce((sum, m) => sum + (["TRANSFER_OUT", "PROJECT_ISSUE"].includes(m.movementType) ? -m.quantityInBaseUnit : m.quantityInBaseUnit), 0);
        expect(allocation.quantity).toBe(ledger);
      }
      expect(allocations.reduce((sum, a) => sum + a.quantity, 0)).toBe(512);
      expect((await restoredDb.collection("Product").findOne())?.quantity).toBe(512);
      expect(await restoredDb.collection("ProjectMaterialIssueReturn").countDocuments()).toBe(1);
      expect(await restoredDb.collection("StockReservationItem").countDocuments()).toBe(1);
      await expect(restoreSyntheticDatabase(client, restoredName, directory, allowed)).rejects.toThrow("overwrite");
      await expect(restoreSyntheticDatabase(client, "buildstock_db", directory, allowed)).rejects.toThrow("restricted");
      const first = manifest.collections.find((entry: any) => entry.count > 0);
      const archive = path.join(directory, first.file); const bytes = fs.readFileSync(archive);
      fs.writeFileSync(archive, Buffer.from("corrupted synthetic archive"));
      await expect(restoreSyntheticDatabase(client, corruptedTarget, directory, allowed)).rejects.toThrow("integrity");
      fs.writeFileSync(archive, bytes);
      expect(await client.db(corruptedTarget).listCollections().toArray()).toHaveLength(0);
      const evidence = { syntheticOnly: true, atlasAccess: false, sourceName, restoredName, backupMs: Math.round(backupMs), restoreMs: Math.round(restoreMs),
        collections: restored.collections, records: restored.records, hashesVerified: restored.hashesVerified, warehouseLedgerBalance: 512, productBalance: 512,
        salesOrders: 1, projectReturns: 1, projectCreatedCustomerInvoices: 0, overwriteRefused: true, tamperedArchiveRefusedBeforeWrites: true,
        limits: "Local synthetic snapshot and restore; not a production topology/RPO/RTO claim" };
      fs.writeFileSync(path.resolve("../docs/PRODUCTION_CERTIFICATION/evidence/remediation-restore-results.json"), JSON.stringify(evidence, null, 2));
      console.log(JSON.stringify(evidence));
    } finally { await client.close(); }
  }, 120000);
});

