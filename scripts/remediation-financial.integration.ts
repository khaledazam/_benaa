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
import { recordVerifiedPayment, recoverPaymentFulfillment } from "@/lib/payments/payment-integrity";
import { applyIncrementalInvoicePayment } from "@/lib/payments/order-payment-from-amounts";

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
  for (const model of ["invoice", "orderItem", "order", "inventoryOperation", "stockMovement", "stockTransfer", "stockAllocation"]) await state.db[model].deleteMany({});
  await state.db.product.update({ where: { id: product.id }, data: { quantity: 500, reservedQuantity: 0, unitId: null, trackingMode: "NONE" } });
  for (const warehouse of warehouses) await state.db.stockAllocation.create({ data: { productId: product.id, warehouseId: warehouse.id, quantity: 100, reservedQuantity: 0, userId: fixtureId } });
});

async function invoiceFixture(status = "pending", global = false) {
  const order = await state.db.order.create({ data: { orderNumber: `ORDER-${++sequence}`, userId: fixtureId, createdBy: fixtureId,
    status, total: 100, subtotal: 100, items: { create: [{ productId: product.id, productName: "Audit Tile", quantity: 10,
      price: 10, subtotal: 100, warehouseId: global ? null : warehouses[0].id }] } } });
  const invoice = await state.db.invoice.create({ data: { invoiceNumber: `INV-${++sequence}`, orderId: order.id, userId: fixtureId,
    createdBy: fixtureId, status: "sent", subtotal: 100, total: 100, amountDue: 100, dueDate: new Date() } });
  if (global) await state.db.product.update({ where: { id: product.id }, data: { reservedQuantity: 10 } });
  else await state.db.stockAllocation.update({ where: { productId_warehouseId: { productId: product.id, warehouseId: warehouses[0].id } }, data: { reservedQuantity: 10 } });
  return { order, invoice };
}
const pay = (invoice: any, paymentIntentId: string, chargeAmount = 40) => recordVerifiedPayment(state.db, { invoiceId: invoice.id, paymentIntentId, chargeAmount });

describe("FIN01/FIN02 correct money and recoverable stock fulfillment", () => {
  it("preserves cancelled invoice state even when mathematically fully paid", async () => {
    expect(applyIncrementalInvoicePayment({ priorAmountPaid: 0, chargeAmount: 100, total: 100, priorStatus: "cancelled" }).status).toBe("cancelled");
    const { invoice } = await invoiceFixture();
    await state.db.invoice.update({ where: { id: invoice.id }, data: { status: "cancelled" } });
    await expect(pay(invoice, "pi_cancelled", 100)).rejects.toThrow("operator review");
    expect((await state.db.invoice.findUnique({ where: { id: invoice.id } })).amountPaid).toBe(0);
    expect(await state.db.stockMovement.count()).toBe(0);
  });
  it("persists money once, exposes stock failure, then retry recovers exactly once", async () => {
    const { invoice, order } = await invoiceFixture();
    await pay(invoice, "pi_retry");
    await state.db.stockAllocation.update({ where: { productId_warehouseId: { productId: product.id, warehouseId: warehouses[0].id } }, data: { quantity: 5 } });
    await expect(recoverPaymentFulfillment(state.db, invoice.id)).rejects.toThrow();
    expect((await state.db.order.findUnique({ where: { id: order.id } })).status).toBe("pending");
    expect(await state.db.stockMovement.count()).toBe(0);
    expect((await state.db.invoice.findUnique({ where: { id: invoice.id } })).amountPaid).toBe(40);
    expect((await pay(invoice, "pi_retry")).alreadyApplied).toBe(true);
    await state.db.stockAllocation.update({ where: { productId_warehouseId: { productId: product.id, warehouseId: warehouses[0].id } }, data: { quantity: 100 } });
    expect((await recoverPaymentFulfillment(state.db, invoice.id)).stockFulfilled).toBe(true);
    expect((await recoverPaymentFulfillment(state.db, invoice.id)).stockFulfilled).toBe(true);
    expect(await state.db.stockMovement.count()).toBe(1);
    expect((await state.db.product.findUnique({ where: { id: product.id } })).quantity).toBe(490);
    expect((await state.db.order.findUnique({ where: { id: order.id } })).paymentStatus).toBe("partial");
  });
  it("handles A then B then delayed A without duplicate money or stock", async () => {
    const { invoice } = await invoiceFixture();
    await pay(invoice, "pi_A", 30); await recoverPaymentFulfillment(state.db, invoice.id);
    await pay(invoice, "pi_B", 40); await recoverPaymentFulfillment(state.db, invoice.id);
    expect((await pay(invoice, "pi_A", 30)).alreadyApplied).toBe(true);
    await recoverPaymentFulfillment(state.db, invoice.id);
    const updated = await state.db.invoice.findUnique({ where: { id: invoice.id } });
    expect(updated.amountPaid).toBe(70); expect(updated.amountDue).toBe(30); expect(updated.status).toBe("sent");
    expect(await state.db.stockMovement.count()).toBe(1);
  });
  it("concurrent duplicate events and recovery commit one payment and one stock operation", async () => {
    const { invoice } = await invoiceFixture();
    await Promise.all(Array.from({ length: 20 }, async () => { await pay(invoice, "pi_parallel"); await recoverPaymentFulfillment(state.db, invoice.id); }));
    expect((await state.db.invoice.findUnique({ where: { id: invoice.id } })).amountPaid).toBe(40);
    expect(await state.db.stockMovement.count()).toBe(1);
    expect(await state.db.inventoryOperation.count()).toBe(2);
  });
  it("rejects reused event identity with a different amount", async () => {
    const { invoice } = await invoiceFixture(); await pay(invoice, "pi_mismatch", 40);
    await expect(pay(invoice, "pi_mismatch", 50)).rejects.toThrow("different reference or amount");
    expect((await state.db.invoice.findUnique({ where: { id: invoice.id } })).amountPaid).toBe(40);
  });
  it.each(["cancelled", "refunded"])("does not promote %s order or deduct stock", async condition => {
    const { invoice, order } = await invoiceFixture(condition === "cancelled" ? "cancelled" : "pending");
    if (condition === "refunded") await state.db.order.update({ where: { id: order.id }, data: { paymentStatus: "refunded" } });
    await expect(pay(invoice, "pi_terminal")).rejects.toThrow("operator review");
    expect(await state.db.stockMovement.count()).toBe(0);
    expect((await state.db.invoice.findUnique({ where: { id: invoice.id } })).amountPaid).toBe(0);
  });
  it("preserves existing largest-available warehouse allocation for global catalog lines", async () => {
    const { invoice } = await invoiceFixture("pending", true); await pay(invoice, "pi_global");
    expect((await recoverPaymentFulfillment(state.db, invoice.id)).stockFulfilled).toBe(true);
    const p = await state.db.product.findUnique({ where: { id: product.id } });
    expect(p.quantity).toBe(490); expect(p.reservedQuantity).toBe(0);
    expect((await state.db.stockAllocation.aggregate({ _sum: { quantity: true } }))._sum.quantity).toBe(490);
  });
  it("never blindly refulfills historical confirmed orders without completion evidence", async () => {
    const { invoice } = await invoiceFixture("confirmed"); await pay(invoice, "pi_history");
    await expect(recoverPaymentFulfillment(state.db, invoice.id)).rejects.toThrow("Historical fulfillment");
    expect(await state.db.stockMovement.count()).toBe(0);
  });
});


