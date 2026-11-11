import { isolatedTestMongod } from "./isolated-test-mongod";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { PrismaClient } from "@prisma/client";
import { NextRequest } from "next/server";
import path from "node:path";
import fs from "node:fs";
const state = vi.hoisted(() => ({ db: null as any, actorId: "100000000000000000000001", checkout: null as any }));
vi.mock("@/prisma/client", () => ({ prisma: new Proxy({}, { get: (_, key) => { const v = state.db[key]; return typeof v === "function" ? v.bind(state.db) : v; } }) }));
vi.mock("@/utils/auth", () => ({ getSessionFromRequest: async () => state.db.user.findUnique({ where: { id: state.actorId } }) }));
vi.mock("@/lib/auth-server", () => ({ getSession: async () => state.db.user.findUnique({ where: { id: state.actorId } }) }));
vi.mock("@/lib/cache", () => ({ scheduleInvalidateSupplierCaches: vi.fn(), scheduleInvalidateCategoryCaches: vi.fn(), scheduleInvalidateInvoiceCaches: vi.fn(), scheduleInvalidateOrderGraphCaches: vi.fn(), invalidateOnOrderChange: vi.fn(), invalidateOnProductChange: vi.fn(), invalidateOnSupplierChange: vi.fn(), invalidateOnCategoryChange: vi.fn(), scheduleInvalidateStockAllocationCaches: vi.fn(), scheduleAfterResponse: vi.fn(), invalidateCache: vi.fn(), getCache: vi.fn(async () => null), setCache: vi.fn(), cacheKeys: new Proxy({}, { get: () => ({ pattern: "isolated:*" }) }) }));
vi.mock("@/lib/cache/post-mutation", () => ({ scheduleInvalidateStockAllocationCaches: vi.fn(), scheduleInvalidateInvoiceCaches: vi.fn(), scheduleInvalidateSupplierCaches: vi.fn(), scheduleInvalidateCategoryCaches: vi.fn() }));
vi.mock("@/lib/api/rate-limit", () => ({ withRateLimit: vi.fn(async () => null), defaultRateLimits: { standard: {} } }));
vi.mock("@/lib/imagekit", () => ({ generateAndUploadQRCode: vi.fn(async () => { throw new Error("External media intentionally disabled in isolated acceptance"); }) }));
vi.mock("@/lib/email/notifications", () => ({ checkAndSendStockAlerts: vi.fn(async () => undefined), sendOrderConfirmation: vi.fn() }));
// Only the external provider is simulated. Orders, invoices, payment receipts,
// reservations, picking, dispatch and balances use real application handlers/Mongo.
vi.mock("@/lib/stripe", async importOriginal => ({ ...(await importOriginal<any>()), isStripeConfigured: () => true,
  getStripe: () => ({ checkout: { sessions: { retrieve: async () => state.checkout, create: async () => ({ id: "cs_synthetic_checkout", url: "https://checkout.stripe.test/isolated-only" }) } } }) }));
