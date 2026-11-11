import { isolatedTestMongod } from "./isolated-test-mongod";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { PrismaClient } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import path from "node:path"; import fs from "node:fs";
const state = vi.hoisted(() => ({ db: null as any, session: null as any }));
vi.mock("@/prisma/client", () => ({ prisma: new Proxy({}, { get: (_, key) => { const value = state.db[key]; return typeof value === "function" ? value.bind(state.db) : value; } }) }));
vi.mock("@/utils/auth", () => ({ getSessionFromRequest: async () => state.session ? await state.db.user.findUnique({ where: { id: state.session.id } }) : null }));
vi.mock('@/lib/auth-server', () => ({ getSession: async () => state.session ? state.db.user.findUnique({ where: { id: state.session.id } }) : null }));
vi.mock("@/lib/cache/post-mutation", () => ({ scheduleInvalidateStockAllocationCaches: vi.fn(async () => undefined), invalidateOnProductChange: vi.fn(async () => undefined) }));
import { GET as purchaseGet, POST as purchasePost } from "@/app/api/purchase-orders/route";
import { GET as shelvesGet } from "@/app/api/locations/shelves/route";
import { withWarehouseScope } from "@/lib/auth/warehouse-route-scope";
import { POST as syncPost, GET as syncGet } from "@/app/api/mobile-sync/route";
import { POST as createCatalog, PUT as updateCatalog, DELETE as deleteCatalog } from "@/app/api/products/route";
import { PATCH as replaceCatalogStock } from "@/app/api/products/[id]/route";
import { POST as manualPost } from "@/app/api/stock-movements/route";
import { reconcileProductWarehouse, calculateLedgerStockBalance } from "@/lib/inventory/reconciliationService";
import { applyTransferOperation } from "@/lib/inventory/transferLifecycle";
import { archiveEmptyProduct } from "@/lib/inventory/archiveProduct";
import { postManualMovement } from "@/lib/inventory/manualMovement";
import { GET as stockAvailability } from '@/app/api/inventory/availability/route';
import { GET as stockHealth } from '@/app/api/inventory/health/route';
import { GET as stockReconciliation } from '@/app/api/inventory/reconciliation/route';
import { GET as pickingAvailability } from '@/app/api/inventory/picking-availability/route';
import { GET as stockVariance } from '@/app/api/inventory/reports/variance/route';
import { GET as barcodeLookup } from '@/app/api/products/barcode/[barcode]/route';
import { createStockReservation } from '@/lib/reservations/reservationService';
import { enrichProductDetailWithCommittedQuantity } from '@/lib/products/enrich-product-committed-quantity';
let replica: MongoMemoryReplSet | undefined; let warehouses: any[] = []; let product: any;
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
 for (const model of ['stockReservationItem', 'stockReservation', 'salesOrderItem', 'salesOrder', 'customer']) await state.db[model].deleteMany({});
 for (const model of ["projectMaterialIssueReturn", "projectMaterialIssueItem", "projectMaterialIssue", "project", "inventoryOperation", "stockTransfer", "stockMovement"]) await state.db[model].deleteMany({});
 await state.db.product.update({ where: { id: product.id }, data: { quantity: 500, reservedQuantity: 0, deletedAt: null } });
 await state.db.stockAllocation.updateMany({ data: { quantity: 100, reservedQuantity: 0 } });
 state.session = await state.db.user.update({ where: { id: fixtureId }, data: { role: "SUPER_ADMIN", status: true, warehouseIds: [], primaryWarehouseId: null } });
});
const request = (path: string, body?: any) => new NextRequest("http://isolated.test/api/" + path, body === undefined ? undefined : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
let sequence = 0;
const operation = (payload: any, scope = warehouses[0].id, id = "sync-" + ++sequence) => ({ action: "sync_operation", operationType: "TRANSFER_LIFECYCLE", operationId: id, actorId: fixtureId, warehouseId: scope, payload });
async function manager() { await state.db.user.update({ where: { id: fixtureId }, data: { role: "WAREHOUSE_MANAGER", warehouseIds: [warehouses[0].id] } }); }
const requestPayload = () => ({ action: "REQUEST", productId: product.id, fromWarehouseId: warehouses[0].id, toWarehouseId: warehouses[1].id, quantity: 10 });
async function post(body: any) { return syncPost(request("mobile-sync", body)); }
const scopedEcho = withWarehouseScope(async (req: NextRequest) => NextResponse.json({ warehouseId: new URL(req.url).searchParams.get("warehouseId"), allowed: true }));
describe("Current warehouse authorization and durable mobile server operations", () => {
 it('barcode availability uses current sales commitments and never exposes another warehouse snapshot', async () => {
  await manager();
  const params = { params: Promise.resolve({ barcode: product.sku }) };
  expect((await barcodeLookup(request('products/barcode/' + product.sku + '?warehouseId=' + warehouses[1].id), params)).status).toBe(403);
  const customer = await state.db.customer.create({ data: { customerCode: 'BARCODE-RBAC', name: 'Synthetic customer', createdBy: fixtureId } });
  const order = await state.db.salesOrder.create({ data: { salesOrderNumber: 'BARCODE-SALES', customerId: customer.id, warehouseId: warehouses[0].id, status: 'APPROVED', createdBy: fixtureId,
    items: { create: [{ productId: product.id, productName: product.name, orderedQuantity: 20, unitPrice: 10, lineTotal: 200 }] } } });
  await createStockReservation(order.id, fixtureId);
  const catalog = await enrichProductDetailWithCommittedQuantity(await state.db.product.findUniqueOrThrow({where:{id:product.id}}));
  expect(catalog.committedQuantity).toBe(20);
  expect(catalog.reservedQuantity).toBe(0);
  const response = await barcodeLookup(request('products/barcode/' + product.sku), params);
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.totalPhysicalStock).toBe(100); expect(body.totalAvailableStock).toBe(80);
  expect(body.product.quantity).toBe(100); expect(body.warehouseAllocations).toHaveLength(1);
  expect(body.warehouseAllocations[0].warehouseId).toBe(warehouses[0].id);
 });
 it('rejects horizontal warehouse reads across availability, picking, health, reconciliation and variance APIs', async () => {
  await manager();
  for (const [path, handler] of [['inventory/availability', stockAvailability], ['inventory/picking-availability', pickingAvailability],
    ['inventory/health', stockHealth], ['inventory/reconciliation', stockReconciliation], ['inventory/reports/variance', stockVariance]] as const) {
    const response = await handler(request(path + '?warehouseId=' + warehouses[1].id + '&productId=' + product.id));
    expect(response.status).toBe(403);
  }
 });
 it('defaults inventory availability to the current assigned warehouse instead of exposing global stock', async () => {
  await manager();
  const response = await stockAvailability(request('inventory/availability?productId=' + product.id));
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.warehouseId).toBe(warehouses[0].id); expect(body.physicalStock).toBe(100);
  expect(body.availableStock).toBe(100);
 });
 it("defaults lists to the current assigned warehouse and rejects horizontal query", async () => {
  await manager(); expect((await (await scopedEcho(request("sales-orders"))).json()).warehouseId).toBe(warehouses[0].id);
  expect((await scopedEcho(request("sales-orders?warehouseId=" + warehouses[1].id))).status).toBe(403);
 });
 it("rejects horizontal detail access before legacy handler executes", async () => {
  const dispatch = await state.db.dispatch.create({ data: { dispatchNumber: "SCOPE" + ++sequence, salesOrderId: fixtureId, pickListId: fixtureId, warehouseId: warehouses[1].id, createdBy: fixtureId } });
  await manager(); const handler = vi.fn(async (_req: NextRequest, _context: any) => NextResponse.json({ secret: true }));
  const result = await withWarehouseScope(handler)(request("dispatches/" + dispatch.id), { params: Promise.resolve({ id: dispatch.id }) });
  expect(result.status).toBe(403); expect(handler).not.toHaveBeenCalled();
 });
 it("rejects foreign nested warehouse/body reference and allows assigned scope", async () => {
  await manager();
  expect((await scopedEcho(request("sales-orders", { warehouseId: warehouses[1].id }))).status).toBe(403);
  const bin = await state.db.warehouseBin.create({ data: { shelfId: fixtureId, warehouseId: warehouses[1].id, code: "SCOPE" + ++sequence, name: "Scope fixture" } });
  expect((await scopedEcho(request("pick-lists", { items: [{ binId: bin.id }] }))).status).toBe(403);
 });
 it("rejects users with no warehouse assignments and revoked role/assignment", async () => {
  await manager(); await state.db.user.update({ where: { id: fixtureId }, data: { warehouseIds: [] } });
  expect((await scopedEcho(request("sales-orders"))).status).toBe(403);
 });
 it("limits warehouse list and allocation product query to assigned warehouse", async () => {
  await manager();
  const list = await (await scopedEcho(request("warehouses"))).json(); expect(list.map((w: any) => w.id)).toEqual([warehouses[0].id]);
  const stocks = await (await scopedEcho(request("stock-allocations?productId=" + product.id))).json(); expect(stocks).toHaveLength(1); expect(stocks[0].warehouseId).toBe(warehouses[0].id);
 });
 it("contains unsafe direct stock snapshots for administrators too", async () => {
  expect((await scopedEcho(request("stock-allocations", { productId: product.id, warehouseId: warehouses[0].id, quantity: 999 }))).status).toBe(409);
  expect((await state.db.stockAllocation.findFirst()).quantity).toBe(100); expect(await state.db.stockMovement.count()).toBe(0);
 });
 it.each(["sync_items", "full_sync", "record_movement"])("rejects legacy %s without successful acknowledgement or writes", async action => {
  const result = await post({ action, items: [{ code: product.sku, currentStock: 999 }] }); expect(result.status).toBe(409);
  expect((await result.json()).success).toBe(false); expect((await state.db.product.findUnique({ where: { id: product.id } })).quantity).toBe(500);
 });
 it("returns authorized warehouse allocations without financial/global stock fields", async () => {
  await manager(); const response = await syncGet(request("mobile-sync")); expect(response.status).toBe(200);
  const data = await response.json(); expect(data.items).toHaveLength(1); expect(data.items[0].currentStock).toBe(100);
  expect(data.items[0]).not.toHaveProperty("unitPrice"); expect(data.items[0]).not.toHaveProperty("price");
  expect((await syncGet(request("mobile-sync?warehouseId=" + warehouses[1].id))).status).toBe(403);
 });
 it("replays stable operation once and rejects changed payload for same key", async () => {
  const body = operation(requestPayload()); const first = await post(body); expect(first.status).toBe(200);
  const second = await post(body); expect(second.status).toBe(200); expect((await second.json()).replayed).toBe(true);
  expect(await state.db.stockTransfer.count()).toBe(1);
  expect((await post({ ...body, payload: { ...body.payload, quantity: 20 } })).status).toBe(409);
  expect((await state.db.stockAllocation.findFirst({ where: { warehouseId: warehouses[0].id } })).reservedQuantity).toBe(10);
 });
 it("rejects spoofed actor, foreign scope and unsupported financial operation", async () => {
  expect((await post({ ...operation(requestPayload()), actorId: "spoofed" })).status).toBe(403);
  await manager(); expect((await post(operation(requestPayload(), warehouses[1].id))).status).toBe(403);
  expect((await post({ ...operation(requestPayload()), operationType: "PAYMENT" })).status).toBe(422);
  expect(await state.db.inventoryOperation.count()).toBe(0);
 });
 it("rejects receive-before-dispatch, retains key for corrected later retry, and replays successful receipt", async () => {
  const transfer = (await (await post(operation(requestPayload()))).json()).transfer;
  const receive = operation({ action: "RECEIVE", transferId: transfer.id, receivedQuantity: 10 }, warehouses[1].id);
  expect((await post(receive)).status).toBe(409); expect(await state.db.stockMovement.count()).toBe(0);
  expect((await post(operation({ action: "APPROVE", transferId: transfer.id }))).status).toBe(200);
  expect((await post(operation({ action: "DISPATCH", transferId: transfer.id }))).status).toBe(200);
  expect((await post(receive)).status).toBe(200); expect((await (await post(receive)).json()).replayed).toBe(true);
  expect(await state.db.stockMovement.count()).toBe(2);
  const allocations = await state.db.stockAllocation.findMany(); expect(allocations.reduce((s: number, a: any) => s + a.quantity, 0)).toBe(500);
 });
 it("revalidates revoked warehouse assignment on a previously committed operation replay", async () => {
  const body = operation(requestPayload()); expect((await post(body)).status).toBe(200);
  await state.db.user.update({ where: { id: fixtureId }, data: { role: "WAREHOUSE_MANAGER", warehouseIds: [warehouses[2].id] } });
  expect((await post(body)).status).toBe(403); expect(await state.db.stockTransfer.count()).toBe(1);
 });
 it("preserves stable material issue retry identity and rejects spoofed outbox warehouse", async () => {
  const project = await state.db.project.create({ data: { code: "PRJ" + ++sequence, name: "Isolated construction", warehouseIds: [warehouses[0].id], createdBy: fixtureId } });
  const create = { ...operation({ action: "CREATE", projectId: project.id, warehouseId: warehouses[0].id, items: [{ productId: product.id, quantity: 10 }] }), operationType: "MATERIAL_ISSUE_LIFECYCLE" };
  const first = await post(create); expect(first.status).toBe(200); const issue = (await first.json()).issue;
  expect((await (await post(create)).json()).replayed).toBe(true);
  const submit = { ...operation({ action: "REQUEST", issueId: issue.id }), operationType: "MATERIAL_ISSUE_LIFECYCLE" };
  expect((await post({ ...submit, warehouseId: warehouses[1].id })).status).toBe(403);
  expect((await post(submit)).status).toBe(200); expect((await (await post(submit)).json()).replayed).toBe(true);
  expect((await state.db.projectMaterialIssue.findUnique({ where: { id: issue.id } })).status).toBe("REQUESTED");
  expect(await state.db.stockMovement.count()).toBe(0);
 });

 it("filters real procurement list handlers and rejects unauthorized creation before database writes", async () => {
  await manager();
  const assigned = await state.db.purchaseOrder.create({ data: { purchaseOrderNumber: "PO" + ++sequence, supplierId: fixtureId, warehouseId: warehouses[0].id, createdBy: fixtureId } });
  const foreign = await state.db.purchaseOrder.create({ data: { purchaseOrderNumber: "PO" + ++sequence, supplierId: fixtureId, warehouseId: warehouses[1].id, createdBy: fixtureId } });
  const response = await purchaseGet(request("purchase-orders")); expect(response.status).toBe(200);
  const rows = await response.json(); expect(rows.map((row: any) => row.id)).toContain(assigned.id); expect(rows.map((row: any) => row.id)).not.toContain(foreign.id);
  expect((await purchaseGet(request("purchase-orders?warehouseId=" + warehouses[1].id))).status).toBe(403);
  const count = await state.db.purchaseOrder.count();
  expect((await purchasePost(request("purchase-orders", { warehouseId: warehouses[1].id, supplierId: fixtureId, items: [] }))).status).toBe(403);
  expect(await state.db.purchaseOrder.count()).toBe(count);
 });
 it("filters location shelf list even when no parent rack filter is supplied", async () => {
  await manager();
  const assigned = await state.db.warehouseShelf.create({ data: { warehouseId: warehouses[0].id, rackId: fixtureId, name: "Assigned", code: "SH" + ++sequence } });
  const foreign = await state.db.warehouseShelf.create({ data: { warehouseId: warehouses[1].id, rackId: fixtureId, name: "Foreign", code: "SH" + ++sequence } });
  const response = await shelvesGet(request("locations/shelves")); expect(response.status).toBe(200);
  const rows = await response.json(); expect(rows.map((row: any) => row.id)).toContain(assigned.id); expect(rows.map((row: any) => row.id)).not.toContain(foreign.id);
 });

 it("paginates every authorized base allocation without duplicate or foreign rows", async () => {
  await manager();
  const ids = Array.from({ length: 500 }, (_, index) => (10000 + index).toString(16).padStart(24, "0"));
  await state.db.product.createMany({ data: ids.map((id: string, index: number) => ({ id, name: "Page product " + index, sku: "PAGE" + index, price: 1, quantity: 1, status: "IN_STOCK", supplierId: fixtureId, userId: fixtureId, createdBy: fixtureId })) });
  await state.db.stockAllocation.createMany({ data: ids.map((id: string) => ({ productId: id, warehouseId: warehouses[0].id, quantity: 1, reservedQuantity: 0, userId: fixtureId })) });
  const first = await (await syncGet(request("mobile-sync"))).json(); expect(first.hasMore).toBe(true); expect(first.items).toHaveLength(500); expect(first.nextCursor).toMatch(/^[a-f0-9]{24}$/);
  const second = await (await syncGet(request("mobile-sync?afterAllocationId=" + first.nextCursor))).json(); expect(second.hasMore).toBe(false); expect(second.nextCursor).toBeNull(); expect(second.items).toHaveLength(1);
  const rows = [...first.items, ...second.items]; expect(new Set(rows.map((row: any) => row.productId + ":" + row.warehouseId)).size).toBe(501);
  expect(rows.every((row: any) => row.warehouseId === warehouses[0].id)).toBe(true);
  expect((await syncGet(request("mobile-sync?afterAllocationId=invalid"))).status).toBe(422);
 });

 it("independently denies storekeeper approval and a different assigned manager through the mobile route", async () => {
  const project = await state.db.project.create({ data: { code: "ROLE" + ++sequence, name: "Role fixture", warehouseIds: [warehouses[0].id], assignedManagerId: fixtureId, createdBy: fixtureId } });
  const invoke = async (payload: any) => post({ ...operation(payload), operationType: "MATERIAL_ISSUE_LIFECYCLE" });
  const issue = (await (await invoke({ action: "CREATE", projectId: project.id, warehouseId: warehouses[0].id, items: [{ productId: product.id, quantity: 10 }] })).json()).issue;
  expect((await invoke({ action: "REQUEST", issueId: issue.id })).status).toBe(200);
  await state.db.user.update({ where: { id: fixtureId }, data: { role: "STOREKEEPER", warehouseIds: [warehouses[0].id] } });
  expect((await invoke({ action: "APPROVE", issueId: issue.id })).status).toBe(403);
  expect((await invoke({ action: "REJECT", issueId: issue.id })).status).toBe(403);
  await state.db.user.update({ where: { id: fixtureId }, data: { role: "WAREHOUSE_MANAGER" } });
  await state.db.project.update({ where: { id: project.id }, data: { assignedManagerId: "200000000000000000000001" } });
  expect((await invoke({ action: "APPROVE", issueId: issue.id })).status).toBe(403);
  expect((await state.db.projectMaterialIssue.findUnique({ where: { id: issue.id } })).status).toBe("REQUESTED");
  expect(await state.db.stockMovement.count()).toBe(0);
 });
 it("independently rejects project warehouse revocation even for a committed replay", async () => {
  const project = await state.db.project.create({ data: { code: "REVOKE" + ++sequence, name: "Scope fixture", warehouseIds: [warehouses[0].id], createdBy: fixtureId } });
  const body = { ...operation({ action: "CREATE", projectId: project.id, warehouseId: warehouses[0].id, items: [{ productId: product.id, quantity: 10 }] }), operationType: "MATERIAL_ISSUE_LIFECYCLE" };
  expect((await post(body)).status).toBe(200);
  await state.db.project.update({ where: { id: project.id }, data: { warehouseIds: [warehouses[1].id] } });
  expect((await post(body)).status).toBe(403);
  expect(await state.db.projectMaterialIssue.count({ where: { projectId: project.id } })).toBe(1);
 });
 it("independently rejects foreign issue item dispatch without stock or ledger mutation", async () => {
  const project = await state.db.project.create({ data: { code: "LINE" + ++sequence, name: "Line fixture", warehouseIds: [warehouses[0].id], createdBy: fixtureId } });
  const invoke = async (payload: any) => post({ ...operation(payload), operationType: "MATERIAL_ISSUE_LIFECYCLE" });
  const issue = (await (await invoke({ action: "CREATE", projectId: project.id, warehouseId: warehouses[0].id, items: [{ productId: product.id, quantity: 10 }] })).json()).issue;
  for (const action of ["REQUEST", "APPROVE", "RESERVE"]) expect((await invoke({ action, issueId: issue.id })).status).toBe(200);
  const result = await invoke({ action: "DISPATCH", issueId: issue.id, quantities: [{ issueItemId: "200000000000000000000002", quantity: 1 }] }); expect(result.status).toBe(400);
  expect((await state.db.projectMaterialIssue.findUnique({ where: { id: issue.id } })).status).toBe("RESERVED");
  expect((await state.db.stockAllocation.findFirst({ where: { productId: product.id, warehouseId: warehouses[0].id } })).quantity).toBe(100);
  expect(await state.db.stockMovement.count()).toBe(0);
 });

});


