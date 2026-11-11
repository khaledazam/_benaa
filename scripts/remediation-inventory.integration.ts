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

describe("Phase 1 correct inventory invariants on isolated MongoDB", () => {
  it("rejects receipt before dispatch without any stock or ledger writes", async () => {
    const transfer = await ready();
    expect((await call({ action: "RECEIVE", transferId: transfer.id, receivedQuantity: 10, idempotencyKey: key() })).status).toBe(409);
    expect((await balances()).physical).toBe(500);
    expect(await state.db.stockMovement.count()).toBe(0);
  });
  it.each([-1, 0, NaN, Infinity, 11, "10", null])("rejects invalid receipt %s atomically", async amount => {
    const transfer = await ready();
    expect((await call({ action: "DISPATCH", transferId: transfer.id })).status).toBe(200);
    const count = await state.db.inventoryOperation.count();
    expect((await call({ action: "RECEIVE", transferId: transfer.id, receivedQuantity: amount, idempotencyKey: key() })).status).toBe(400);
    expect((await balances()).transit).toBe(10);
    expect(await state.db.stockMovement.count()).toBe(1);
    expect(await state.db.inventoryOperation.count()).toBe(count);
  });
  it("conserves physical plus transit through partial receipts and retry replay", async () => {
    const requestKey = key();
    const body = { action: "REQUEST", productId: product.id, fromWarehouseId: warehouses[0].id, toWarehouseId: warehouses[1].id, quantity: 10, idempotencyKey: requestKey };
    const first = await call(body); const transfer = (await first.json()).transfer;
    expect((await call(body)).status).toBe(200);
    expect(await state.db.stockTransfer.count()).toBe(1);
    expect((await call({ ...body, quantity: 11 })).status).toBe(409);
    await call({ action: "APPROVE", transferId: transfer.id });
    await call({ action: "DISPATCH", transferId: transfer.id });
    const partial = { action: "RECEIVE", transferId: transfer.id, receivedQuantity: 4, idempotencyKey: key() };
    expect((await call(partial)).status).toBe(200);
    expect((await balances()).transit).toBe(6);
    expect((await call(partial)).status).toBe(200);
    expect((await balances()).transit).toBe(6);
    expect((await call({ ...partial, receivedQuantity: 6, idempotencyKey: key() })).status).toBe(200);
    expect((await balances()).physical).toBe(500);
    const final = await state.db.stockTransfer.findUnique({ where: { id: transfer.id } });
    expect(final.status).toBe("COMPLETED"); expect(final.receivedQuantity).toBe(10);
    const movements = await state.db.stockMovement.findMany();
    expect(movements).toHaveLength(3);
    expect(movements.reduce((s: number, m: any) => s + (m.movementType === "TRANSFER_IN" ? m.quantityInBaseUnit : -m.quantityInBaseUnit), 0)).toBe(0);
  });
  it("concurrent request retries reserve once, competing requests cannot overcommit", async () => {
    const retryBody = { action: "REQUEST", productId: product.id, fromWarehouseId: warehouses[0].id, toWarehouseId: warehouses[1].id, quantity: 60, idempotencyKey: key() };
    const retries = await Promise.all(Array.from({ length: 10 }, () => call(retryBody)));
    expect(retries.every(r => [200, 201].includes(r.status))).toBe(true);
    expect(await state.db.stockTransfer.count()).toBe(1);
    const other = await call({ ...retryBody, idempotencyKey: key() });
    expect(other.status).toBe(409);
    expect((await balances()).allocations.find((a: any) => a.warehouseId === warehouses[0].id).reservedQuantity).toBe(60);
  });
  it.each([10, 25, 50, 100])("%i duplicate dispatch/receive attempts mutate each leg once", async clients => {
    const transfer = await ready();
    const dispatches = await Promise.all(Array.from({ length: clients }, () => call({ action: "DISPATCH", transferId: transfer.id })));
    expect(dispatches.every(r => r.status === 200)).toBe(true);
    expect((await balances()).transit).toBe(10);
    const receiptKey = key();
    const receipts = await Promise.all(Array.from({ length: clients }, () => call({ action: "RECEIVE", transferId: transfer.id, receivedQuantity: 10, idempotencyKey: receiptKey })));
    expect(receipts.every(r => r.status === 200)).toBe(true);
    expect((await balances()).transit).toBe(0);
    expect(await state.db.stockMovement.count()).toBe(2);
    expect((await balances()).allocations.find((a: any) => a.warehouseId === warehouses[0].id).quantity).toBe(90);
  }, 120000);
  it("late transaction failure rolls back state, reservation, product and ledger; retry succeeds", async () => {
    const transfer = await ready();
    const db = state.db;
    state.db = new Proxy(db, { get(target, prop) {
      if (prop === "$transaction") return (work: any, options: any) => target.$transaction((tx: any) => work(new Proxy(tx, { get(t, p) {
        if (p === "product") return { ...t.product, update: async () => { throw new Error("injected after movement/allocation writes"); } };
        return t[p];
      } })), options);
      const value = target[prop]; return typeof value === "function" ? value.bind(target) : value;
    } });
    try { expect((await call({ action: "DISPATCH", transferId: transfer.id })).status).toBe(503); } finally { state.db = db; }
    expect((await balances()).physical).toBe(500);
    expect(await db.stockMovement.count()).toBe(0);
    expect((await db.stockTransfer.findUnique({ where: { id: transfer.id } })).status).toBe("APPROVED");
    expect((await call({ action: "DISPATCH", transferId: transfer.id })).status).toBe(200);
    expect((await balances()).transit).toBe(10);
  });
});

