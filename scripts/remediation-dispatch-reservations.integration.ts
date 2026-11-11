import { isolatedTestMongod } from "./isolated-test-mongod";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { PrismaClient } from "@prisma/client";
import { NextRequest } from "next/server";
import path from "node:path";
import fs from "node:fs";
const state = vi.hoisted(() => ({ db: null as any, session: null as any }));
vi.mock("@/prisma/client", () => ({ prisma: new Proxy({}, { get: (_, key) => { const value = state.db[key]; return typeof value === "function" ? value.bind(state.db) : value; } }) }));
vi.mock("@/utils/auth", () => ({ getSessionFromRequest: async () => state.db.user.findUnique({ where: { id: fixtureId } }) }));
vi.mock("@/lib/cache/post-mutation", () => ({ scheduleInvalidateStockAllocationCaches: vi.fn(async () => undefined) }));
import { POST as salesPost } from "@/app/api/sales-orders/route";
import { postDispatch, cancelDispatch } from "@/lib/dispatch/dispatchService";
import { createStockReservation, cancelReservation, releaseReservation, getAvailableStock } from "@/lib/reservations/reservationService";
let replica: MongoMemoryReplSet | undefined;
let warehouses: any[] = [];
let product: any;
const fixtureId = "100000000000000000000001";
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
  await state.db.customer.create({ data: { id: fixtureId, customerCode: "RELEASE-AUDIT", name: "Synthetic customer", active: true, createdBy: fixtureId } });
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
  await state.db.inventoryOperation.deleteMany({});
  for (const model of ["stockMovement", "dispatchBinAllocation", "dispatchItem", "dispatch", "pickList", "stockReservationItem", "stockReservation", "salesOrderItem", "salesOrder", "stockLocationAllocation", "warehouseBin", "stockAllocation"]) await state.db[model].deleteMany({});
  await state.db.product.update({ where: { id: product.id }, data: { quantity: 100, unitId: null, trackingMode: "NONE" } });
  await state.db.stockAllocation.create({ data: { productId: product.id, warehouseId: warehouses[0].id, quantity: 100, reservedQuantity: 0, userId: fixtureId } });
});
let seq = 0;
async function order(quantities: number[]) {
  return state.db.salesOrder.create({ data: { salesOrderNumber: "SO-" + ++seq, customerId: fixtureId, warehouseId: warehouses[0].id, status: "APPROVED", createdBy: fixtureId,
    items: { create: quantities.map(quantity => ({ productId: product.id, productName: product.name, orderedQuantity: quantity, unitPrice: 10, lineTotal: quantity * 10 })) } }, include: { items: true } });
}
async function dispatchFixture(amount = 10, allocations = [10], orderQuantities = [20]) {
  const so = await order(orderQuantities);
  const reservation = await createStockReservation(so.id, fixtureId);
  const pick = await state.db.pickList.create({ data: { pickListNumber: "PICK-" + ++seq, salesOrderId: so.id, reservationId: reservation.id, warehouseId: warehouses[0].id, status: "COMPLETED", createdBy: fixtureId } });
  const bin = await state.db.warehouseBin.create({ data: { shelfId: fixtureId, warehouseId: warehouses[0].id, code: "BIN-" + ++seq, name: "Isolated bin" } });
  await state.db.stockLocationAllocation.create({ data: { productId: product.id, warehouseId: warehouses[0].id, binId: bin.id, quantity: 100, quantityInBaseUnit: 100 } });
  const dispatch = await state.db.dispatch.create({ data: { dispatchNumber: "DSP-" + ++seq, salesOrderId: so.id, pickListId: pick.id, warehouseId: warehouses[0].id, createdBy: fixtureId,
    items: { create: { salesOrderItemId: so.items[0].id, pickListItemId: fixtureId, productId: product.id, productName: product.name, requestedQuantity: amount, pickedQuantity: Math.max(amount, 1), dispatchedQuantity: amount,
      binAllocations: { create: allocations.map(quantity => ({ binId: bin.id, productId: product.id, dispatchedQuantity: quantity })) } } } }, include: { items: { include: { binAllocations: true } } } });
  return { so, reservation, dispatch, bin };
}
async function assertBalances(expected: number, ledger: number) {
  expect((await state.db.product.findUnique({ where: { id: product.id } })).quantity).toBe(expected);
  expect((await state.db.stockAllocation.findFirst({ where: { productId: product.id } })).quantity).toBe(expected);
  expect((await state.db.stockLocationAllocation.findFirst({ where: { productId: product.id } })).quantity).toBe(expected);
  expect(await state.db.stockMovement.count()).toBe(ledger);
}
describe("Correct isolated dispatch and reservation outcomes", () => {
  it("rejects aggregated duplicate-product demand without creating reservations", async () => {
    const so = await order([60, 60]);
    await expect(createStockReservation(so.id, fixtureId)).rejects.toThrow("Insufficient available");
    expect(await state.db.stockReservation.count()).toBe(0);
    expect((await getAvailableStock(product.id, warehouses[0].id)).availableStock).toBe(100);
  });
  it("serializes competing reservations against physical availability", async () => {
    const orders = await Promise.all([order([60]), order([60])]);
    const results = await Promise.allSettled(orders.map(so => createStockReservation(so.id, fixtureId)));
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect((await getAvailableStock(product.id, warehouses[0].id)).availableStock).toBe(40);
  });
  it("retries reservation creation idempotently for same order", async () => {
    const so = await order([20]);
    const values = await Promise.all([createStockReservation(so.id, fixtureId), createStockReservation(so.id, fixtureId)]);
    expect(values[0].id).toBe(values[1].id); expect(await state.db.stockReservation.count()).toBe(1);
  });
  it("includes transfer reservations in sales availability", async () => {
    await state.db.stockAllocation.updateMany({ data: { reservedQuantity: 80 } });
    const so = await order([21]); await expect(createStockReservation(so.id, fixtureId)).rejects.toThrow("Insufficient available");
    expect((await getAvailableStock(product.id, warehouses[0].id)).availableStock).toBe(20);
  });
  it.each([{ allocations: [] }, { allocations: [5] }, { allocations: [11] }, { allocations: [-1, 11] }, { allocations: [0, 10] }])("rejects invalid allocation amounts %s and rolls back all writes", async ({ allocations }) => {
    const f = await dispatchFixture(10, allocations);
    await expect(postDispatch(f.dispatch.id, fixtureId)).rejects.toThrow();
    await assertBalances(100, 0);
    expect((await state.db.dispatch.findUnique({ where: { id: f.dispatch.id } })).status).toBe("DRAFT");
    expect((await state.db.stockReservationItem.findFirst()).remainingQuantity).toBe(20);
  });
  it("counts current dispatch once and completes only at full line fulfillment", async () => {
    const f = await dispatchFixture(10, [10]); await postDispatch(f.dispatch.id, fixtureId);
    await assertBalances(90, 1);
    expect((await state.db.salesOrder.findUnique({ where: { id: f.so.id } })).status).toBe("PROCESSING");
    expect((await state.db.stockReservationItem.findFirst()).remainingQuantity).toBe(10);
  });
  it("does not fulfill another sales line with the same product", async () => {
    const f = await dispatchFixture(10, [10], [10, 10]); await postDispatch(f.dispatch.id, fixtureId);
    expect((await state.db.salesOrder.findUnique({ where: { id: f.so.id } })).status).toBe("PROCESSING");
    const items = await state.db.stockReservationItem.findMany();
    expect(items.find((i: any) => i.salesOrderItemId === f.so.items[1].id).remainingQuantity).toBe(10);
    await assertBalances(90, 1);
  });
  it("concurrent duplicate dispatches deduct exactly once", async () => {
    const f = await dispatchFixture(10, [10]);
    const results = await Promise.all([postDispatch(f.dispatch.id, fixtureId), postDispatch(f.dispatch.id, fixtureId)]);
    expect(results.every(d => d.status === "POSTED")).toBe(true); await assertBalances(90, 1);
  });
  it("rejects cross-warehouse bin scope", async () => {
    const f = await dispatchFixture(); await state.db.warehouseBin.update({ where: { id: f.bin.id }, data: { warehouseId: warehouses[1].id } });
    await expect(postDispatch(f.dispatch.id, fixtureId)).rejects.toThrow(); await assertBalances(100, 0);
  });
  it("rejects excessive releases and cancellation frees only reservations", async () => {
    const f = await dispatchFixture();
    const item = await state.db.stockReservationItem.findFirst();
    await expect(releaseReservation(f.reservation.id, { releasedQuantities: { [item.id]: 21 } }, fixtureId)).rejects.toThrow();
    await cancelReservation(f.reservation.id, "isolated", fixtureId);
    expect((await getAvailableStock(product.id, warehouses[0].id)).availableStock).toBe(100);
    await assertBalances(100, 0);
  });
  it("normalizes aggregated reservation demand to product base units", async () => {
    const piece = await state.db.unit.create({ data: { name: "Pieces", code: "PC" + ++seq, symbol: "pc", type: "count", active: true } });
    const box = await state.db.unit.create({ data: { name: "Boxes", code: "BOX" + ++seq, symbol: "box", type: "count", active: true } });
    await state.db.unitConversion.create({ data: { productId: product.id, fromUnitId: box.id, toUnitId: piece.id, factor: 10 } });
    await state.db.product.update({ where: { id: product.id }, data: { unitId: piece.id } });
    const so = await order([6, 5]); await state.db.salesOrderItem.updateMany({ where: { salesOrderId: so.id }, data: { unitId: box.id } });
    await expect(createStockReservation(so.id, fixtureId)).rejects.toThrow("Insufficient available");
    await state.db.salesOrderItem.updateMany({ where: { salesOrderId: so.id }, data: { orderedQuantity: 2 } });
    await createStockReservation(so.id, fixtureId);
    const balance = await getAvailableStock(product.id, warehouses[0].id);
    expect(balance.reservedStock).toBe(40); expect(balance.availableStock).toBe(60);
  });
  it("reconciles mixed dispatch/bin units in base stock and ledger", async () => {
    const f = await dispatchFixture(20, [20], [20]);
    const piece = await state.db.unit.create({ data: { name: "Pieces", code: "PC" + ++seq, symbol: "pc", type: "count", active: true } });
    const box = await state.db.unit.create({ data: { name: "Boxes", code: "BOX" + ++seq, symbol: "box", type: "count", active: true } });
    await state.db.unitConversion.create({ data: { productId: product.id, fromUnitId: box.id, toUnitId: piece.id, factor: 10 } });
    await state.db.product.update({ where: { id: product.id }, data: { unitId: piece.id } });
    await state.db.dispatchItem.update({ where: { id: f.dispatch.items[0].id }, data: { unitId: box.id, dispatchedQuantity: 2, pickedQuantity: 2 } });
    await state.db.dispatchBinAllocation.updateMany({ where: { dispatchItemId: f.dispatch.items[0].id }, data: { unitId: piece.id } });
    await postDispatch(f.dispatch.id, fixtureId); await assertBalances(80, 1);
    expect((await state.db.stockMovement.findFirst()).quantity).toBe(20);
    expect((await state.db.salesOrder.findUnique({ where: { id: f.so.id } })).status).toBe("COMPLETED");
    expect((await state.db.stockReservationItem.findFirst()).remainingQuantity).toBe(0);
  });
  it("rejects foreign-product batch and reconciles valid batch ledger", async () => {
    const f = await dispatchFixture(10, [10], [10]);
    const batch = await state.db.inventoryBatch.create({ data: { productId: fixtureId, warehouseId: warehouses[0].id, batchNumber: "BAT" + ++seq, quantity: 100, reservedQuantity: 0, status: "ACTIVE" } });
    await state.db.dispatchItem.update({ where: { id: f.dispatch.items[0].id }, data: { batchId: batch.id } });
    await expect(postDispatch(f.dispatch.id, fixtureId)).rejects.toThrow("Invalid dispatch batch"); await assertBalances(100, 0);
    await state.db.inventoryBatch.update({ where: { id: batch.id }, data: { productId: product.id, reservedQuantity: 10 } });
    await state.db.stockReservationItem.updateMany({ where: { reservationId: f.reservation.id }, data: { batchId: batch.id } });
    await state.db.product.update({ where: { id: product.id }, data: { trackingMode: "BATCH" } });
    await postDispatch(f.dispatch.id, fixtureId); await assertBalances(90, 1);
    expect((await state.db.inventoryBatch.findUnique({ where: { id: batch.id } })).quantity).toBe(90);
    expect((await state.db.inventoryBatch.findUnique({ where: { id: batch.id } })).reservedQuantity).toBe(0);
    expect((await state.db.stockMovement.findFirst()).batchId).toBe(batch.id);
  });

  it("retains sub-cent reservation precision during partial release", async () => {
    const so = await order([0.123]); const reservation = await createStockReservation(so.id, fixtureId);
    const item = reservation.items[0];
    await releaseReservation(reservation.id, { releasedQuantities: { [item.id]: 0.003 } }, fixtureId);
    const after = await state.db.stockReservationItem.findUnique({ where: { id: item.id } });
    expect(after.remainingQuantity).toBeCloseTo(0.12, 9); expect(after.releasedQuantity).toBeCloseTo(0.003, 9);
    expect(after.remainingQuantity + after.releasedQuantity).toBeCloseTo(0.123, 9);
    expect((await getAvailableStock(product.id, warehouses[0].id)).availableStock).toBeCloseTo(99.88, 9);
  });
  it("serializes cancellation racing posting without disappearing shipped stock", async () => {
    const f = await dispatchFixture();
    await Promise.allSettled([postDispatch(f.dispatch.id, fixtureId), cancelDispatch(f.dispatch.id, "isolated race", fixtureId)]);
    const result = await state.db.dispatch.findUnique({ where: { id: f.dispatch.id } });
    expect(["POSTED", "CANCELLED"]).toContain(result.status);
    await assertBalances(result.status === "POSTED" ? 90 : 100, result.status === "POSTED" ? 1 : 0);
  });

  it("serializes commitments in different warehouses against the global product cap", async () => {
    await state.db.stockAllocation.create({ data: { productId: product.id, warehouseId: warehouses[1].id, quantity: 100, reservedQuantity: 0, userId: fixtureId } });
    const first = await order([60]); const second = await order([60]);
    await state.db.salesOrder.update({ where: { id: second.id }, data: { warehouseId: warehouses[1].id } });
    const results = await Promise.allSettled([createStockReservation(first.id, fixtureId), createStockReservation(second.id, fixtureId)]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(await state.db.stockReservation.count()).toBe(1);
    expect((await getAvailableStock(product.id, warehouses[0].id)).availableStock).toBe(40);
    expect((await getAvailableStock(product.id, warehouses[1].id)).availableStock).toBe(40);
  });

});


describe("Release recovery explicit dispatch command identity", () => {
  it("concurrent keyed replay commits one receipt and rejects a changed document payload", async () => {
    const f = await dispatchFixture(10, [10]);
    const key = "release-recovery-key";
    const replies = await Promise.all(Array.from({ length: 8 }, () => postDispatch(f.dispatch.id, fixtureId, key)));
    expect(new Set(replies.map(r => r.id)).size).toBe(1);
    expect(replies.every(r => r.status === "POSTED")).toBe(true);
    expect(await state.db.dispatch.count({ where: { status: "POSTED" } })).toBe(1);
    expect(await state.db.inventoryOperation.count({ where: { operationKey: `dispatch-post:${fixtureId}:${key}` } })).toBe(1);
    expect(await state.db.stockMovement.count({ where: { referenceId: f.dispatch.id, movementType: "SALE" } })).toBe(1);
    expect((await state.db.product.findUnique({ where: { id: product.id } })).quantity).toBe(90);
    expect((await getAvailableStock(product.id, warehouses[0].id)).physicalStock).toBe(90);
    const changed = await dispatchFixture(5, [5], [5]);
    await expect(postDispatch(changed.dispatch.id, fixtureId, key)).rejects.toThrow("Idempotency key payload conflict");
    expect((await state.db.dispatch.findUnique({ where: { id: changed.dispatch.id } })).status).toBe("DRAFT");
    expect(await state.db.stockMovement.count({ where: { referenceId: changed.dispatch.id } })).toBe(0);
  });
});


describe("Atomic customer sales draft API", () => {
  function payload(lines = [1.25, 2.5]) {
    return { customerId: fixtureId, warehouseId: warehouses[0].id,
      discount: 1, tax: 2,
      items: lines.map(orderedQuantity => ({ productId: product.id, orderedQuantity, unitPrice: 10, discount: 0, tax: 0 })) };
  }
  const submit = (body: any, key = "sales-draft-key") => salesPost(new NextRequest("http://127.0.0.1/api/sales-orders", {
    method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": key }, body: JSON.stringify(body),
  }));
  it("creates fractional repeated-SKU lines and audit atomically without physical deductions", async () => {
    const response = await submit(payload()); expect(response.status).toBe(201);
    const order = await response.json();
    expect(order.items).toHaveLength(2); expect(order.subtotal).toBe(37.5); expect(order.total).toBe(38.5);
    expect(await state.db.salesOrder.count()).toBe(1);
    expect(await state.db.stockMovement.count()).toBe(0);
    expect((await state.db.product.findUnique({ where: { id: product.id } })).quantity).toBe(100);
    expect(await state.db.auditLog.count({ where: { action: "sales_order_created", entityId: order.id } })).toBe(1);
    expect(await state.db.invoice.count()).toBe(0);
  });
  it("concurrent identical submissions return one persisted order and one receipt", async () => {
    const replies = await Promise.all(Array.from({ length: 8 }, () => submit(payload())));
    expect(replies.map(r => r.status)).toEqual(Array(8).fill(201));
    const bodies = await Promise.all(replies.map(r => r.json()));
    expect(new Set(bodies.map(b => b.id)).size).toBe(1);
    expect(await state.db.salesOrder.count()).toBe(1);
    expect(await state.db.inventoryOperation.count({ where: { operationKey: `sales-order-create:${fixtureId}:sales-draft-key` } })).toBe(1);
  });
  it("rejects key reuse with changed quantities", async () => {
    expect((await submit(payload())).status).toBe(201);
    expect((await submit(payload([3]))).status).toBe(409);
    expect(await state.db.salesOrder.count()).toBe(1);
  });
  it.each([0, -1, 0.0000001])("rejects invalid base quantity %s without partial documents", async quantity => {
    expect((await submit(payload([quantity]))).status).toBe(400);
    expect(await state.db.salesOrder.count()).toBe(0);
  });
  it("reauthorizes warehouse reassignment even for an identical replay", async () => {
    expect((await submit(payload())).status).toBe(201);
    await state.db.user.update({ where: { id: fixtureId }, data: { role: "WAREHOUSE_MANAGER", warehouseIds: [warehouses[1].id], primaryWarehouseId: warehouses[1].id } });
    try { expect((await submit(payload())).status).toBe(403); }
    finally { await state.db.user.update({ where: { id: fixtureId }, data: { role: "SUPER_ADMIN", warehouseIds: [], primaryWarehouseId: null } }); }
  });
  it("rolls back header, items and command receipt if audit insertion fails", async () => {
    const original = state.db;
    state.db = new Proxy(original, { get(target, key) {
      if (key === "$transaction") return (work: any, options: any) => target.$transaction((tx: any) => work(new Proxy(tx, { get(inner, model) {
        if (model === "auditLog") return { create: async () => { throw new Error("Injected audit failure"); } };
        return inner[model];
      } })), options);
      const value = target[key]; return typeof value === "function" ? value.bind(target) : value;
    } });
    try { expect((await submit(payload())).status).toBe(400); }
    finally { state.db = original; }
    expect(await state.db.salesOrder.count()).toBe(0);
    expect(await state.db.salesOrderItem.count()).toBe(0);
    expect(await state.db.inventoryOperation.count({ where: { operationKey: `sales-order-create:${fixtureId}:sales-draft-key` } })).toBe(0);
    expect((await state.db.product.findUnique({ where: { id: product.id } })).quantity).toBe(100);
  });
});


describe("Dispatch replay current authorization", () => {
  it("rejects an already-successful keyed replay after warehouse reassignment or suspension", async () => {
    const f = await dispatchFixture(10, [10]);
    await postDispatch(f.dispatch.id, fixtureId, "authorization-replay");
    try {
      await state.db.user.update({ where: { id: fixtureId }, data: { role: "STOREKEEPER", warehouseIds: [warehouses[1].id], primaryWarehouseId: warehouses[1].id } });
      await expect(postDispatch(f.dispatch.id, fixtureId, "authorization-replay")).rejects.toThrow("Forbidden inventory posting");
      await state.db.user.update({ where: { id: fixtureId }, data: { role: "SUPER_ADMIN", status: false } });
      await expect(postDispatch(f.dispatch.id, fixtureId, "authorization-replay")).rejects.toThrow("Forbidden inventory posting");
    } finally { await state.db.user.update({ where: { id: fixtureId }, data: { role: "SUPER_ADMIN", status: true, warehouseIds: [], primaryWarehouseId: null } }); }
    expect(await state.db.stockMovement.count({ where: { referenceId: f.dispatch.id } })).toBe(1);
    expect((await state.db.product.findUnique({ where: { id: product.id } })).quantity).toBe(90);
  });
});
