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
let warehouses: any[] = [];
let product: any;
const fixtureId = "100000000000000000000001";

async function call(body: any) {
  return POST(new NextRequest("http://isolated.test/api/inventory/transfers/lifecycle", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  }));
}

let sequence = 0;
const key = () => `fixture-${++sequence}`;
async function requestTransfer(quantity = 10) {
  const response = await call({ action: "REQUEST", productId: product.id, fromWarehouseId: warehouses[0].id, toWarehouseId: warehouses[1].id, quantity, idempotencyKey: key() });
  expect(response.status).toBe(201);
  return (await response.json()).transfer;
}
async function ready(quantity = 10) {
  const transfer = await requestTransfer(quantity);
  expect((await call({ action: "APPROVE", transferId: transfer.id })).status).toBe(200);
  return transfer;
}
async function balances() {
  const allocations = await state.db.stockAllocation.findMany({ where: { productId: product.id } });
  const transfers = await state.db.stockTransfer.findMany({ where: { productId: product.id } });
  const physical = allocations.reduce((s: number, a: any) => s + a.quantity, 0);
  const transit = transfers.reduce((s: number, a: any) => s + a.inTransitQuantity, 0);
  expect(physical + transit).toBeCloseTo(500, 8);
  expect((await state.db.product.findUnique({ where: { id: product.id } })).quantity).toBeCloseTo(physical, 8);
  expect(allocations.every((a: any) => a.quantity >= 0 && a.reservedQuantity >= 0 && a.reservedQuantity <= a.quantity)).toBe(true);
  return { physical, transit, allocations };
}