import { POST as createSale } from "@/app/api/orders/route";
import { POST as submitSale } from "@/app/api/sales-orders/[id]/submit/route";
import { POST as approveSale } from "@/app/api/sales-orders/[id]/approve/route";
import { POST as cancelSale } from "@/app/api/sales-orders/[id]/cancel/route";
import { POST as reserve } from "@/app/api/reservations/route";
import { POST as createPick } from "@/app/api/pick-lists/route";
import { POST as allocatePick } from "@/app/api/pick-lists/[id]/allocations/route";
import { POST as completePick } from "@/app/api/pick-lists/[id]/complete/route";
import { POST as createDispatch } from "@/app/api/dispatches/route";
import { POST as postDispatch } from "@/app/api/dispatches/[id]/post/route";
import { POST as issueInvoice } from "@/app/api/sales-orders/[id]/invoice/route";
import { GET as balance } from "@/app/api/customers/[id]/balance/route";
import { GET as invoiceGet, PUT as invoicePut, DELETE as invoiceDelete } from "@/app/api/invoices/[id]/route";
import { POST as checkoutPost } from "@/app/api/payments/checkout/route";
import { POST as confirmPayment } from "@/app/api/payments/confirm-session/route";
import { POST as supplierPost } from "@/app/api/suppliers/route";
import { POST as categoryPost } from "@/app/api/categories/route";
import { POST as unitPost } from "@/app/api/units/route";
import { POST as productPost } from "@/app/api/products/route";
import { POST as purchasePost } from "@/app/api/purchase-orders/route";
import { POST as purchaseSubmit } from "@/app/api/purchase-orders/[id]/submit/route";
import { POST as purchaseApprove } from "@/app/api/purchase-orders/[id]/approve/route";
import { POST as receiptPost } from "@/app/api/goods-receipts/route";
import { POST as receiptConfirm } from "@/app/api/goods-receipts/[id]/post/route";
import { POST as transferPost } from "@/app/api/inventory/transfers/lifecycle/route";
import { POST as projectPost } from "@/app/api/projects/route";
import { POST as issuePost } from "@/app/api/projects/material-issues/route";
import { POST as createCount } from "@/app/api/inventory/counts/route";
import { POST as startCount } from "@/app/api/inventory/counts/[id]/start/route";
import { POST as recordCount } from "@/app/api/inventory/counts/[id]/record/route";
import { POST as submitCount } from "@/app/api/inventory/counts/[id]/submit/route";
import { POST as approveCount } from "@/app/api/inventory/counts/[id]/approve/route";
import { POST as postCount } from "@/app/api/inventory/counts/[id]/post/route";
import { POST as createAdjustment } from "@/app/api/inventory/adjustments/route";
import { POST as postAdjustment } from "@/app/api/inventory/adjustments/[id]/post/route";
import { POST as openingStock } from "@/app/api/stock-movements/route";
import { reconcileProductWarehouse } from "@/lib/inventory/reconciliationService";
import { POST as createCustomer } from "@/app/api/customers/route";
import { getAvailableStock } from "@/lib/reservations/reservationService";
let replica: MongoMemoryReplSet | undefined;
let warehouse: any, otherWarehouse: any, customer: any, products: any[], bin: any;
let seq = 0;
const req = (url: string, body: any = {}, key = `command-${++seq}`) => new NextRequest(`http://127.0.0.1${url}`, {
  method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": key }, body: JSON.stringify(body),
});
const context = (id: string) => ({ params: Promise.resolve({ id }) });
async function call(handler: any, url: string, body: any = {}, id?: string, key?: string) {
  const response = await handler(req(url, body, key), id ? context(id) : undefined);
  const result = await response.json();
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}: ${JSON.stringify(result)}`);
  return result;
}
beforeAll(async () => {
  const binary = isolatedTestMongod();
  if (!fs.existsSync(binary)) throw new Error("Cached isolated mongod required");
  process.env.MONGOMS_RUNTIME_DOWNLOAD = "false";
  replica = await MongoMemoryReplSet.create({ binary: { systemBinary: binary, version: "8.2.6" }, replSet: { count: 1, ip: "127.0.0.1" } });
  const uri = replica.getUri(`benaa_audit_${Date.now()}`);
  if (!/^mongodb:\/\/127\.0\.0\.1:\d+\/benaa_audit_\d+\?/.test(uri)) throw new Error("Refusing unguarded database");
  state.db = new PrismaClient({ datasources: { db: { url: uri } } }); await state.db.$connect();
  for (const [collection, field] of ([["InventoryOperation", "operationKey"], ["SalesOrder", "salesOrderNumber"], ["Order", "orderNumber"], ["Invoice", "invoiceNumber"], ["StockMovement", "movementNumber"]] as const)) {
    await state.db.$runCommandRaw({ createIndexes: collection, indexes: [{ key: { [field]: 1 }, name: `${collection}_${field}_key`, unique: true }] });
  }
  await state.db.user.create({ data: { id: state.actorId, email: "release@isolated.test", name: "Synthetic release manager", password: "unused", role: "SUPER_ADMIN", status: true, warehouseIds: [], permissions: [], createdAt: new Date() } });
  warehouse = await state.db.warehouse.create({ data: { name: "Synthetic sales warehouse", code: "SALES", userId: state.actorId, createdBy: state.actorId } });
  otherWarehouse = await state.db.warehouse.create({ data: { name: "Unassigned warehouse", code: "OTHER", userId: state.actorId, createdBy: state.actorId } });
  const zone = await state.db.warehouseZone.create({ data: { warehouseId: warehouse.id, name: "Zone", code: "Z" } });
  const rack = await state.db.warehouseRack.create({ data: { warehouseId: warehouse.id, zoneId: zone.id, name: "Rack", code: "R" } });
  const shelf = await state.db.warehouseShelf.create({ data: { warehouseId: warehouse.id, rackId: rack.id, name: "Shelf", code: "S" } });
  bin = await state.db.warehouseBin.create({ data: { warehouseId: warehouse.id, shelfId: shelf.id, name: "Bin", code: "B" } });
  products = [];
  for (let n = 0; n < 2; n++) products.push(await state.db.product.create({ data: { name: `Synthetic construction material ${n}`, sku: `COMMERCIAL-${n}`, userId: state.actorId, supplierId: state.actorId, createdBy: state.actorId, price: 10, quantity: 100, status: "IN_STOCK" } }));
  customer = await call(createCustomer, "/api/customers", { name: "Synthetic external customer", phone: "0500000000", email: "customer@isolated.test" });
}, 60000);
afterAll(async () => { await state.db?.$disconnect(); await replica?.stop(); });
beforeEach(async () => {
  for (const model of ["inventoryCountItem", "inventoryCount", "stockAdjustmentItem", "stockAdjustment", "inventoryOperation", "auditLog", "invoice", "orderItem", "order", "dispatchBinAllocation", "dispatchItem", "dispatch", "pickAllocation", "pickListItem", "pickList", "stockReservationItem", "stockReservation", "salesOrderItem", "salesOrder", "stockMovement", "stockLocationAllocation", "stockAllocation"]) await state.db[model].deleteMany({});
  for (const p of products) {
    await state.db.product.update({ where: { id: p.id }, data: { quantity: 0, reservedQuantity: 0 } });
    await call(openingStock, "/api/stock-movements", { productId: p.id, warehouseId: warehouse.id, destinationBinId: bin.id,
      quantity: 100, movementType: "OPENING_BALANCE", reason: "Synthetic isolated initialization" });
  }
});
function body(quantities = [10], multiProduct = false) { return { customerId: customer.id, warehouseId: warehouse.id, tax: 2, discount: 1,
  items: quantities.map((orderedQuantity, i) => ({ productId: products[multiProduct ? i : 0].id, orderedQuantity, unitPrice: 10 })) }; }
async function approved(quantities = [10], multi = false) {
  const so = await call(createSale, "/api/orders", body(quantities, multi));
  await call(submitSale, `/api/sales-orders/${so.id}/submit`, {}, so.id);
  await call(approveSale, `/api/sales-orders/${so.id}/approve`, {}, so.id);
  return so;
}
async function reserved(quantities = [10], multi = false) {
  const so = await approved(quantities, multi);
  const reservation = await call(reserve, "/api/reservations", { salesOrderId: so.id });
  return { so, reservation };
}
async function dispatch(so: any, reservation: any, ratio = 1) {
  const pick = await call(createPick, "/api/pick-lists", { reservationId: reservation.id });
  await call(allocatePick, `/api/pick-lists/${pick.id}/allocations`, { allocations: pick.items.map((item: any) => ({ pickListItemId: item.id, binId: bin.id, requestedQuantity: item.requestedQuantity * ratio, pickedQuantity: item.requestedQuantity * ratio })) }, pick.id);
  await call(completePick, `/api/pick-lists/${pick.id}/complete`, { allowShort: ratio < 1 }, pick.id);
  const draft = await call(createDispatch, "/api/dispatches", { pickListId: pick.id });
  const posted = await call(postDispatch, `/api/dispatches/${draft.id}/post`, {}, draft.id, `dispatch-${draft.id}`);
  return posted;
}
async function invoiced(quantities = [10], multi = false) {
  const f = await reserved(quantities, multi); await dispatch(f.so, f.reservation);
  return { ...f, invoiceResult: await call(issueInvoice, `/api/sales-orders/${f.so.id}/invoice`, { dueDate: "2026-12-01" }, f.so.id, "invoice-key") };
}
async function pay(invoiceId: string, amount: number, intent: string) {
  state.checkout = { id: `cs_${intent}`, payment_status: "paid", payment_intent: `pi_${intent}`, amount_total: Math.round(amount * 100), metadata: { type: "invoice", invoiceId, chargeAmount: String(amount) } };
  return call(confirmPayment, "/api/payments/confirm-session", { sessionId: `cs_${intent}` });
}
describe("Customer commercial lifecycle through actual application APIs", () => {
  it.each([
    ["normal sale", [10], false], ["multiple products", [10, 20], true],
    ["repeated SKU lines", [10, 20], false], ["fractional sale", [1.25, 2.5], false],
  ])("%s preserves exact stock and approved invoice arithmetic", async (_label, quantities, multi) => {
    const f = await invoiced(quantities as number[], multi as boolean);
    const sum = (quantities as number[]).reduce((a, b) => a + b, 0);
    expect(f.invoiceResult.invoice.total).toBe(sum * 10 + 1);
    expect(await state.db.invoice.count()).toBe(1);
    expect(await state.db.order.count()).toBe(1);
    for (let i = 0; i < products.length; i++) {
      const demand = multi ? ((quantities as number[])[i] || 0) : (i === 0 ? sum : 0);
      expect((await state.db.product.findUnique({ where: { id: products[i].id } })).quantity).toBe(100 - demand);
      expect((await getAvailableStock(products[i].id, warehouse.id)).reservedStock).toBe(0);
      const reconciliation = await reconcileProductWarehouse(products[i].id, warehouse.id);
      expect(reconciliation.ledgerStock).toBe(100 - demand);
      expect(reconciliation.physicalStock).toBe(100 - demand);
      expect(reconciliation.discrepancies).toEqual([]);
      expect((await state.db.stockLocationAllocation.findUnique({ where: { productId_binId: { productId: products[i].id, binId: bin.id } } })).quantity).toBe(100 - demand);
    }
  });
  it("insufficient stock prevents reservation without movements", async () => {
    const so = await approved([101]);
    const response = await reserve(req("/api/reservations", { salesOrderId: so.id }));
    expect(response.status).toBe(400); expect(await state.db.stockReservation.count()).toBe(0); expect(await state.db.stockMovement.count({ where: { movementType: "SALE" } })).toBe(0);
  });
  it("concurrent orders compete for the same authoritative reservations", async () => {
    const a = await approved([60]), b = await approved([60]);
    const responses = await Promise.all([a, b].map(so => reserve(req("/api/reservations", { salesOrderId: so.id }))));
    expect(responses.filter(r => r.ok)).toHaveLength(1); expect((await getAvailableStock(products[0].id, warehouse.id)).reservedStock).toBe(60);
  });
  it("duplicate sale submission creates one document", async () => {
    const a = await call(createSale, "/api/orders", body(), undefined, "same-sale");
    const b = await call(createSale, "/api/orders", body(), undefined, "same-sale");
    expect(a.id).toBe(b.id); expect(await state.db.salesOrder.count()).toBe(1);
  });
  it("cancellation releases reservation without physical stock mutation", async () => {
    const f = await reserved(); await call(cancelSale, `/api/sales-orders/${f.so.id}/cancel`, { reason: "Synthetic customer cancellation" }, f.so.id);
    expect((await getAvailableStock(products[0].id, warehouse.id)).availableStock).toBe(100); expect(await state.db.stockMovement.count({ where: { movementType: "SALE" } })).toBe(0);
  });
  it("partial dispatch preserves remaining reservation and refuses a full-order invoice", async () => {
    const f = await reserved([10]); await dispatch(f.so, f.reservation, 0.5);
    expect((await getAvailableStock(products[0].id, warehouse.id)).physicalStock).toBe(95);
    expect((await getAvailableStock(products[0].id, warehouse.id)).reservedStock).toBe(5);
    const response = await issueInvoice(req(`/api/sales-orders/${f.so.id}/invoice`, { dueDate: "2026-12-01" }), context(f.so.id));
    expect(response.status).toBe(409); expect(await state.db.invoice.count()).toBe(0);
  });
  it("finishes a partial dispatch through a second pick without duplicate deductions", async () => {
    const f = await reserved([10]); await dispatch(f.so, f.reservation, 0.5); await dispatch(f.so, f.reservation);
    expect((await getAvailableStock(products[0].id, warehouse.id)).physicalStock).toBe(90);
    expect((await state.db.salesOrder.findUnique({ where: { id: f.so.id } })).status).toBe("COMPLETED");
  });
  it("concurrent invoice retries produce one invoice and no new stock movements", async () => {
    const f = await reserved(); await dispatch(f.so, f.reservation); const count = await state.db.stockMovement.count();
    const replies = await Promise.all(Array.from({ length: 6 }, () => call(issueInvoice, `/api/sales-orders/${f.so.id}/invoice`, { dueDate: "2026-12-01" }, f.so.id, "invoice-concurrent")));
    expect(new Set(replies.map(r => r.invoice.id)).size).toBe(1); expect(await state.db.invoice.count()).toBe(1); expect(await state.db.stockMovement.count()).toBe(count);
  });
  it("partial payment updates due amount without repeating dispatch", async () => {
    const f = await invoiced(); await pay(f.invoiceResult.invoice.id, 40, "partial");
    const invoice = await state.db.invoice.findUnique({ where: { id: f.invoiceResult.invoice.id } });
    expect(invoice.amountPaid).toBe(40); expect(invoice.amountDue).toBe(61); expect((await getAvailableStock(products[0].id, warehouse.id)).physicalStock).toBe(90);
  });
  it("full payment settles invoice and customer balance with no new inventory deduction", async () => {
    const f = await invoiced(); await pay(f.invoiceResult.invoice.id, 101, "full");
    const response = await balance(new NextRequest("http://127.0.0.1/api/customers/balance"), context(customer.id)); const report = await response.json();
    expect(response.status).toBe(200); expect(report.amountDue).toBe(0); expect(report.amountPaid).toBe(101);
    expect((await state.db.invoice.findUnique({ where: { id: f.invoiceResult.invoice.id } })).status).toBe("paid"); expect(await state.db.stockMovement.count({ where: { movementType: "SALE" } })).toBe(1);
  });
  it("duplicate payment events A/B/A do not repeat money or stock", async () => {
    const f = await invoiced(); const id = f.invoiceResult.invoice.id;
    await pay(id, 40, "a"); await pay(id, 61, "b"); await pay(id, 40, "a");
    const invoice = await state.db.invoice.findUnique({ where: { id } }); expect(invoice.amountPaid).toBe(101); expect(invoice.amountDue).toBe(0); expect(await state.db.stockMovement.count({ where: { movementType: "SALE" } })).toBe(1);
  });
  it("current warehouse reassignment forbids invoice and financial balance access", async () => {
    const f = await reserved(); await dispatch(f.so, f.reservation);
    await state.db.user.update({ where: { id: state.actorId }, data: { role: "WAREHOUSE_MANAGER", warehouseIds: [otherWarehouse.id], primaryWarehouseId: otherWarehouse.id } });
    try {
      expect((await issueInvoice(req(`/api/sales-orders/${f.so.id}/invoice`, { dueDate: "2026-12-01" }), context(f.so.id))).status).toBe(403);
      const report = await (await balance(new NextRequest("http://127.0.0.1/api/customers/balance"), context(customer.id))).json(); expect(report.invoiceCount).toBe(0);
    } finally { await state.db.user.update({ where: { id: state.actorId }, data: { role: "SUPER_ADMIN", warehouseIds: [], primaryWarehouseId: null } }); }
  });
  it("failed final audit rolls back invoice, financial order and fulfillment receipt", async () => {
    const f = await reserved(); await dispatch(f.so, f.reservation); const original = state.db;
    state.db = new Proxy(original, { get(target, key) {
      if (key === "$transaction") return (work: any, options: any) => target.$transaction((tx: any) => work(new Proxy(tx, { get(inner, model) {
        if (model === "auditLog") return { create: async () => { throw new Error("Injected invoice audit failure"); } }; return inner[model];
      } })), options);
      const v = target[key]; return typeof v === "function" ? v.bind(target) : v;
    } });
    try { expect((await issueInvoice(req(`/api/sales-orders/${f.so.id}/invoice`, { dueDate: "2026-12-01" }), context(f.so.id))).status).toBe(400); }
    finally { state.db = original; }
    expect(await state.db.invoice.count()).toBe(0); expect(await state.db.order.count()).toBe(0);
    expect(await state.db.inventoryOperation.count({ where: { operationKey: { startsWith: "order-fulfillment:" } } })).toBe(0);
    expect((await getAvailableStock(products[0].id, warehouse.id)).physicalStock).toBe(90); expect(await state.db.stockMovement.count({ where: { movementType: "SALE" } })).toBe(1);
  });
});


async function approvedCount(countedQuantity = 95) {
  const count = await call(createCount, "/api/inventory/counts", { warehouseId: warehouse.id, scopeType: "BIN", scopeId: bin.id });
  await call(startCount, `/api/inventory/counts/${count.id}/start`, {}, count.id);
  await call(recordCount, `/api/inventory/counts/${count.id}/record`, { items: products.map((p, i) => ({ productId: p.id, binId: bin.id, countedQuantity: i === 0 ? countedQuantity : 100 })) }, count.id);
  await call(submitCount, `/api/inventory/counts/${count.id}/submit`, {}, count.id);
  await call(approveCount, `/api/inventory/counts/${count.id}/approve`, {}, count.id);
  return count;
}
describe("Physical stocktake and approved adjustment posting", () => {
  it("posts an approved count with one approved adjustment and exact reconciled stock", async () => {
    const count = await approvedCount();
    const result = await call(postCount, `/api/inventory/counts/${count.id}/post`, {}, count.id);
    expect(result.status).toBe("POSTED");
    const adjustment = await state.db.stockAdjustment.findUnique({ where: { id: result.adjustmentId } });
    expect(adjustment.approvedBy).toBe(state.actorId); expect(adjustment.status).toBe("POSTED");
    const reconciliation = await reconcileProductWarehouse(products[0].id, warehouse.id);
    expect(reconciliation.physicalStock).toBe(95); expect(reconciliation.ledgerStock).toBe(95); expect(reconciliation.discrepancies).toEqual([]);
  });
  it("concurrent retries post one adjustment and one five-unit deduction", async () => {
    const count = await approvedCount();
    const results = await Promise.all(Array.from({ length: 6 }, () => call(postCount, `/api/inventory/counts/${count.id}/post`, {}, count.id)));
    expect(new Set(results.map(r => r.id)).size).toBe(1);
    expect(await state.db.stockAdjustment.count()).toBe(1);
    expect(await state.db.stockMovement.count({ where: { movementType: "ADJUSTMENT_OUT" } })).toBe(1);
    expect((await getAvailableStock(products[0].id, warehouse.id)).physicalStock).toBe(95);
  });
  it("rejects stale physical snapshots without creating any correction", async () => {
    const count = await approvedCount();
    await call(openingStock, "/api/stock-movements", { productId: products[0].id, warehouseId: warehouse.id, destinationBinId: bin.id, quantity: 2, movementType: "ADJUSTMENT_IN" });
    const response = await postCount(req(`/api/inventory/counts/${count.id}/post`), context(count.id));
    expect(response.status).toBe(400); expect((await response.json()).error).toContain("recount");
    expect(await state.db.stockAdjustment.count()).toBe(0); expect((await getAvailableStock(products[0].id, warehouse.id)).physicalStock).toBe(102);
  });
  it("retains six-decimal base quantities without rounding away stock", async () => {
    const count = await approvedCount(99.999999);
    await call(postCount, `/api/inventory/counts/${count.id}/post`, {}, count.id);
    const reconciliation = await reconcileProductWarehouse(products[0].id, warehouse.id);
    expect(reconciliation.physicalStock).toBe(99.999999); expect(reconciliation.ledgerStock).toBe(99.999999); expect(reconciliation.discrepancies).toEqual([]);
  });
  it("cannot post an unapproved manual adjustment", async () => {
    const adjustment = await call(createAdjustment, "/api/inventory/adjustments", { warehouseId: warehouse.id, reason: "Synthetic loss", adjustmentType: "CORRECTION",
      items: [{ productId: products[0].id, binId: bin.id, systemQuantity: 100, adjustmentQuantity: -1, resultingQuantity: 99 }] });
    const response = await postAdjustment(req(`/api/inventory/adjustments/${adjustment.id}/post`), context(adjustment.id));
    expect(response.status).toBe(400); expect((await response.json()).error).toContain("APPROVED");
    expect((await getAvailableStock(products[0].id, warehouse.id)).physicalStock).toBe(100);
  });
  it("a late final-count write failure rolls back stock, adjustment, ledger and approval consumption", async () => {
    const count = await approvedCount(); const original = state.db;
    state.db = new Proxy(original, { get(target, key) {
      if (key === "$transaction") return (work: any, options: any) => target.$transaction((tx: any) => work(new Proxy(tx, { get(inner, model) {
        if (model === "inventoryCount") return { ...inner.inventoryCount, update: async (args: any) => {
          if (args.data.status === "POSTED") throw new Error("Injected final count failure");
          return inner.inventoryCount.update(args);
        } }; return inner[model];
      } })), options);
      const value = target[key]; return typeof value === "function" ? value.bind(target) : value;
    } });
    try { expect((await postCount(req(`/api/inventory/counts/${count.id}/post`), context(count.id))).status).toBe(400); }
    finally { state.db = original; }
    expect((await state.db.inventoryCount.findUnique({ where: { id: count.id } })).status).toBe("APPROVED");
    expect(await state.db.stockAdjustment.count()).toBe(0); expect(await state.db.stockMovement.count({ where: { movementType: "ADJUSTMENT_OUT" } })).toBe(0);
    expect((await getAvailableStock(products[0].id, warehouse.id)).physicalStock).toBe(100);
  });
});


describe("Persisted full business API journey", () => {
  it("reconciles procurement, customer sale, payment, transfer, project custody, return and stocktake in one product base unit", async () => {
    const supplier = await call(supplierPost, "/api/suppliers", { name: "Synthetic construction supplier" });
    const category = await call(categoryPost, "/api/categories", { name: "Synthetic construction category" });
    const unit = await call(unitPost, "/api/units", { name: "Synthetic piece", code: "RC-PC", symbol: "pc", type: "count", isBaseUnit: true });
    const created = await call(productPost, "/api/products", { name: "Synthetic construction panel", sku: "RC-CONSTRUCTION-PANEL", price: 10, quantity: 0,
      categoryId: category.id, supplierId: supplier.id, unitId: unit.id });
    expect(created.unitId).toBe(unit.id);
    const purchase = await call(purchasePost, "/api/purchase-orders", { supplierId: supplier.id, warehouseId: warehouse.id,
      items: [{ productId: created.id, unitId: unit.id, orderedQuantity: 100, unitPrice: 8 }] });
    await call(purchaseSubmit, `/api/purchase-orders/${purchase.id}/submit`, {}, purchase.id);
    await call(purchaseApprove, `/api/purchase-orders/${purchase.id}/approve`, {}, purchase.id);
    const receipt = await call(receiptPost, "/api/goods-receipts", { purchaseOrderId: purchase.id,
      items: [{ purchaseOrderItemId: purchase.items[0].id, productId: created.id, unitId: unit.id, receivedQuantity: 100, destinationBinId: bin.id }] });
    await call(receiptConfirm, `/api/goods-receipts/${receipt.id}/post`, {}, receipt.id);
    expect((await state.db.stockLocationAllocation.findUnique({ where: { productId_binId: { productId: created.id, binId: bin.id } } })).quantity).toBe(100);
    const before = products; products = [created];
    try {
      const f = await invoiced([10]); await pay(f.invoiceResult.invoice.id, 101, "complete_business_journey");
      const transfer = (await call(transferPost, "/api/inventory/transfers/lifecycle", { action: "REQUEST", productId: created.id, fromWarehouseId: warehouse.id, toWarehouseId: otherWarehouse.id, quantity: 10, unitId: unit.id, fromBinId: bin.id })).transfer;
      await call(transferPost, "/api/inventory/transfers/lifecycle", { action: "APPROVE", transferId: transfer.id });
      await call(transferPost, "/api/inventory/transfers/lifecycle", { action: "DISPATCH", transferId: transfer.id });
      const inTransit = await state.db.stockTransfer.findUnique({ where: { id: transfer.id } }); expect(inTransit.inTransitQuantity).toBe(10);
      await call(transferPost, "/api/inventory/transfers/lifecycle", { action: "RECEIVE", transferId: transfer.id, receivedQuantity: 10 });
      const project = (await call(projectPost, "/api/projects", { code: "RC-PRJ", name: "Synthetic construction project", location: "Isolated test site", assignedManagerId: state.actorId, warehouseIds: [warehouse.id] })).project;
      const issue = (await call(issuePost, "/api/projects/material-issues", { action: "CREATE", projectId: project.id, warehouseId: warehouse.id, recipientName: "Synthetic site custodian",
        items: [{ productId: created.id, unitId: unit.id, binId: bin.id, quantity: 10 }] })).issue;
      for (const action of ["REQUEST", "APPROVE", "RESERVE"]) await call(issuePost, "/api/projects/material-issues", { action, issueId: issue.id });
      const moneyBeforeIssue = { invoices: await state.db.invoice.count(), orders: await state.db.order.count(), paid: (await state.db.invoice.findUnique({ where: { id: f.invoiceResult.invoice.id } })).amountPaid };
      await call(issuePost, "/api/projects/material-issues", { action: "DISPATCH", issueId: issue.id, quantities: [{ issueItemId: issue.items[0].id, quantity: 10 }] });
      await call(issuePost, "/api/projects/material-issues", { action: "COMPLETE", issueId: issue.id });
      await call(issuePost, "/api/projects/material-issues", { action: "RETURN", issueId: issue.id, quantities: [{ issueItemId: issue.items[0].id, quantity: 5 }], reason: "Authorized physical receipt of unused panels" });
      expect({ invoices: await state.db.invoice.count(), orders: await state.db.order.count(), paid: (await state.db.invoice.findUnique({ where: { id: f.invoiceResult.invoice.id } })).amountPaid }).toEqual(moneyBeforeIssue);
      const count = await call(createCount, "/api/inventory/counts", { warehouseId: warehouse.id, scopeType: "BIN", scopeId: bin.id });
      const started = await call(startCount, `/api/inventory/counts/${count.id}/start`, {}, count.id);
      await call(recordCount, `/api/inventory/counts/${count.id}/record`, { items: started.items.map((item: any) => ({ productId: item.productId, binId: bin.id, countedQuantity: item.productId === created.id ? 74 : item.systemQuantity })) }, count.id);
      await call(submitCount, `/api/inventory/counts/${count.id}/submit`, {}, count.id);
      await call(approveCount, `/api/inventory/counts/${count.id}/approve`, {}, count.id);
      await call(postCount, `/api/inventory/counts/${count.id}/post`, {}, count.id);
      const source = await reconcileProductWarehouse(created.id, warehouse.id), destination = await reconcileProductWarehouse(created.id, otherWarehouse.id);
      const persistedTransfer = await state.db.stockTransfer.findUnique({ where: { id: transfer.id } });
      const persistedIssue = await state.db.projectMaterialIssueItem.findUnique({ where: { id: issue.items[0].id } });
      const persistedProduct = await state.db.product.findUnique({ where: { id: created.id } });
      const report = await (await balance(new NextRequest("http://127.0.0.1/api/customers/balance"), context(customer.id))).json();
      const custody = persistedIssue.dispatchedQuantity - persistedIssue.returnedQuantity;
      expect(source.physicalStock).toBe(74); expect(source.ledgerStock).toBe(74); expect(source.discrepancies).toEqual([]);
      expect(destination.physicalStock).toBe(10); expect(destination.ledgerStock).toBe(10); expect(destination.discrepancies).toEqual([]);
      expect(persistedProduct.quantity).toBe(84); expect(persistedTransfer.inTransitQuantity).toBe(0); expect(custody).toBe(5);
      expect(source.reservedStock).toBe(0); expect(destination.reservedStock).toBe(0);
      expect(74 + 10 + custody + 10 + 1).toBe(100); // ONE product, ONE declared base unit only.
      expect(report.amountPaid).toBe(101); expect(report.amountDue).toBe(0);
      const evidence = { scope: "Fresh guarded local replica, actual business APIs; external media/email/Stripe simulated", productId: created.id, sku: created.sku, baseUnitId: unit.id,
        procurementReceived: 100, customerDispatched: 10, warehouseSource: 74, warehouseDestination: 10, physicalCatalog: persistedProduct.quantity,
        inTransit: persistedTransfer.inTransitQuantity, projectCustody: custody, approvedCountLoss: 1, reserved: 0, invoiceTotal: 101, payment: report.amountPaid, customerDue: report.amountDue,
        reconciliation: { source, destination }, unsupported: ["Customer commercial returns", "Supplier commercial returns"], invoiceId: f.invoiceResult.invoice.id, salesOrderId: f.so.id, projectIssueId: issue.id, stocktakeId: count.id };
      fs.writeFileSync(path.resolve("../docs/PRODUCTION_CERTIFICATION/evidence/recovery-business-journey.json"), JSON.stringify(evidence, null, 2));
    } finally { products = before; }
  });
});


describe("ERP financial authorization and immutable invoice policy", () => {
  it("permits a currently assigned manager who does not own the catalog to read and prepare payment", async () => {
    const f = await invoiced(); const originalActor = state.actorId;
    const manager = await state.db.user.create({ data: { email: "delegated-manager@isolated.test", name: "Synthetic assigned manager", password: "unused", role: "WAREHOUSE_MANAGER", status: true, createdAt: new Date(), warehouseIds: [warehouse.id], primaryWarehouseId: warehouse.id, permissions: [] } });
    state.actorId = manager.id;
    try {
      const response = await invoiceGet(new NextRequest("http://127.0.0.1/api/invoices/detail"), context(f.invoiceResult.invoice.id));
      expect(response.status).toBe(200); expect((await response.json()).client.name).toBe(customer.name);
      expect((await checkoutPost(req("/api/payments/checkout", { type: "invoice", id: f.invoiceResult.invoice.id, amount: 40 }))).status).toBe(200);
      await state.db.user.update({ where: { id: manager.id }, data: { warehouseIds: [otherWarehouse.id], primaryWarehouseId: otherWarehouse.id } });
      expect((await invoiceGet(new NextRequest("http://127.0.0.1/api/invoices/detail"), context(f.invoiceResult.invoice.id))).status).toBe(404);
      expect((await checkoutPost(req("/api/payments/checkout", { type: "invoice", id: f.invoiceResult.invoice.id, amount: 40 }))).status).toBe(403);
      state.checkout = { payment_status: "paid", payment_intent: "pi_scope_test", amount_total: 4000, metadata: { type: "invoice", invoiceId: f.invoiceResult.invoice.id, chargeAmount: "40" } };
      expect((await confirmPayment(req("/api/payments/confirm-session", { sessionId: "cs_scope_test" }))).status).toBe(403);
      expect((await state.db.invoice.findUnique({ where: { id: f.invoiceResult.invoice.id } })).amountPaid).toBe(0);
    } finally { state.actorId = originalActor; }
  });
  it("prevents direct invoice repricing, fabricated payment totals and deletion of ERP financial history", async () => {
    const f = await invoiced(); const id = f.invoiceResult.invoice.id;
    expect((await invoicePut(req(`/api/invoices/${id}`, { total: 1, amountPaid: 1, status: "paid" }), context(id))).status).toBe(409);
    expect((await invoiceDelete(new NextRequest(`http://127.0.0.1/api/invoices/${id}`, { method: "DELETE" }), context(id))).status).toBe(409);
    const persisted = await state.db.invoice.findUnique({ where: { id } }); expect(persisted.total).toBe(101); expect(persisted.amountPaid).toBe(0);
  });
  it("rejects unsupported legacy fee fields without silently changing pricing or creating a document", async () => {
    const response = await createSale(req("/api/orders", { ...body(), shipping: 4.99 }));
    expect(response.status).toBe(400); expect((await response.json()).error).toContain("must not be silently discarded");
    expect(await state.db.salesOrder.count()).toBe(0);
  });
  it("identical semantic request keys survive object-property ordering", async () => {
    const payload = body(); const key = "canonical-sales-request";
    const first = await call(createSale, "/api/orders", payload, undefined, key);
    const second = await call(createSale, "/api/orders", { items: payload.items, warehouseId: payload.warehouseId, customerId: payload.customerId, discount: payload.discount, tax: payload.tax }, undefined, key);
    expect(second.id).toBe(first.id); expect(await state.db.salesOrder.count()).toBe(1);
  });
});