describe("Independent direct movement boundary", () => {
 const body = (movementType = "DAMAGE") => ({ productId: product.id, warehouseId: warehouses[0].id, quantity: 10, movementType });
 const callManual = (payload: any, key?: string) => manualPost(new NextRequest("http://isolated.test/api/stock-movements", {method:"POST", headers:{"content-type":"application/json", ...(key ? {"idempotency-key":key}: {})}, body:JSON.stringify(payload)}));
 it("rejects fabricated project, sale, transfer, purchase and return movements without approved documents", async () => {
  for(const type of ["PROJECT_ISSUE","PROJECT_RETURN","SALE","PURCHASE","TRANSFER_OUT","TRANSFER_IN","CUSTOMER_RETURN","SUPPLIER_RETURN"])
   expect((await callManual(body(type), "forged-"+type)).status).toBe(409);
  expect(await state.db.stockMovement.count()).toBe(0);
  expect((await state.db.product.findUnique({where:{id:product.id}})).quantity).toBe(500);
 });
 it("requires a stable key before manual stock mutation", async () => {
  expect((await callManual(body())).status).toBe(400);
  expect(await state.db.stockMovement.count()).toBe(0);
 });
 it("concurrent manual retries deduct exactly once and reject changed payload", async () => {
  const responses = await Promise.all(Array.from({length:20},()=>callManual(body(), "manual-retry")));
  expect(await Promise.all(responses.filter(response=>response.status!==201).map(response=>response.json()))).toEqual([]);
  expect(await state.db.stockMovement.count()).toBe(1);
  expect((await state.db.product.findUnique({where:{id:product.id}})).quantity).toBe(490);
  expect((await callManual({...body(),quantity:11}, "manual-retry")).status).toBe(409);
 });
 it("reauthorizes persisted warehouse assignment before replay", async () => {
  await manager(); const first=await callManual(body(), "revoke"); expect(first.status, JSON.stringify(await first.json())).toBe(201);
  await state.db.user.update({where:{id:fixtureId},data:{warehouseIds:[warehouses[1].id]}});
  expect((await callManual(body(), "revoke")).status).toBe(403);
  expect(await state.db.stockMovement.count()).toBe(1);
 });
 it("late operation receipt failure rolls stock and ledger back", async () => {
  const injected = new Proxy(state.db,{get(target,property){if(property==="$transaction")return (fn:any,options:any)=>target.$transaction((tx:any)=>fn(new Proxy(tx,{get(t,k){if(k==="inventoryOperation")return {...t.inventoryOperation,create:async()=>{throw Error("injected-marker-failure")}};return t[k];}})),options);return target[property];}});
  await expect(postManualMovement(injected, fixtureId, body(), "rollback")).rejects.toThrow("injected-marker-failure");
  expect(await state.db.stockMovement.count()).toBe(0);
  expect((await state.db.product.findUnique({where:{id:product.id}})).quantity).toBe(500);
 });
});


