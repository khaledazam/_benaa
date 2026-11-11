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

const state = vi.hoisted(() => ({ db: null as any, session: null as any, providerSession: null as any }));
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


vi.mock("@/lib/stripe", () => ({ getStripe: () => ({ checkout: { sessions: { retrieve: async () => state.providerSession } } }) }));
vi.mock("@/lib/cache", () => ({ invalidateOnOrderChange: vi.fn(async () => undefined) }));
import { confirmCheckoutSessionById } from "@/lib/payments/confirm-checkout-session";

beforeEach(async () => {
  await state.db.stockLocationAllocation.deleteMany({});
  await state.db.warehouseBin.deleteMany({});
  await state.db.inventoryBatch.deleteMany({});
  state.providerSession = null;
});

function failOperationMarker(db: any, keyPrefix: string) {
  return new Proxy(db, { get(target, prop) {
    if (prop === "$transaction") return (work: any, options: any) => target.$transaction((tx: any) => work(new Proxy(tx, { get(t, p) {
      if (p === "inventoryOperation") return { ...t.inventoryOperation, create: async (input: any) => {
        if (input.data.operationKey.startsWith(keyPrefix)) throw new Error("isolated final marker failure");
        return t.inventoryOperation.create(input);
      } };
      return t[p];
    } })), options);
    const value = target[prop]; return typeof value === "function" ? value.bind(target) : value;
  } });
}
async function verifyFulfillmentRollback(order: any, invoice: any) {
  expect((await state.db.product.findUnique({ where: { id: product.id } })).quantity).toBe(500);
  const allocation = await state.db.stockAllocation.findUnique({ where: { productId_warehouseId: { productId: product.id, warehouseId: warehouses[0].id } } });
  expect(allocation.quantity).toBe(100); expect(allocation.reservedQuantity).toBe(10);
  const after = await state.db.order.findUnique({ where: { id: order.id } });
  expect(after.status).toBe("pending"); expect(after.paymentStatus).toBe("unpaid");
  expect(await state.db.stockMovement.count()).toBe(0);
  expect(await state.db.inventoryOperation.findUnique({ where: { operationKey: `order-fulfillment:${order.id}` } })).toBeNull();
  expect((await state.db.invoice.findUnique({ where: { id: invoice.id } })).amountPaid).toBe(40);
}