beforeAll(async () => {
  const binary = isolatedTestMongod();
  if (!fs.existsSync(binary)) throw new Error("Cached mongod is required; downloads are prohibited for this audit");
  process.env.MONGOMS_RUNTIME_DOWNLOAD = "false";
  replica = await MongoMemoryReplSet.create({ binary: { systemBinary: binary, version: "8.2.6" }, replSet: { count: 1, ip: "127.0.0.1" } });
  const uri = replica.getUri(`benaa_audit_${Date.now()}`);
  if (!/^mongodb:\/\/127\.0\.0\.1:\d+\/benaa_audit_\d+\?/.test(uri)) throw new Error("Refusing non-isolated database URL");
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

beforeEach(async () => {
  for (const model of ["inventoryOperation", "stockMovement", "stockTransfer", "stockAllocation"]) await state.db[model].deleteMany({});
  await state.db.product.update({ where: { id: product.id }, data: { quantity: 500 } });
  for (const warehouse of warehouses) await state.db.stockAllocation.create({ data: { productId: product.id, warehouseId: warehouse.id, quantity: 100, reservedQuantity: 0, userId: fixtureId } });
});


beforeEach(async () => {
  await state.db.user.update({ where: { id: fixtureId }, data: { role: "SUPER_ADMIN", warehouseIds: [], status: true } });
  await state.db.product.update({ where: { id: product.id }, data: { trackingMode: "NONE" } });
  await state.db.stockLocationAllocation.deleteMany({});
  await state.db.warehouseBin.deleteMany({});
  await state.db.inventoryBatch.deleteMany({});
});

describe("Independent Phase 1 critical correctness review", () => {
  it("distinct dispatch keys cannot deduct twice", async () => {
    const transfer = await ready();
    const results = await Promise.all(Array.from({ length: 20 }, () => call({ action: "DISPATCH", transferId: transfer.id, idempotencyKey: key() })));
    expect(results.filter(r => r.status === 200)).toHaveLength(1);
    expect(results.filter(r => r.status === 409)).toHaveLength(19);
    expect((await balances()).transit).toBe(10);
    expect(await state.db.stockMovement.count()).toBe(1);
  });
  it("distinct receipt keys cannot overreceive concurrent outstanding stock", async () => {
    const transfer = await ready();
    await call({ action: "DISPATCH", transferId: transfer.id });
    const results = await Promise.all(Array.from({ length: 20 }, () => call({ action: "RECEIVE", transferId: transfer.id, receivedQuantity: 6, idempotencyKey: key() })));
    expect(results.filter(r => r.status === 200)).toHaveLength(1);
    expect(results.every(r => [200, 400, 409].includes(r.status))).toBe(true);
    expect((await balances()).transit).toBe(4);
    expect(await state.db.stockMovement.count()).toBe(2);
  });
  it("competing distinct requests reserve at most physical stock", async () => {
    const results = await Promise.all(Array.from({ length: 20 }, () => call({ action: "REQUEST", productId: product.id, fromWarehouseId: warehouses[0].id, toWarehouseId: warehouses[1].id, quantity: 30, idempotencyKey: key() })));
    expect(results.filter(r => r.status === 201)).toHaveLength(3);
    expect(results.every(r => [201, 409].includes(r.status))).toBe(true);
    expect((await balances()).allocations.find((a: any) => a.warehouseId === warehouses[0].id).reservedQuantity).toBe(90);
  });
  it("cancellation races dispatch without releasing or deducting twice", async () => {
    const transfer = await ready();
    const results = await Promise.all([call({ action: "DISPATCH", transferId: transfer.id }), call({ action: "CANCEL", transferId: transfer.id })]);
    expect(results.filter(r => r.status === 200)).toHaveLength(1);
    expect(results.filter(r => r.status === 409)).toHaveLength(1);
    const b = await balances();
    expect(b.allocations.find((a: any) => a.warehouseId === warehouses[0].id).reservedQuantity).toBe(0);
    const final = await state.db.stockTransfer.findUnique({ where: { id: transfer.id } });
    expect(await state.db.stockMovement.count()).toBe(final.status === "DISPATCHED" ? 1 : 0);
  });
  it("last idempotency record failure rolls back every stock and state write", async () => {
    const transfer = await ready();
    const db = state.db;
    const operations = await db.inventoryOperation.count();
    state.db = new Proxy(db, { get(target, prop) {
      if (prop === "$transaction") return (work: any, options: any) => target.$transaction((tx: any) => work(new Proxy(tx, { get(t, p) {
        if (p === "inventoryOperation") return { ...t.inventoryOperation, create: async () => { throw new Error("injected final operation record failure"); } };
        return t[p];
      } })), options);
      const value = target[prop]; return typeof value === "function" ? value.bind(target) : value;
    } });
    try { expect((await call({ action: "DISPATCH", transferId: transfer.id })).status).toBe(503); } finally { state.db = db; }
    expect((await balances()).physical).toBe(500);
    expect(await db.stockMovement.count()).toBe(0);
    expect(await db.inventoryOperation.count()).toBe(operations);
    expect((await db.stockTransfer.findUnique({ where: { id: transfer.id } })).status).toBe("APPROVED");
    expect((await balances()).allocations.find((a: any) => a.warehouseId === warehouses[0].id).reservedQuantity).toBe(10);
    expect((await call({ action: "DISPATCH", transferId: transfer.id })).status).toBe(200);
  });
  it("warehouse reassignment rejects both replay and new mutation with stale session", async () => {
    const transfer = await ready();
    await state.db.user.update({ where: { id: fixtureId }, data: { role: "STOREKEEPER", warehouseIds: [warehouses[2].id] } });
    expect((await call({ action: "APPROVE", transferId: transfer.id })).status).toBe(403);
    expect((await call({ action: "DISPATCH", transferId: transfer.id })).status).toBe(403);
    expect((await balances()).physical).toBe(500);
  });
  it("role revocation rejects replay and dispatch despite retained warehouse assignment", async () => {
    const transfer = await ready();
    await call({ action: "DISPATCH", transferId: transfer.id });
    await state.db.user.update({ where: { id: fixtureId }, data: { role: "VIEWER", warehouseIds: [warehouses[0].id, warehouses[1].id] } });
    const replay = await call({ action: "DISPATCH", transferId: transfer.id });
    const receipt = await call({ action: "RECEIVE", transferId: transfer.id, receivedQuantity: 10, idempotencyKey: key() });
    console.info("ROLE_RECONCILIATION", JSON.stringify({ replayStatus: replay.status, receiptStatus: receipt.status, transit: (await balances()).transit }));
    expect(replay.status).toBe(403);
    expect(receipt.status).toBe(403);
    expect((await balances()).transit).toBe(10);
  });
  it("bin-accounted stock requires source bin or safe rejection without divergence", async () => {
    const bin = await state.db.warehouseBin.create({ data: { shelfId: fixtureId, warehouseId: warehouses[0].id, code: "ISOLATED-BIN", name: "Isolated source" } });
    await state.db.stockLocationAllocation.create({ data: { productId: product.id, warehouseId: warehouses[0].id, binId: bin.id, quantity: 100, quantityInBaseUnit: 100 } });
    const transfer = await ready();
    const result = await call({ action: "DISPATCH", transferId: transfer.id });
    const warehouse = (await balances()).allocations.find((a: any) => a.warehouseId === warehouses[0].id);
    const locations = await state.db.stockLocationAllocation.findMany({ where: { productId: product.id, warehouseId: warehouses[0].id } });
    expect(result.ok).toBe(false);
    expect(locations.reduce((s: number, a: any) => s + a.quantityInBaseUnit, 0)).toBe(warehouse.quantity);
  });
  it("batch-tracked stock requires batch identity or safe rejection", async () => {
    await state.db.product.update({ where: { id: product.id }, data: { trackingMode: "BATCH" } });
    await state.db.inventoryBatch.create({ data: { batchNumber: "ISOLATED-BATCH", productId: product.id, warehouseId: warehouses[0].id, quantity: 100 } });
    const result = await call({ action: "REQUEST", productId: product.id, fromWarehouseId: warehouses[0].id, toWarehouseId: warehouses[1].id, quantity: 10, idempotencyKey: key() });
    const warehouse = (await balances()).allocations.find((a: any) => a.warehouseId === warehouses[0].id);
    const batches = await state.db.inventoryBatch.findMany({ where: { productId: product.id, warehouseId: warehouses[0].id } });
    console.info("BATCH_RECONCILIATION", JSON.stringify({ dispatchStatus: result.status, warehouseQuantity: warehouse.quantity, batchQuantity: batches.reduce((s: number, a: any) => s + a.quantity, 0) }));
    expect(result.ok).toBe(false);
    expect(batches.reduce((s: number, a: any) => s + a.quantity, 0)).toBe(warehouse.quantity);
  });
});


it("fractional receipts conserve dispatched quantity without fixed rounding loss", async () => {
  const transfer = await ready(0.000001);
  await call({ action: "DISPATCH", transferId: transfer.id });
  const result = await call({ action: "RECEIVE", transferId: transfer.id, receivedQuantity: 0.0000000004, idempotencyKey: key() });
  const persisted = await state.db.stockTransfer.findUnique({ where: { id: transfer.id } });
  console.info("FRACTIONAL_RECONCILIATION", JSON.stringify({ receiptStatus: result.status, requested: transfer.quantity, received: persisted.receivedQuantity, transit: persisted.inTransitQuantity }));
  if (result.ok) {
    expect(persisted.receivedQuantity).toBe(0.0000000004);
    expect(persisted.inTransitQuantity).toBeCloseTo(transfer.quantity - 0.0000000004, 15);
    expect(persisted.status).toBe("IN_TRANSIT");
  } else {
    expect(persisted.receivedQuantity).toBe(0);
    expect(persisted.inTransitQuantity).toBe(transfer.quantity);
  }
});

it("supported six-decimal partial receipts conserve exact transfer and ledger totals", async () => {
  const transfer = await ready(0.000003);
  expect((await call({ action: "DISPATCH", transferId: transfer.id })).status).toBe(200);
  expect((await call({ action: "RECEIVE", transferId: transfer.id, receivedQuantity: 0.000001, idempotencyKey: key() })).status).toBe(200);
  let persisted = await state.db.stockTransfer.findUnique({ where: { id: transfer.id } });
  expect(persisted.receivedQuantity).toBe(0.000001);
  expect(persisted.inTransitQuantity).toBe(0.000002);
  expect((await call({ action: "RECEIVE", transferId: transfer.id, receivedQuantity: 0.000002, idempotencyKey: key() })).status).toBe(200);
  persisted = await state.db.stockTransfer.findUnique({ where: { id: transfer.id } });
  expect(persisted.receivedQuantity).toBe(transfer.quantity);
  expect(persisted.inTransitQuantity).toBe(0);
  expect(persisted.status).toBe("COMPLETED");
  await balances();
});

it("tracked batch lifecycle conserves source/destination/transit and links ledger identity", async () => {
  await state.db.product.update({ where: { id: product.id }, data: { trackingMode: "BATCH" } });
  const sourceBatch = await state.db.inventoryBatch.create({ data: { batchNumber: "ISOLATED-BATCH-FULL", productId: product.id, warehouseId: warehouses[0].id, quantity: 100 } });
  const req = await call({ action: "REQUEST", productId: product.id, fromWarehouseId: warehouses[0].id, toWarehouseId: warehouses[1].id, quantity: 10, batchId: sourceBatch.id, idempotencyKey: key() });
  expect(req.status).toBe(201);
  const transfer = (await req.json()).transfer;
  expect((await state.db.inventoryBatch.findUnique({ where: { id: sourceBatch.id } })).reservedQuantity).toBe(10);
  expect((await call({ action: "APPROVE", transferId: transfer.id })).status).toBe(200);
  expect((await call({ action: "DISPATCH", transferId: transfer.id })).status).toBe(200);
  expect((await state.db.inventoryBatch.findUnique({ where: { id: sourceBatch.id } })).quantity).toBe(90);
  const receipt = { action: "RECEIVE", transferId: transfer.id, receivedQuantity: 4, idempotencyKey: key() };
  expect((await call(receipt)).status).toBe(200);
  expect((await call(receipt)).status).toBe(200);
  const b = await balances();
  expect(b.transit).toBe(6);
  let batches = await state.db.inventoryBatch.findMany({ where: { productId: product.id } });
  expect(batches.reduce((s: number, a: any) => s + a.quantity, 0) + b.transit).toBe(100);
  expect((await call({ ...receipt, receivedQuantity: 6, idempotencyKey: key() })).status).toBe(200);
  batches = await state.db.inventoryBatch.findMany({ where: { productId: product.id } });
  expect(batches.reduce((s: number, a: any) => s + a.quantity, 0)).toBe(100);
  expect(batches.every((a: any) => a.reservedQuantity === 0)).toBe(true);
  const movements = await state.db.stockMovement.findMany({ where: { referenceId: transfer.id } });
  expect(movements).toHaveLength(3);
  expect(movements.every((m: any) => !!m.batchId)).toBe(true);
  expect(movements.find((m: any) => m.movementType === "TRANSFER_OUT").batchId).toBe(sourceBatch.id);
});

it("tracked batch cancellation releases reservations without stock or ledger changes", async () => {
  await state.db.product.update({ where: { id: product.id }, data: { trackingMode: "BATCH" } });
  const batch = await state.db.inventoryBatch.create({ data: { batchNumber: "ISOLATED-BATCH-CANCEL", productId: product.id, warehouseId: warehouses[0].id, quantity: 100 } });
  const req = await call({ action: "REQUEST", productId: product.id, fromWarehouseId: warehouses[0].id, toWarehouseId: warehouses[1].id, quantity: 10, batchId: batch.id, idempotencyKey: key() });
  expect(req.status).toBe(201);
  const transfer = (await req.json()).transfer;
  expect((await state.db.inventoryBatch.findUnique({ where: { id: batch.id } })).reservedQuantity).toBe(10);
  expect((await call({ action: "CANCEL", transferId: transfer.id })).status).toBe(200);
  expect((await call({ action: "CANCEL", transferId: transfer.id })).status).toBe(200);
  const after = await state.db.inventoryBatch.findUnique({ where: { id: batch.id } });
  expect(after.quantity).toBe(100);
  expect(after.reservedQuantity).toBe(0);
  expect((await balances()).physical).toBe(500);
  expect((await balances()).allocations.find((a: any) => a.warehouseId === warehouses[0].id).reservedQuantity).toBe(0);
  expect(await state.db.stockMovement.count()).toBe(0);
});
