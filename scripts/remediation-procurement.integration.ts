import { isolatedTestMongod } from "./isolated-test-mongod";
/** Disposable localhost replica only; no .env import and no production client. */
import { beforeAll, afterAll, beforeEach, describe, it, expect, vi } from "vitest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { PrismaClient } from "@prisma/client";
import path from "node:path";
import fs from "node:fs";
const state = vi.hoisted(() => ({ db: null as any }));
vi.mock("@/prisma/client", () => ({ prisma: new Proxy({}, { get: (_, k) => {
  if (!state.db) throw new Error("Isolated database not initialized");
  const value = state.db[k]; return typeof value === "function" ? value.bind(state.db) : value;
} }) }));
vi.mock("@/lib/cache/post-mutation", () => ({ scheduleInvalidateStockAllocationCaches: vi.fn() }));
import { createGoodsReceiptDraft, postGoodsReceipt } from "@/lib/procurement/procurementService";
import { convertUnitQuantity } from "@/lib/units/unitService";
let replica: MongoMemoryReplSet;
let product: any, warehouse: any, po: any, pieces: any, boxes: any;
const userId = "100000000000000000000001";
let seq = 0;
beforeAll(async () => {
 const binary = isolatedTestMongod();
 if (!fs.existsSync(binary)) throw new Error("Cached mongod required; no downloads allowed");
 process.env.MONGOMS_RUNTIME_DOWNLOAD = "false";
 replica = await MongoMemoryReplSet.create({ binary: { systemBinary: binary, version: "8.2.6" }, replSet: { count: 1, ip: "127.0.0.1" } });
 const uri = replica.getUri(`benaa_audit_${Date.now()}`);
 if (!/^mongodb:\/\/127\.0\.0\.1:\d+\/benaa_audit_\d+\?/.test(uri)) throw new Error("Non-isolated URI rejected");
 state.db = new PrismaClient({ datasources: { db: { url: uri } } }); await state.db.$connect();
 await state.db.user.create({ data: { id: userId, email: "procurement@isolated.test", password: "unused", name: "Audit", role: "SUPER_ADMIN", warehouseIds: [], permissions: [], createdAt: new Date() } });
 warehouse = await state.db.warehouse.create({ data: { name: "Audit warehouse", code: "PROC", userId, createdBy: userId } });
 pieces = await state.db.unit.create({ data: { name: "Piece", code: "PCS", symbol: "pcs", type: "count" } });
 boxes = await state.db.unit.create({ data: { name: "Box", code: "BOX", symbol: "box", type: "count" } });
 product = await state.db.product.create({ data: { name: "Tile", sku: "PROC-TILE", price: 10, quantity: 0, unitId: pieces.id, status: "OUT_OF_STOCK", supplierId: userId, userId, createdBy: userId } });
 await state.db.unitConversion.create({ data: { fromUnitId: boxes.id, toUnitId: pieces.id, factor: 10, productId: product.id } });
}, 60000);
afterAll(async () => { await state.db?.$disconnect(); await replica?.stop(); });
beforeEach(async () => {
 for (const model of ["goodsReceiptItem", "goodsReceipt", "purchaseOrderItem", "purchaseOrder", "stockMovement", "stockAllocation", "inventoryBatch", "auditLog"]) await state.db[model].deleteMany({});
 await state.db.product.update({ where: { id: product.id }, data: { quantity: 0, trackingMode: "NONE" } });
 po = await state.db.purchaseOrder.create({ data: { purchaseOrderNumber: `PO-${++seq}`, supplierId: userId, warehouseId: warehouse.id, status: "APPROVED", createdBy: userId,
 items: { create: [{ productId: product.id, productName: "Tile", orderedQuantity: 20, remainingQuantity: 20, receivedQuantity: 0, unitId: pieces.id, unitPrice: 10, lineTotal: 200 }] } }, include: { items: true } });
});
async function draft(q = 10, unitId = pieces.id, extra: any = {}) {
 return createGoodsReceiptDraft({ purchaseOrderId: po.id, userId, items: [{ productId: product.id, purchaseOrderItemId: po.items[0].id, receivedQuantity: q, unitId, ...extra }] });
}
async function reconcile(expected: number, count = 1) {
 expect((await state.db.product.findUnique({ where: { id: product.id } })).quantity).toBe(expected);
 const allocations = await state.db.stockAllocation.findMany(); expect(allocations.reduce((s: number, a: any) => s+a.quantity, 0)).toBe(expected);
 const movements = await state.db.stockMovement.findMany(); expect(movements).toHaveLength(count);
 expect(movements.reduce((s: number, m: any) => s+m.quantityInBaseUnit, 0)).toBe(expected);
 const line = await state.db.purchaseOrderItem.findUnique({ where: { id: po.items[0].id } }); expect(line.receivedQuantity).toBe(expected); expect(line.remainingQuantity).toBe(20-expected);
}
describe("INV04 and INV10 real MongoDB correctness", () => {
 it("ten concurrent retries post a receipt exactly once", async () => {
  const receipt = await draft(10); const results = await Promise.all(Array.from({ length: 10 }, () => postGoodsReceipt(receipt.id, userId)));
  expect(results.every(r => r.goodsReceipt?.status === "POSTED")).toBe(true); await reconcile(10);
  expect(await state.db.auditLog.count({ where: { action: "goods_receipt_posted" } })).toBe(1); expect(await state.db.inventoryBatch.count()).toBe(0);
 });
 it("preserves six-decimal PO balances across fractional receipt lines", async () => {
  await state.db.purchaseOrderItem.update({ where: { id: po.items[0].id }, data: { orderedQuantity: 0.3, remainingQuantity: 0.3 } });
  const receipt = await draft(0.1);
  await state.db.goodsReceiptItem.create({ data: { goodsReceiptId: receipt.id, purchaseOrderItemId: po.items[0].id, productId: product.id, receivedQuantity: 0.2, unitId: pieces.id, quantityInBaseUnit: 0.2 } });
  await postGoodsReceipt(receipt.id,userId);
  const line = await state.db.purchaseOrderItem.findUnique({ where: { id: po.items[0].id } });
  expect(line.receivedQuantity).toBe(0.3); expect(line.remainingQuantity).toBe(0);
  expect((await state.db.product.findUnique({ where: { id: product.id } })).quantity).toBe(0.3);
  expect((await state.db.stockAllocation.findFirst()).quantity).toBe(0.3);
  expect((await state.db.purchaseOrder.findUnique({ where: { id: po.id } })).status).toBe("FULLY_RECEIVED");
 });
 it("competing receipts cannot over-receive the same PO", async () => {
  const a = await draft(15), b = await draft(15); const results = await Promise.allSettled([postGoodsReceipt(a.id,userId),postGoodsReceipt(b.id,userId)]);
  expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1); await reconcile(15);
  expect(await state.db.goodsReceipt.count({ where: { status: "DRAFT" } })).toBe(1);
 });
 it("converts receipt units before PO limits and batch/ledger accounting", async () => {
  await state.db.product.update({ where: { id: product.id }, data: { trackingMode: "BATCH" } });
  const receipt = await draft(2, boxes.id); await postGoodsReceipt(receipt.id,userId); await reconcile(20);
  expect((await state.db.inventoryBatch.findFirst()).quantity).toBe(20);
  expect((await state.db.purchaseOrder.findUnique({ where: { id: po.id } })).status).toBe("FULLY_RECEIVED");
  expect((await state.db.goodsReceiptItem.findFirst()).quantityInBaseUnit).toBe(20);
 });
 it("does not release a quarantined batch while posting a goods receipt", async () => {
  await state.db.product.update({ where: { id: product.id }, data: { trackingMode: "BATCH" } });
  const receipt = await draft(10);
  const batch = await state.db.inventoryBatch.create({ data: { productId: product.id, warehouseId: warehouse.id, batchNumber: "BAT-" + receipt.receiptNumber.replace("GRN-", ""), quantity: 0, reservedQuantity: 0, status: "QUARANTINED" } });
  await expect(postGoodsReceipt(receipt.id,userId)).rejects.toThrow("quarantined");
  await reconcile(0,0);
  expect((await state.db.goodsReceipt.findUnique({ where: { id: receipt.id } })).status).toBe("DRAFT");
  expect((await state.db.inventoryBatch.findUnique({ where: { id: batch.id } })).status).toBe("QUARANTINED");
  expect((await state.db.inventoryBatch.findUnique({ where: { id: batch.id } })).quantity).toBe(0);
 });
 it("rolls back a newly created batch when subsequent central stock mutation fails", async () => {
  await state.db.product.update({ where: { id: product.id }, data: { trackingMode: "BATCH" } });
  const receipt = await draft(10);
  await state.db.goodsReceiptItem.updateMany({ where: { goodsReceiptId: receipt.id }, data: { destinationBinId: userId } });
  await expect(postGoodsReceipt(receipt.id,userId)).rejects.toThrow();
  await reconcile(0,0); expect(await state.db.inventoryBatch.count()).toBe(0);
  expect((await state.db.goodsReceipt.findUnique({ where: { id: receipt.id } })).status).toBe("DRAFT");
 });
 it("rejects aggregate duplicate receipt lines and product mismatch", async () => {
  const item = { purchaseOrderItemId: po.items[0].id, productId: product.id, receivedQuantity: 15, unitId: pieces.id };
  await expect(createGoodsReceiptDraft({ purchaseOrderId: po.id, userId, items: [item,item] })).rejects.toThrow("Over-receiving");
  await expect(draft(1,pieces.id,{ productId: userId })).rejects.toThrow("does not match");
  expect(await state.db.goodsReceipt.count()).toBe(0); await reconcile(0,0);
 });
 it("rolls back earlier stock and PO writes when later receipt line fails", async () => {
  const receipt = await draft(5); await state.db.goodsReceiptItem.create({ data: { goodsReceiptId: receipt.id, purchaseOrderItemId: po.items[0].id, productId: product.id, receivedQuantity: 5, unitId: pieces.id, quantityInBaseUnit: 5, destinationBinId: userId } });
  await expect(postGoodsReceipt(receipt.id,userId)).rejects.toThrow(); await reconcile(0,0);
  expect((await state.db.goodsReceipt.findUnique({ where: { id: receipt.id } })).status).toBe("DRAFT");
  expect(await state.db.auditLog.count({ where: { action: "goods_receipt_posted" } })).toBe(0);
 });
 it.each([-1,0,NaN,Infinity])("rejects nonpositive/nonfinite receipt %s", async q => { await expect(draft(q)).rejects.toThrow(); await reconcile(0,0); });
 it("rejects missing, cross-dimension and unregistered unit conversions", async () => {
  await expect(convertUnitQuantity({ quantity: 1, fromUnitId: boxes.id })).rejects.toThrow("required");
  const meter = await state.db.unit.create({ data: { name: "Meter", code: `M-${seq}`, symbol: "m", type: "length" } });
  await expect(convertUnitQuantity({ quantity: 1, fromUnitId: meter.id, toUnitId: pieces.id })).rejects.toThrow("dimensions");
  await expect(convertUnitQuantity({ quantity: 1, fromUnitId: boxes.id, toUnitId: pieces.id })).rejects.toThrow("No registered");
  expect(await convertUnitQuantity({ quantity: 20, fromUnitId: pieces.id, toUnitId: boxes.id, productId: product.id })).toBe(2);
 });
 it("rejects invalid factor and numerical overflow", async () => {
  const row = await state.db.unitConversion.create({ data: { productId: null, fromUnitId: boxes.id, toUnitId: pieces.id, factor: -10 } });
  await expect(convertUnitQuantity({ quantity: 1, fromUnitId: boxes.id, toUnitId: pieces.id })).rejects.toThrow("factor");
  await state.db.unitConversion.update({ where: { id: row.id }, data: { factor: 1e308 } });
  await expect(convertUnitQuantity({ quantity: 1e308, fromUnitId: boxes.id, toUnitId: pieces.id })).rejects.toThrow("Converted");
 });
});