describe("Independent financial atomicity and identity review", () => {
  it("last fulfillment marker failure rolls back stock/reservations/status while retaining recorded money", async () => {
    const { invoice, order } = await invoiceFixture(); await pay(invoice, "pi_review_late");
    const db = state.db; state.db = failOperationMarker(db, "order-fulfillment:");
    try { await expect(recoverPaymentFulfillment(state.db, invoice.id)).rejects.toThrow("isolated final marker failure"); } finally { state.db = db; }
    await verifyFulfillmentRollback(order, invoice);
    expect((await recoverPaymentFulfillment(state.db, invoice.id)).stockFulfilled).toBe(true);
    expect(await db.stockMovement.count()).toBe(1);
  });
  it("last payment marker failure rolls back invoice money and provider identity together", async () => {
    const { invoice, order } = await invoiceFixture();
    const db = state.db; state.db = failOperationMarker(db, "stripe-payment:");
    try { await expect(pay(invoice, "pi_review_money")).rejects.toThrow("isolated final marker failure"); } finally { state.db = db; }
    const after = await db.invoice.findUnique({ where: { id: invoice.id } });
    expect(after.amountPaid).toBe(0); expect(after.amountDue).toBe(100); expect(after.stripePaymentIntentId).toBeNull();
    expect((await db.order.findUnique({ where: { id: order.id } })).stripePaymentIntentId).toBeNull();
    expect(await db.inventoryOperation.count()).toBe(0);
  });
  it("first charge without invoice preserves original totals and issuer then duplicate applies once", async () => {
    const { order, invoice } = await invoiceFixture(); await state.db.invoice.delete({ where: { id: invoice.id } });
    await state.db.order.update({ where: { id: order.id }, data: { subtotal: 100, tax: 15, shipping: 7, discount: 2, total: 120 } });
    const body = { orderId: order.id, paymentIntentId: "pi_review_first", chargeAmount: 40 };
    const response = await recordVerifiedPayment(state.db, body);
    expect((await recordVerifiedPayment(state.db, body)).alreadyApplied).toBe(true);
    const created = await state.db.invoice.findUnique({ where: { id: response.invoiceId } });
    expect(created).toMatchObject({ orderId: order.id, userId: fixtureId, createdBy: fixtureId, subtotal: 100, tax: 15, shipping: 7, discount: 2, total: 120, amountPaid: 40, amountDue: 80 });
    expect(await state.db.invoice.count()).toBe(1);
    expect((await recoverPaymentFulfillment(state.db, created.id)).stockFulfilled).toBe(true);
    expect(await state.db.stockMovement.count()).toBe(1);
  });
  it("invoice creation and money roll back if no-invoice first charge marker fails", async () => {
    const { order, invoice } = await invoiceFixture(); await state.db.invoice.delete({ where: { id: invoice.id } });
    const db = state.db; state.db = failOperationMarker(db, "stripe-payment:");
    try { await expect(recordVerifiedPayment(state.db, { orderId: order.id, paymentIntentId: "pi_review_createfail", chargeAmount: 40 })).rejects.toThrow("isolated final marker failure"); } finally { state.db = db; }
    expect(await db.invoice.count()).toBe(0);
    expect((await db.order.findUnique({ where: { id: order.id } })).stripePaymentIntentId).toBeNull();
    expect(await db.inventoryOperation.count()).toBe(0);
  });
  it("cross-invoice duplicate provider event cannot allocate money twice", async () => {
    const first = await invoiceFixture(); const second = await invoiceFixture();
    await pay(first.invoice, "pi_review_cross", 40);
    await expect(pay(second.invoice, "pi_review_cross", 40)).rejects.toThrow("different reference or amount");
    expect((await state.db.invoice.findUnique({ where: { id: first.invoice.id } })).amountPaid).toBe(40);
    expect((await state.db.invoice.findUnique({ where: { id: second.invoice.id } })).amountPaid).toBe(0);
    expect(await state.db.inventoryOperation.count()).toBe(1);
  });
  it("cancellation after recorded money blocks fulfillment and preserves both financial states", async () => {
    const { order, invoice } = await invoiceFixture(); await pay(invoice, "pi_review_cancelrace");
    await state.db.order.update({ where: { id: order.id }, data: { status: "cancelled" } });
    await expect(recoverPaymentFulfillment(state.db, invoice.id)).rejects.toThrow();
    expect((await state.db.order.findUnique({ where: { id: order.id } })).status).toBe("cancelled");
    expect((await state.db.invoice.findUnique({ where: { id: invoice.id } })).amountPaid).toBe(40);
    expect(await state.db.stockMovement.count()).toBe(0);
  });
  it.each(["BIN", "BATCH"])("legacy %s line lacking allocation identity rejects without stock success", async tracking => {
    const { order, invoice } = await invoiceFixture();
    if (tracking === "BATCH") await state.db.product.update({ where: { id: product.id }, data: { trackingMode: "BATCH" } });
    else {
      const bin = await state.db.warehouseBin.create({ data: { shelfId: fixtureId, warehouseId: warehouses[0].id, code: "FIN-REVIEW-BIN", name: "Financial review bin" } });
      await state.db.stockLocationAllocation.create({ data: { productId: product.id, warehouseId: warehouses[0].id, binId: bin.id, quantity: 100, quantityInBaseUnit: 100 } });
    }
    await pay(invoice, `pi_review_${tracking}`);
    await expect(recoverPaymentFulfillment(state.db, invoice.id)).rejects.toThrow();
    await verifyFulfillmentRollback(order, invoice);
  });
  it("browser confirmation cannot return successful stock fulfillment after failure", async () => {
    const { order, invoice } = await invoiceFixture();
    await state.db.stockAllocation.update({ where: { productId_warehouseId: { productId: product.id, warehouseId: warehouses[0].id } }, data: { quantity: 5 } });
    state.providerSession = { payment_status: "paid", payment_intent: "pi_review_browser", amount_total: 4000, metadata: { type: "invoice", invoiceId: invoice.id, chargeAmount: "40" } };
    await expect(confirmCheckoutSessionById("cs_isolated_review")).rejects.toThrow();
    expect((await state.db.invoice.findUnique({ where: { id: invoice.id } })).amountPaid).toBe(40);
    expect((await state.db.order.findUnique({ where: { id: order.id } })).status).toBe("pending");
    expect(await state.db.stockMovement.count()).toBe(0);
  });
  it("invoice/order reference mismatch rejects without allocating money to the wrong order", async () => {
    const first = await invoiceFixture(); const second = await invoiceFixture();
    await expect(recordVerifiedPayment(state.db, { invoiceId: first.invoice.id, orderId: second.order.id, paymentIntentId: "pi_review_wrongorder", chargeAmount: 40 })).rejects.toThrow();
    expect((await state.db.invoice.findUnique({ where: { id: first.invoice.id } })).amountPaid).toBe(0);
    expect((await state.db.order.findUnique({ where: { id: second.order.id } })).stripePaymentIntentId).toBeNull();
  });
});

it("invalid historical invoice money blocks charge allocation before any marker or identity write", async () => {
  const { order, invoice } = await invoiceFixture();
  await state.db.invoice.update({ where: { id: invoice.id }, data: { total: -100, amountPaid: -1, amountDue: -99 } });
  await expect(pay(invoice, "pi_review_invalidmoney")).rejects.toThrow();
  const after = await state.db.invoice.findUnique({ where: { id: invoice.id } });
  expect(after.total).toBe(-100); expect(after.amountPaid).toBe(-1); expect(after.amountDue).toBe(-99);
  expect(after.stripePaymentIntentId).toBeNull();
  expect((await state.db.order.findUnique({ where: { id: order.id } })).stripePaymentIntentId).toBeNull();
  expect(await state.db.inventoryOperation.count()).toBe(0);
});