it("independent report includes transfer commitments and preserves six-decimal ledger units", async()=>{
 expect(calculateLedgerStockBalance([{movementType:"OPENING_BALANCE",quantityInBaseUnit:0.000003},{movementType:"PROJECT_ISSUE",quantityInBaseUnit:0.000001}])).toBe(0.000002);
 await applyTransferOperation(state.db, state.session, {...requestPayload(),idempotencyKey:"report-reservation"});
 const report=await reconcileProductWarehouse(product.id,warehouses[0].id);
 expect(report.reservedStock).toBe(10);expect(report.availableStock).toBe(90);
});

describe("Independent catalog stock bypass containment",()=>{
 const payload=()=>({id:product.id,name:"Audit Tile",sku:"ISOLATED-TILE",price:10,quantity:10,status:"IN_STOCK",categoryId:fixtureId,supplierId:fixtureId});
 it("rejects opening stock creation through catalog metadata",async()=>{
  const response=await createCatalog(request("products",{...payload(),sku:"FORGED-OPENING"}));
  expect(response.status,JSON.stringify(await response.json())).toBe(409);
  expect(await state.db.product.count({where:{sku:"FORGED-OPENING"}})).toBe(0);
 });
 it("rejects replacement and shrink paths without modifying allocations or ledger",async()=>{
  expect((await updateCatalog(request("products",payload()))).status).toBe(409);
  expect((await replaceCatalogStock(request("products/"+product.id,{quantity:999}),{params:Promise.resolve({id:product.id})})).status).toBe(409);
  expect((await state.db.product.findUniqueOrThrow({where:{id:product.id}})).quantity).toBe(500);
  expect((await state.db.stockAllocation.findMany({where:{productId:product.id}})).reduce((sum:any,a:any)=>sum+a.quantity,0)).toBe(500);
  expect(await state.db.stockMovement.count()).toBe(0);
 });
 it("denies viewer catalog mutations before any database write",async()=>{
  await state.db.user.update({where:{id:fixtureId},data:{role:"VIEWER"}});
  for(const handler of [createCatalog,updateCatalog,deleteCatalog])expect((await handler(request("products",payload()))).status).toBe(403);
  expect((await state.db.product.findUniqueOrThrow({where:{id:product.id}})).quantity).toBe(500);
 });
});

