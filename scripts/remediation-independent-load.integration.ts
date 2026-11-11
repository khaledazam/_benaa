import { isolatedTestMongod } from "./isolated-test-mongod";
import { afterAll, beforeAll, expect, it } from "vitest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { PrismaClient } from "@prisma/client";
import path from "node:path";
import fs from "node:fs";
import { applyTransferOperation } from "../lib/inventory/transferLifecycle";

let replica: MongoMemoryReplSet, db: PrismaClient;
beforeAll(async () => {
  process.env.MONGOMS_RUNTIME_DOWNLOAD = "false";
  replica = await MongoMemoryReplSet.create({ binary: { systemBinary: isolatedTestMongod(), version: "8.2.6" }, replSet: { count: 1, ip: "127.0.0.1" } });
  const url = replica.getUri(`benaa_audit_load_${Date.now()}`);
  if (!/^mongodb:\/\/127\.0\.0\.1:\d+\/benaa_audit_load_\d+\?/.test(url)) throw Error("Isolation could not be proven");
  db = new PrismaClient({ datasources: { db: { url } } });
  await db.$runCommandRaw({ createIndexes: "InventoryOperation", indexes: [{ key: { operationKey: 1 }, name: "operation_unique", unique: true }] });
});
afterAll(async () => { await db?.$disconnect(); await replica?.stop(); });

it("measures contention separately from independent legitimate transactions with per-product conservation", async () => {
  const owner = await db.user.create({ data: { email: "load-owner@example.invalid", name: "Synthetic", password: "not-used", role: "SUPER_ADMIN", status: true, createdAt: new Date() } });
  const source = await db.warehouse.create({ data: { name: "Synthetic Source", userId: owner.id, createdBy: owner.id } });
  const destination = await db.warehouse.create({ data: { name: "Synthetic Destination", userId: owner.id, createdBy: owner.id } });
  const fixtures: any[] = [];
  for (let index = 0; index < 21; index++) {
    const actor = await db.user.create({ data: { email: `load-${index}@example.invalid`, name: "Synthetic Manager", password: "unused", role: "WAREHOUSE_MANAGER", warehouseIds: [source.id, destination.id], status: true, createdAt: new Date() } });
    const unit = await db.unit.create({ data: { code: `LOAD-${index}`, name: "Piece", symbol: "PCS", type: "COUNT" } });
    const product = await db.product.create({ data: { name: "Synthetic load product", sku: `LOAD-${index}`, quantity: 100, unitId: unit.id, price: 1, status: "IN_STOCK", supplierId: owner.id, userId: owner.id, createdBy: owner.id } });
    await db.stockAllocation.create({ data: { productId: product.id, warehouseId: source.id, quantity: 100, reservedQuantity: 0, userId: owner.id } });
    await db.stockMovement.create({ data: { movementNumber: `OPEN-${index}`, productId: product.id, warehouseId: source.id, quantity: 100, quantityInBaseUnit: 100, unitId: unit.id, movementType: "OPENING_BALANCE", previousStock: 0, newStock: 100, performedBy: owner.id } });
    const request = await applyTransferOperation(db, actor, { action: "REQUEST", productId: product.id, fromWarehouseId: source.id, toWarehouseId: destination.id, quantity: 10, idempotencyKey: `load-request-${index}` });
    await applyTransferOperation(db, actor, { action: "APPROVE", transferId: request.transfer.id });
    fixtures.push({ actor, product, transfer: request.transfer });
  }
  const metrics: any = { topology: "single local replica member; service-level calls, not HTTP capacity", cases: [] };
  async function measured(label: string, operations: (() => Promise<any>)[]) {
    const started = performance.now();
    const results = await Promise.all(operations.map(async operation => {
      const begin = performance.now();
      try { await operation(); return { ok: true, milliseconds: performance.now() - begin }; }
      catch (error: any) { return { ok: false, milliseconds: performance.now() - begin, status: error.status, code: error.code }; }
    }));
    const elapsed = performance.now() - started;
    const sorted = results.map(result => result.milliseconds).sort((a, b) => a - b);
    const percentile = (p: number) => sorted[Math.ceil(sorted.length * p) - 1];
    const result = { label, requests: results.length, commits: results.filter(result => result.ok).length,
      rejected: results.filter(result => !result.ok), elapsedMs: elapsed,
      latencyMs: { p50: percentile(.5), p95: percentile(.95), p99: percentile(.99) },
      committedPerSecond: results.filter(result => result.ok).length * 1000 / elapsed };
    metrics.cases.push(result);
    return result;
  }
  const contested = fixtures[0];
  const contention = await measured("100 distinct dispatch keys, same document", Array.from({ length: 100 }, (_, index) => () => applyTransferOperation(db, contested.actor, { action: "DISPATCH", transferId: contested.transfer.id, idempotencyKey: `contend-${index}` })));
  expect(contention.commits).toBe(1); expect(contention.rejected.length).toBe(99);
  expect(await db.stockMovement.count({ where: { productId: contested.product.id, movementType: "TRANSFER_OUT" } })).toBe(1);
  const independent = await measured("20 distinct employees/products/documents", fixtures.slice(1).map(fixture => () => applyTransferOperation(db, fixture.actor, { action: "DISPATCH", transferId: fixture.transfer.id })));
  expect(independent.commits).toBe(20);
  for (const fixture of fixtures) {
    const allocations = await db.stockAllocation.findMany({ where: { productId: fixture.product.id } });
    const transfer = await db.stockTransfer.findUniqueOrThrow({ where: { id: fixture.transfer.id } });
    expect(allocations.reduce((sum, allocation) => sum + allocation.quantity, 0) + transfer.inTransitQuantity).toBe(100);
    expect(transfer.inTransitQuantity).toBe(10);
    expect(allocations.every(allocation => allocation.reservedQuantity === 0 && allocation.quantity >= 0)).toBe(true);
    expect(await db.stockMovement.count({ where: { productId: fixture.product.id } })).toBe(2);
  }
  metrics.reconciliation = "21 products: physical 90 PCS + in-transit 10 PCS each; opening ledger 100 PCS and one outgoing movement 10 PCS; reservations zero";
  fs.writeFileSync(path.resolve("../docs/PRODUCTION_CERTIFICATION/evidence/codex-independent-load.json"), JSON.stringify(metrics, null, 2));
});
