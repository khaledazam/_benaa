import { isolatedTestMongod } from "./isolated-test-mongod";
/** Explicit opt-in, disposable replica only. Does not import .env or prisma/client.
 * Run: vitest run --config vitest.audit.config.ts
 * Passing defect characterizations document blockers, not production correctness.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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



import { executeStockMutation, executeStockTransfer, executeStockRelocation } from "@/lib/inventory/stockService";
import { getStockAvailabilityInTx } from "@/lib/inventory/availability";

beforeEach(async () => {
  await state.db.product.update({ where: { id: product.id }, data: { unitId: null, trackingMode: "NONE", reservedQuantity: 0 } });
  await state.db.stockLocationAllocation.deleteMany({});
  await state.db.warehouseBin.deleteMany({});
  await state.db.inventoryBatch.deleteMany({});
  await state.db.unitConversion.deleteMany({});
  await state.db.unit.deleteMany({});
});
const mutate = (extra: any = {}) => executeStockMutation({ productId: product.id, warehouseId: warehouses[0].id, performedBy: fixtureId, quantity: 10, movementType: "ADJUSTMENT_OUT", ...extra });
async function bins() {
  const currentProduct = await state.db.product.findUnique({ where: { id: product.id } });
  const source = await state.db.warehouseBin.create({ data: { shelfId: fixtureId, warehouseId: warehouses[0].id, code: "SHARED-SRC", name: "Source" } });
  const target = await state.db.warehouseBin.create({ data: { shelfId: fixtureId, warehouseId: warehouses[0].id, code: "SHARED-DST", name: "Destination" } });
  await state.db.stockLocationAllocation.create({ data: { productId: product.id, warehouseId: warehouses[0].id, binId: source.id, quantity: 100, quantityInBaseUnit: 100, unitId: currentProduct.unitId } });
  return { source, target };
}
afterEach(async () => {
  const allocations = await state.db.stockAllocation.findMany({ where: { productId: product.id } });
  const movements = await state.db.stockMovement.findMany({ where: { productId: product.id } });
  const transfers = await state.db.stockTransfer.findMany({ where: { productId: product.id } });
  const incoming = ["OPENING_BALANCE", "PURCHASE", "TRANSFER_IN", "CUSTOMER_RETURN", "ADJUSTMENT_IN", "FOUND"];
  for (const allocation of allocations) {
    const delta = movements.filter((m: any) => m.warehouseId === allocation.warehouseId).reduce((s: number, m: any) => s + (m.movementType === "RELOCATION" ? 0 : incoming.includes(m.movementType) ? m.quantityInBaseUnit : -m.quantityInBaseUnit), 0);
    expect(allocation.quantity).toBeCloseTo(100 + delta, 8);
  }
  const physical = allocations.reduce((s: number, a: any) => s + a.quantity, 0);
  expect((await state.db.product.findUnique({ where: { id: product.id } })).quantity).toBeCloseTo(physical, 8);
  const adjustmentDelta = movements.filter((m: any) => !["TRANSFER_OUT", "TRANSFER_IN", "RELOCATION"].includes(m.movementType)).reduce((s: number, m: any) => s + (incoming.includes(m.movementType) ? m.quantityInBaseUnit : -m.quantityInBaseUnit), 0);
  expect(physical + transfers.reduce((s: number, t: any) => s + t.inTransitQuantity, 0)).toBeCloseTo(500 + adjustmentDelta, 8);
});
async function assertBinSum() {
  const alloc = await state.db.stockAllocation.findUnique({ where: { productId_warehouseId: { productId: product.id, warehouseId: warehouses[0].id } } });
  const locations = await state.db.stockLocationAllocation.findMany({ where: { productId: product.id, warehouseId: warehouses[0].id } });
  expect(locations.reduce((s: number, a: any) => s + a.quantityInBaseUnit, 0)).toBe(alloc.quantity);
  expect(locations.every((a: any) => a.quantity === a.quantityInBaseUnit && a.quantity >= 0)).toBe(true);
}

describe("Independent shared Phase2 stock correctness", () => {
  it("outbound adjustment cannot consume a transfer reservation", async () => {
    await ready(95);
    await expect(mutate()).rejects.toThrow();
    expect((await balances()).physical).toBe(500);
    expect(await state.db.stockMovement.count()).toBe(0);
    expect((await getStockAvailabilityInTx(state.db, product.id, warehouses[0].id)).availableStock).toBe(5);
  });
  it("global unallocated product reservation constrains outbound in every warehouse", async () => {
    await state.db.product.update({ where: { id: product.id }, data: { reservedQuantity: 495 } });
    expect((await getStockAvailabilityInTx(state.db, product.id, warehouses[0].id)).availableStock).toBe(5);
    await expect(mutate()).rejects.toThrow();
    await mutate({ quantity: 5 });
    expect((await state.db.product.findUnique({ where: { id: product.id } })).quantity).toBe(495);
    expect((await getStockAvailabilityInTx(state.db, product.id, warehouses[1].id)).availableStock).toBe(0);
  });
  it("concurrent adjustments cannot consume committed transfer stock", async () => {
    await ready(80);
    const results = await Promise.allSettled(Array.from({ length: 10 }, () => mutate()));
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(2);
    const a = await state.db.stockAllocation.findUnique({ where: { productId_warehouseId: { productId: product.id, warehouseId: warehouses[0].id } } });
    expect(a.quantity).toBe(80); expect(a.reservedQuantity).toBe(80);
    expect(await state.db.stockMovement.count()).toBe(2);
  });
  it("bin adjustment keeps base/location/warehouse totals aligned", async () => {
    const { source } = await bins();
    await mutate({ sourceBinId: source.id, quantity: 0.000001 });
    await assertBinSum();
    await mutate({ destinationBinId: source.id, quantity: 0.000001, movementType: "ADJUSTMENT_IN" });
    await assertBinSum();
    expect((await balances()).physical).toBe(500);
  });
  it("ambiguous bin direction is rejected without allocating incoming stock to source", async () => {
    const { source, target } = await bins();
    await expect(mutate({ movementType: "ADJUSTMENT_IN", sourceBinId: source.id, destinationBinId: target.id })).rejects.toThrow();
    await assertBinSum();
    expect(await state.db.stockMovement.count()).toBe(0);
  });
  it("generic stock mutation cannot masquerade as relocation and reduce warehouse stock", async () => {
    const { source, target } = await bins();
    await expect(mutate({ movementType: "RELOCATION", sourceBinId: source.id, destinationBinId: target.id })).rejects.toThrow();
    expect((await balances()).physical).toBe(500);
    await assertBinSum();
  });
  it("direct transfer conserves warehouse/product totals and complete state", async () => {
    const result = await executeStockTransfer({ productId: product.id, fromWarehouseId: warehouses[0].id, toWarehouseId: warehouses[1].id, quantity: 10, performedBy: fixtureId });
    await balances();
    expect(result.transferRecord.status.toUpperCase()).toBe("COMPLETED");
    expect(result.transferRecord.receivedQuantity).toBe(10);
    expect(result.transferRecord.inTransitQuantity).toBe(0);
    expect(await state.db.stockMovement.count()).toBe(2);
  });
  it("direct tracked transfer without identity safely rejects without batch divergence", async () => {
    await state.db.product.update({ where: { id: product.id }, data: { trackingMode: "BATCH" } });
    await state.db.inventoryBatch.create({ data: { batchNumber: "SHARED-BATCH", productId: product.id, warehouseId: warehouses[0].id, quantity: 100 } });
    await expect(executeStockTransfer({ productId: product.id, fromWarehouseId: warehouses[0].id, toWarehouseId: warehouses[1].id, quantity: 10, performedBy: fixtureId })).rejects.toThrow();
    expect((await balances()).physical).toBe(500);
    expect(await state.db.stockMovement.count()).toBe(0);
  });
  it("central relocation moves bins exactly once per successful concurrent request", async () => {
    const { source, target } = await bins();
    const results = await Promise.allSettled(Array.from({ length: 20 }, () => executeStockRelocation({ productId: product.id, warehouseId: warehouses[0].id, fromBinId: source.id, toBinId: target.id, quantity: 10, performedBy: fixtureId })));
    const successes = results.filter(r => r.status === "fulfilled").length;
    expect(successes).toBeGreaterThan(0);
    expect(successes).toBeLessThanOrEqual(10);
    await assertBinSum();
    let destination = await state.db.stockLocationAllocation.findUnique({ where: { productId_binId: { productId: product.id, binId: target.id } } });
    expect(destination.quantity).toBe(successes * 10);
    expect(await state.db.stockMovement.count()).toBe(successes);
    for (let n = successes; n < 10; n++) await executeStockRelocation({ productId: product.id, warehouseId: warehouses[0].id, fromBinId: source.id, toBinId: target.id, quantity: 10, performedBy: fixtureId });
    destination = await state.db.stockLocationAllocation.findUnique({ where: { productId_binId: { productId: product.id, binId: target.id } } });
    expect(destination.quantity).toBe(100);
    expect((await balances()).physical).toBe(500);
    expect(await state.db.stockMovement.count()).toBe(10);
  });
  it("conversion uses base units consistently and rejects excess precision", async () => {
    const base = await state.db.unit.create({ data: { code: "SHARED-BASE", name: "Piece", symbol: "p", type: "count", isBaseUnit: true } });
    const box = await state.db.unit.create({ data: { code: "SHARED-BOX", name: "Box", symbol: "b", type: "count" } });
    await state.db.unitConversion.create({ data: { fromUnitId: box.id, toUnitId: base.id, productId: product.id, factor: 12 } });
    await state.db.product.update({ where: { id: product.id }, data: { unitId: base.id } });
    const { source } = await bins();
    await mutate({ unitId: box.id, sourceBinId: source.id, quantity: 2 });
    await assertBinSum();
    const loc = await state.db.stockLocationAllocation.findUnique({ where: { productId_binId: { productId: product.id, binId: source.id } } });
    expect(loc.quantity).toBe(76);
    expect(loc.unitId).toBe(base.id);
    await expect(mutate({ unitId: base.id, sourceBinId: source.id, quantity: 0.0000001 })).rejects.toThrow();
    expect(await state.db.stockMovement.count()).toBe(1);
  });
});

it.each([
  { movementType: "ADJUSTMENT_IN", direction: "sourceBinId" },
  { movementType: "ADJUSTMENT_OUT", direction: "destinationBinId" },
])("rejects wrong-direction bin for $movementType", async ({ movementType, direction }) => {
  const { source } = await bins();
  await expect(mutate({ movementType, [direction]: source.id })).rejects.toThrow();
  await assertBinSum();
  expect(await state.db.stockMovement.count()).toBe(0);
});

it("stock total cannot leave the supported safe quantity range after a valid increment", async () => {
  await expect(mutate({ movementType: "ADJUSTMENT_IN", quantity: 9007199254 })).rejects.toThrow();
  expect((await state.db.product.findUnique({ where: { id: product.id } })).quantity).toBe(500);
  expect(await state.db.stockMovement.count()).toBe(0);
});

it("generic tracked outbound adjustment cannot bypass batch accounting", async () => {
  await state.db.product.update({ where: { id: product.id }, data: { trackingMode: "BATCH" } });
  await state.db.inventoryBatch.create({ data: { batchNumber: "SHARED-BATCH-ADJUST", productId: product.id, warehouseId: warehouses[0].id, quantity: 100 } });
  await expect(mutate()).rejects.toThrow();
  expect(await state.db.stockMovement.count()).toBe(0);
  expect((await state.db.stockAllocation.findUnique({ where: { productId_warehouseId: { productId: product.id, warehouseId: warehouses[0].id } } })).quantity).toBe(100);
});

it("incoming tracked stock cannot silently promote a quarantined batch to active", async () => {
  await state.db.product.update({ where: { id: product.id }, data: { trackingMode: "BATCH" } });
  const batch = await state.db.inventoryBatch.create({ data: { batchNumber: "SHARED-BATCH-QUARANTINE", productId: product.id, warehouseId: warehouses[0].id, quantity: 100, status: "QUARANTINED" } });
  const result = await Promise.allSettled([mutate({ movementType: "ADJUSTMENT_IN", batchId: batch.id })]);
  const after = await state.db.inventoryBatch.findUnique({ where: { id: batch.id } });
  expect(after.status).toBe("QUARANTINED");
  expect(after.quantity).toBe(result[0].status === "fulfilled" ? 110 : 100);
});

it("direct tracked transfer updates batch balances and paired ledger identities", async () => {
  await state.db.product.update({ where: { id: product.id }, data: { trackingMode: "BATCH" } });
  const batch = await state.db.inventoryBatch.create({ data: { batchNumber: "SHARED-BATCH-DIRECT", productId: product.id, warehouseId: warehouses[0].id, quantity: 100 } });
  const result = await executeStockTransfer({ productId: product.id, fromWarehouseId: warehouses[0].id, toWarehouseId: warehouses[1].id, quantity: 10, performedBy: fixtureId, batchId: batch.id });
  const sourceAfter = await state.db.inventoryBatch.findUnique({ where: { id: batch.id } });
  const destination = await state.db.inventoryBatch.findFirst({ where: { productId: product.id, warehouseId: warehouses[1].id, batchNumber: batch.batchNumber } });
  expect(sourceAfter.quantity).toBe(90);
  expect(destination.quantity).toBe(10);
  const out = await state.db.stockMovement.findUnique({ where: { id: result.outResult.movementId } });
  const incoming = await state.db.stockMovement.findUnique({ where: { id: result.inResult.movementId } });
  expect(out.batchId).toBe(batch.id);
  expect(incoming.batchId).toBe(destination.id);
  expect(result.transferRecord.batchId).toBe(batch.id);
  expect(result.transferRecord.receivedQuantity).toBe(10);
  await balances();
});