describe("Independent history-preserving product archival",()=>{
 const remove=()=>deleteCatalog(new NextRequest("http://isolated.test/api/products?id="+product.id,{method:"DELETE"}));
 const empty=async()=>{await state.db.purchaseOrder.updateMany({data:{status:"CANCELLED"}});await state.db.product.update({where:{id:product.id},data:{quantity:0}});await state.db.stockAllocation.updateMany({where:{productId:product.id},data:{quantity:0,reservedQuantity:0}});};
 it("rejects deleting a stocked product without removing warehouse allocations",async()=>{
  expect((await remove()).status).toBe(409);
  expect((await state.db.stockAllocation.findMany({where:{productId:product.id}})).reduce((sum:any,a:any)=>sum+a.quantity,0)).toBe(500);
  expect((await state.db.product.findUniqueOrThrow({where:{id:product.id}})).deletedAt).toBeNull();
 });
 it("archives an empty product while retaining every movement and allocation row",async()=>{
  await empty();
  for(const type of ["OPENING_BALANCE","SALE"])await state.db.stockMovement.create({data:{movementNumber:"ARCHIVE-"+type,productId:product.id,warehouseId:warehouses[0].id,movementType:type,quantity:1,quantityInBaseUnit:1,previousStock:type==="SALE"?1:0,newStock:type==="SALE"?0:1,performedBy:fixtureId}});
  const archived=await remove(); expect(archived.status,JSON.stringify(await archived.json())).toBe(200);
  expect(await state.db.stockMovement.count({where:{productId:product.id}})).toBe(2);
  expect(await state.db.stockAllocation.count({where:{productId:product.id}})).toBe(5);
  expect((await state.db.product.findUniqueOrThrow({where:{id:product.id}})).deletedAt).not.toBeNull();
  expect((await remove()).status).toBe(200);
 });
 it("serializes archival against a concurrent stock receipt without stock disappearance",async()=>{
  await empty();
  const results=await Promise.allSettled([archiveEmptyProduct(state.db,fixtureId,product.id),postManualMovement(state.db,fixtureId,{productId:product.id,warehouseId:warehouses[0].id,quantity:10,movementType:"OPENING_BALANCE"},"archive-race")]);
  expect(results.filter(x=>x.status==="fulfilled")).toHaveLength(1);
  const current=await state.db.product.findUniqueOrThrow({where:{id:product.id}});
  const physical=(await state.db.stockAllocation.findMany({where:{productId:product.id}})).reduce((sum:any,a:any)=>sum+a.quantity,0);
  expect(current.quantity).toBe(physical);
  if(current.deletedAt){expect(physical).toBe(0);expect(await state.db.stockMovement.count()).toBe(0);}
  else{expect(physical).toBe(10);expect(await state.db.stockMovement.count()).toBe(1);}
 });
});
