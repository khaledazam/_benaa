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


import { afterEach } from "vitest";
import { applyProjectManagement, applyProjectOperation, listProjectRecords } from "@/lib/projects/projectMaterialIssueService";
import { getStockAvailabilityInTx } from "@/lib/inventory/availability";
import { createStockReservation } from "@/lib/reservations/reservationService";
import { POST as projectApi } from "@/app/api/projects/material-issues/route";
let project: any;
const act = (body: any, actor = state.session) => applyProjectOperation(state.db, actor, { ...body, idempotencyKey: body.idempotencyKey || key() });
beforeEach(async () => {
  for (const model of ["projectMaterialIssueReturn", "projectMaterialIssueItem", "projectMaterialIssue", "project", "auditLog", "stockReservationItem", "stockReservation", "salesOrderItem", "salesOrder", "customer", "stockLocationAllocation", "warehouseBin", "inventoryBatch"]) await state.db[model].deleteMany({});
  await state.db.product.update({ where: { id: product.id }, data: { reservedQuantity: 0, unitId: null, trackingMode: "NONE", isActive: true } });
  await state.db.user.update({ where: { id: fixtureId }, data: { role: "SUPER_ADMIN", status: true, warehouseIds: [] } });
  project = (await applyProjectManagement(state.db, state.session, { code: `PRJ-${++sequence}`, name: "Isolated internal construction", location: "Isolated site", assignedManagerId: fixtureId, warehouseIds: [warehouses[0].id], idempotencyKey: key() })).project;
});
async function draft(amount = 10, extra: any = {}) {
  return (await act({ action: "CREATE", projectId: project.id, warehouseId: warehouses[0].id, recipientName: "Isolated site custodian", items: [{ productId: product.id, quantity: amount, ...extra }] })).issue;
}
async function reserve(amount = 10, extra: any = {}) {
  const issue = await draft(amount, extra);
  await act({ action: "REQUEST", issueId: issue.id });
  await act({ action: "APPROVE", issueId: issue.id });
  return (await act({ action: "RESERVE", issueId: issue.id })).issue;
}
const quantities = (issue: any, amount: number) => [{ issueItemId: issue.items[0].id, quantity: amount }];
async function reconcileProject() {
  const allocations = await state.db.stockAllocation.findMany({ where: { productId: product.id } });
  const items = await state.db.projectMaterialIssueItem.findMany({ where: { productId: product.id } });
  const physical = allocations.reduce((s: number, a: any) => s + a.quantity, 0);
  const custody = items.reduce((s: number, i: any) => s + i.dispatchedQuantity - i.returnedQuantity, 0);
  expect(physical + custody).toBeCloseTo(500, 8);
  expect((await state.db.product.findUnique({ where: { id: product.id } })).quantity).toBeCloseTo(physical, 8);
  const movements = await state.db.stockMovement.findMany({ where: { productId: product.id } });
  for (const a of allocations) {
    const delta = movements.filter((m: any) => m.warehouseId === a.warehouseId).reduce((s: number, m: any) => s + (m.movementType === "PROJECT_RETURN" ? m.quantityInBaseUnit : -m.quantityInBaseUnit), 0);
    expect(a.quantity).toBeCloseTo(100 + delta, 8);
    expect(a.quantity).toBeGreaterThanOrEqual(0);
  }
  expect(items.every((i: any) => i.remainingQuantity >= 0 && i.reservedQuantity === i.remainingQuantity && i.returnedQuantity <= i.dispatchedQuantity && i.dispatchedQuantity + i.remainingQuantity + i.releasedQuantity <= i.quantity)).toBe(true);
  return { physical, custody, items, movements };
}
afterEach(async () => {
  await reconcileProject();
  for (const model of ["invoice", "order"]) expect(await state.db[model].count()).toBe(0);
});

describe("Approved internal project material issue lifecycle on isolated MongoDB", () => {
  it("full approved lifecycle and partial unused returns create no sales/invoice/debt records", async () => {
    const issue = await reserve();
    expect((await getStockAvailabilityInTx(state.db, product.id, warehouses[0].id)).availableStock).toBe(90);
    await act({ action: "DISPATCH", issueId: issue.id, quantities: quantities(issue, 4) });
    await expect(act({ action: "COMPLETE", issueId: issue.id })).rejects.toThrow("all reserved");
    await act({ action: "DISPATCH", issueId: issue.id, quantities: quantities(issue, 6) });
    expect((await act({ action: "COMPLETE", issueId: issue.id })).issue.status).toBe("COMPLETED");
    await act({ action: "RETURN", issueId: issue.id, quantities: quantities(issue, 3), reason: "Unused unopened material" });
    await act({ action: "RETURN", issueId: issue.id, quantities: quantities(issue, 2) });
    const r = await reconcileProject(); expect(r.physical).toBe(495); expect(r.custody).toBe(5);
    expect(r.items[0]).toMatchObject({ quantity: 10, dispatchedQuantity: 10, returnedQuantity: 5, remainingQuantity: 0 });
    expect(await state.db.projectMaterialIssueReturn.count()).toBe(2);
    for (const returned of await state.db.projectMaterialIssueReturn.findMany()) {
      const movement = await state.db.stockMovement.findUnique({ where: { id: returned.stockMovementId } });
      expect(movement).toMatchObject({ movementType: "PROJECT_RETURN", referenceId: issue.id, quantityInBaseUnit: returned.quantity, performedBy: fixtureId });
    }
    expect(await state.db.salesOrder.count()).toBe(0); expect(await state.db.customer.count()).toBe(0);
    expect(await state.db.auditLog.count({ where: { entityType: "ProjectMaterialIssue" } })).toBe(9);
  });
  it("dispatch before manager approval or reservation rejects without stock changes", async () => {
    const issue = await draft();
    await expect(act({ action: "DISPATCH", issueId: issue.id, quantities: quantities(issue, 10) })).rejects.toThrow("state transition");
    await act({ action: "REQUEST", issueId: issue.id });
    await expect(act({ action: "RESERVE", issueId: issue.id })).rejects.toThrow("state transition");
    expect((await reconcileProject()).physical).toBe(500);
  });
  it("storekeeper cannot approve and role revocation blocks replay", async () => {
    const issue = await draft(); await act({ action: "REQUEST", issueId: issue.id });
    await state.db.user.update({ where: { id: fixtureId }, data: { role: "STOREKEEPER", warehouseIds: [warehouses[0].id] } });
    await expect(act({ action: "APPROVE", issueId: issue.id })).rejects.toThrow("assigned warehouse manager");
    await state.db.user.update({ where: { id: fixtureId }, data: { role: "VIEWER" } });
    await expect(act({ action: "REQUEST", issueId: issue.id })).rejects.toThrow("authorized warehouse employee");
  });
  it("current warehouse reassignment blocks dispatch and idempotent replay", async () => {
    const issue = await reserve(); const body = { action: "DISPATCH", issueId: issue.id, quantities: quantities(issue, 4), idempotencyKey: key() };
    await act(body);
    await state.db.user.update({ where: { id: fixtureId }, data: { role: "STOREKEEPER", warehouseIds: [warehouses[1].id] } });
    await expect(act(body)).rejects.toThrow("Forbidden project warehouse");
    await expect(act({ ...body, idempotencyKey: key() })).rejects.toThrow("Forbidden project warehouse");
    expect((await reconcileProject()).custody).toBe(4);
  });
  it("project warehouse permissions reject an otherwise accessible source", async () => {
    await expect(act({ action: "CREATE", projectId: project.id, warehouseId: warehouses[1].id, items: [{ productId: product.id, quantity: 1 }] })).rejects.toThrow("Forbidden project warehouse");
    expect(await state.db.projectMaterialIssue.count()).toBe(0);
  });
  it("rejection and cancel before dispatch preserve stock and release commitments", async () => {
    const rejected = await draft(); await act({ action: "REQUEST", issueId: rejected.id });
    expect((await act({ action: "REJECT", issueId: rejected.id, reason: "Not required" })).issue.status).toBe("REJECTED");
    const issue = await reserve(80);
    expect((await act({ action: "CANCEL", issueId: issue.id })).issue.status).toBe("CANCELLED");
    expect((await getStockAvailabilityInTx(state.db, product.id, warehouses[0].id)).availableStock).toBe(100);
    expect((await reconcileProject()).physical).toBe(500);
  });
  it("partial dispatch then release/cancel preserves actual custody and permits bounded return", async () => {
    const issue = await reserve();
    await act({ action: "DISPATCH", issueId: issue.id, quantities: quantities(issue, 4) });
    await act({ action: "RELEASE", issueId: issue.id, quantities: quantities(issue, 2) });
    await act({ action: "CANCEL", issueId: issue.id });
    const after = await act({ action: "RETURN", issueId: issue.id, quantities: quantities(issue, 4) });
    expect(after.issue.items[0]).toMatchObject({ dispatchedQuantity: 4, returnedQuantity: 4, releasedQuantity: 6, remainingQuantity: 0 });
    expect((await reconcileProject()).physical).toBe(500);
  });
  it.each([-1, 0, Infinity, NaN, "10", 0.0000001])("rejects invalid requested base quantity %s", async amount => {
    await expect(draft(amount as any)).rejects.toThrow();
    expect(await state.db.projectMaterialIssue.count()).toBe(0);
  });
  it("aggregates duplicate product lines before reserving and rejects insufficient stock", async () => {
    const created = await act({ action: "CREATE", projectId: project.id, warehouseId: warehouses[0].id, items: [{ productId: product.id, quantity: 60 }, { productId: product.id, quantity: 60 }] });
    await act({ action: "REQUEST", issueId: created.issue.id }); await act({ action: "APPROVE", issueId: created.issue.id });
    await expect(act({ action: "RESERVE", issueId: created.issue.id })).rejects.toThrow("Insufficient uncommitted");
    expect((await getStockAvailabilityInTx(state.db, product.id, warehouses[0].id)).availableStock).toBe(100);
  });
  it("concurrent distinct project requests cannot reserve beyond stock", async () => {
    const drafts = await Promise.all(Array.from({ length: 4 }, () => draft(30)));
    for (const d of drafts) { await act({ action: "REQUEST", issueId: d.id }); await act({ action: "APPROVE", issueId: d.id }); }
    const results = await Promise.allSettled(drafts.map(d => act({ action: "RESERVE", issueId: d.id })));
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(3);
    expect((await getStockAvailabilityInTx(state.db, product.id, warehouses[0].id)).availableStock).toBe(10);
  });
  it("concurrent duplicate submissions, dispatch and return mutate each leg once", async () => {
    const issue = await reserve();
    const dispatch = { action: "DISPATCH", issueId: issue.id, quantities: quantities(issue, 10), idempotencyKey: key() };
    const results = await Promise.all(Array.from({ length: 20 }, () => act(dispatch)));
    expect(results.every(r => r.success)).toBe(true);
    expect((await reconcileProject()).custody).toBe(10);
    const returned = { action: "RETURN", issueId: issue.id, quantities: quantities(issue, 6), idempotencyKey: key() };
    await Promise.all(Array.from({ length: 20 }, () => act(returned)));
    expect((await reconcileProject()).custody).toBe(4);
    expect(await state.db.stockMovement.count()).toBe(2); expect(await state.db.projectMaterialIssueReturn.count()).toBe(1);
  });
  it("distinct concurrent actual requests cannot overdispatch or overreturn", async () => {
    const issue = await reserve();
    const dispatched = await Promise.allSettled(Array.from({ length: 10 }, () => act({ action: "DISPATCH", issueId: issue.id, quantities: quantities(issue, 6) })));
    expect(dispatched.filter(r => r.status === "fulfilled")).toHaveLength(1);
    const returned = await Promise.allSettled(Array.from({ length: 10 }, () => act({ action: "RETURN", issueId: issue.id, quantities: quantities(issue, 4) })));
    expect(returned.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect((await reconcileProject()).custody).toBe(2);
  });
  it("over-return and foreign issue lines reject atomically", async () => {
    const issue = await reserve(); await act({ action: "DISPATCH", issueId: issue.id, quantities: quantities(issue, 4) });
    await expect(act({ action: "RETURN", issueId: issue.id, quantities: quantities(issue, 5) })).rejects.toThrow("exceeds net issued");
    await expect(act({ action: "DISPATCH", issueId: issue.id, quantities: [{ issueItemId: fixtureId, quantity: 1 }] })).rejects.toThrow("does not belong");
    expect((await reconcileProject()).custody).toBe(4);
  });
  it("sales reservations and project reservations share authoritative availability", async () => {
    const customer = await state.db.customer.create({ data: { customerCode: `ISOLATED-${++sequence}`, name: "Isolated sales customer", createdBy: fixtureId } });
    const order = await state.db.salesOrder.create({ data: { salesOrderNumber: `SO-${++sequence}`, customerId: customer.id, warehouseId: warehouses[0].id, createdBy: fixtureId, status: "APPROVED", items: { create: [{ productId: product.id, productName: product.name, orderedQuantity: 80, unitPrice: 10, lineTotal: 800 }] } } });
    await createStockReservation(order.id, fixtureId);
    const issue = await draft(30); await act({ action: "REQUEST", issueId: issue.id }); await act({ action: "APPROVE", issueId: issue.id });
    await expect(act({ action: "RESERVE", issueId: issue.id })).rejects.toThrow("Insufficient uncommitted");
    const small = await reserve(20);
    expect((await getStockAvailabilityInTx(state.db, product.id, warehouses[0].id)).availableStock).toBe(0);
    expect(small.items[0].remainingQuantity).toBe(20);
  });
  it("tracked/bin dispatch and unused return conserve all quantity layers", async () => {
    const bin = await state.db.warehouseBin.create({ data: { shelfId: fixtureId, warehouseId: warehouses[0].id, code: "PROJECT-BIN", name: "Project source" } });
    await state.db.stockLocationAllocation.create({ data: { productId: product.id, warehouseId: warehouses[0].id, binId: bin.id, quantity: 100, quantityInBaseUnit: 100 } });
    await state.db.product.update({ where: { id: product.id }, data: { trackingMode: "BATCH" } });
    const batch = await state.db.inventoryBatch.create({ data: { productId: product.id, warehouseId: warehouses[0].id, batchNumber: "PROJECT-BATCH", quantity: 100 } });
    const issue = await reserve(10, { binId: bin.id, batchId: batch.id });
    await act({ action: "DISPATCH", issueId: issue.id, quantities: quantities(issue, 10) });
    await act({ action: "RETURN", issueId: issue.id, quantities: quantities(issue, 3) });
    expect((await state.db.inventoryBatch.findUnique({ where: { id: batch.id } })).quantity).toBe(93);
    expect((await state.db.inventoryBatch.findUnique({ where: { id: batch.id } })).reservedQuantity).toBe(0);
    expect((await state.db.stockLocationAllocation.findUnique({ where: { productId_binId: { productId: product.id, binId: bin.id } } })).quantityInBaseUnit).toBe(93);
    expect((await reconcileProject()).movements.every((m: any) => m.batchId === batch.id)).toBe(true);
  });
  it("last operation marker failure rolls back physical dispatch and issue accounting", async () => {
    const issue = await reserve(); const db = state.db;
    state.db = new Proxy(db, { get(target, prop) {
      if (prop === "$transaction") return (work: any, options: any) => target.$transaction((tx: any) => work(new Proxy(tx, { get(t, p) {
        if (p === "inventoryOperation") return { ...t.inventoryOperation, create: async () => { throw new Error("isolated final project marker failure"); } };
        return t[p];
      } })), options);
      const value = target[prop]; return typeof value === "function" ? value.bind(target) : value;
    } });
    try { await expect(act({ action: "DISPATCH", issueId: issue.id, quantities: quantities(issue, 10) })).rejects.toThrow("isolated final project marker failure"); } finally { state.db = db; }
    expect((await reconcileProject()).physical).toBe(500);
    expect((await state.db.projectMaterialIssueItem.findUnique({ where: { id: issue.items[0].id } })).remainingQuantity).toBe(10);
    expect(await state.db.stockMovement.count()).toBe(0);
    await act({ action: "DISPATCH", issueId: issue.id, quantities: quantities(issue, 10) });
    expect((await reconcileProject()).custody).toBe(10);
  });
  it("API rejects unauthorized session and returns persisted lifecycle result", async () => {
    const saved = state.session; state.session = null;
    try { expect((await projectApi(new NextRequest("http://isolated.test/api/projects/material-issues", { method: "POST", body: "{}" }))).status).toBe(401); } finally { state.session = saved; }
    const response = await projectApi(new NextRequest("http://isolated.test/api/projects/material-issues", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "CREATE", projectId: project.id, warehouseId: warehouses[0].id, items: [{ productId: product.id, quantity: 1 }], idempotencyKey: key() }) }));
    expect(response.status).toBe(201); expect((await response.json()).issue.status).toBe("DRAFT");
    expect((await listProjectRecords(state.db, state.session, { issues: true })).issues).toHaveLength(1);
  });
});

it("concurrent duplicate create/request/reserve submissions commit one document and reservation", async () => {
  const body = { action: "CREATE", projectId: project.id, warehouseId: warehouses[0].id, items: [{ productId: product.id, quantity: 10 }], idempotencyKey: key() };
  const drafts = await Promise.all(Array.from({ length: 10 }, () => act(body)));
  expect(new Set(drafts.map(r => r.issue.id)).size).toBe(1);
  const issue = drafts[0].issue;
  const requested = { action: "REQUEST", issueId: issue.id, idempotencyKey: key() };
  await Promise.all(Array.from({ length: 10 }, () => act(requested)));
  await act({ action: "APPROVE", issueId: issue.id });
  const reserved = { action: "RESERVE", issueId: issue.id, idempotencyKey: key() };
  await Promise.all(Array.from({ length: 10 }, () => act(reserved)));
  expect(await state.db.projectMaterialIssue.count()).toBe(1);
  expect((await state.db.projectMaterialIssueItem.findUnique({ where: { id: issue.items[0].id } })).remainingQuantity).toBe(10);
  expect((await getStockAvailabilityInTx(state.db, product.id, warehouses[0].id)).availableStock).toBe(90);
});

it("a project reservation prevents later sales from overcommitting source stock", async () => {
  await reserve(80);
  const customer = await state.db.customer.create({ data: { customerCode: `ISOLATED-REVERSE-${++sequence}`, name: "Isolated sales customer", createdBy: fixtureId } });
  const order = await state.db.salesOrder.create({ data: { salesOrderNumber: `SO-REV-${++sequence}`, customerId: customer.id, warehouseId: warehouses[0].id, createdBy: fixtureId, status: "APPROVED", items: { create: [{ productId: product.id, productName: product.name, orderedQuantity: 30, unitPrice: 10, lineTotal: 300 }] } } });
  await expect(createStockReservation(order.id, fixtureId)).rejects.toThrow("Insufficient available");
  expect(await state.db.stockReservation.count()).toBe(0);
  expect((await getStockAvailabilityInTx(state.db, product.id, warehouses[0].id)).availableStock).toBe(20);
});

it("offline-style stale reserve conflicts safely and original idempotency key rejects changed payload", async () => {
  const reserved = await reserve(90);
  const issue = await draft(20); await act({ action: "REQUEST", issueId: issue.id }); await act({ action: "APPROVE", issueId: issue.id });
  const body = { action: "RESERVE", issueId: issue.id, idempotencyKey: key() };
  await expect(act(body)).rejects.toThrow("Insufficient uncommitted");
  expect((await state.db.projectMaterialIssue.findUnique({ where: { id: issue.id } })).status).toBe("APPROVED");
  await act({ action: "CANCEL", issueId: reserved.id });
  expect((await act(body)).issue.status).toBe("RESERVED");
  const dispatch = { action: "DISPATCH", issueId: issue.id, quantities: quantities(issue, 4), idempotencyKey: key() };
  await act(dispatch);
  await expect(act({ ...dispatch, quantities: quantities(issue, 5) })).rejects.toThrow("payload mismatch");
  expect((await reconcileProject()).custody).toBe(4);
});

it("default assigned manager and current project manager replacement enforce approval ownership", async () => {
  const managed = await applyProjectManagement(state.db, state.session, { code: `DEFAULT-${++sequence}`, name: "Default manager project", warehouseIds: [warehouses[0].id], idempotencyKey: key() });
  expect(managed.project.assignedManagerId).toBe(fixtureId);
  const other = await state.db.user.create({ data: { email: `manager-${++sequence}@isolated.test`, name: "Other manager", password: "unused", role: "WAREHOUSE_MANAGER", warehouseIds: [warehouses[0].id], createdAt: new Date(), permissions: [] } });
  const issue = await draft(); await act({ action: "REQUEST", issueId: issue.id });
  await expect(act({ action: "APPROVE", issueId: issue.id }, other)).rejects.toThrow("assigned warehouse manager");
  await applyProjectManagement(state.db, state.session, { projectId: project.id, assignedManagerId: other.id, idempotencyKey: key() });
  expect((await act({ action: "APPROVE", issueId: issue.id }, other)).issue.approvedBy).toBe(other.id);
});

it("product base-unit changes block existing issue posting for explicit reconciliation", async () => {
  const issue = await reserve();
  await state.db.product.update({ where: { id: product.id }, data: { unitId: fixtureId } });
  await expect(act({ action: "DISPATCH", issueId: issue.id, quantities: quantities(issue, 10) })).rejects.toThrow("base unit changed");
  expect(await state.db.stockMovement.count()).toBe(0);
  expect((await state.db.projectMaterialIssueItem.findUnique({ where: { id: issue.items[0].id } })).remainingQuantity).toBe(10);
});

it.each(["DISPATCH", "RETURN"])("invalid %s actual quantities never mutate stock or custody", async action => {
  const issue = await reserve();
  if (action === "RETURN") await act({ action: "DISPATCH", issueId: issue.id, quantities: quantities(issue, 10) });
  const before = await state.db.stockMovement.count();
  for (const amount of [-1, 0, NaN, Infinity, 0.0000001, 11]) await expect(act({ action, issueId: issue.id, quantities: quantities(issue, amount) })).rejects.toThrow();
  expect(await state.db.stockMovement.count()).toBe(before);
  expect((await reconcileProject()).custody).toBe(action === "RETURN" ? 10 : 0);
});

it("final return marker failure rolls back receiver evidence and stock; retry returns once", async () => {
  const issue = await reserve(); await act({ action: "DISPATCH", issueId: issue.id, quantities: quantities(issue, 10) });
  const db = state.db;
  state.db = new Proxy(db, { get(target, prop) {
    if (prop === "$transaction") return (work: any, options: any) => target.$transaction((tx: any) => work(new Proxy(tx, { get(t, p) {
      if (p === "inventoryOperation") return { ...t.inventoryOperation, create: async () => { throw new Error("isolated final return marker failure"); } };
      return t[p];
    } })), options);
    const value = target[prop]; return typeof value === "function" ? value.bind(target) : value;
  } });
  const body = { action: "RETURN", issueId: issue.id, quantities: quantities(issue, 3), idempotencyKey: key() };
  try { await expect(act(body)).rejects.toThrow("isolated final return marker failure"); } finally { state.db = db; }
  expect((await reconcileProject()).custody).toBe(10);
  expect(await db.projectMaterialIssueReturn.count()).toBe(0); expect(await db.stockMovement.count()).toBe(1);
  await act(body); await act(body);
  expect((await reconcileProject()).custody).toBe(7);
  expect(await db.projectMaterialIssueReturn.count()).toBe(1); expect(await db.stockMovement.count()).toBe(2);
});

it.each(["employee", "project"])("concurrent %s permission revocation aborts a snapshot-authorized fresh dispatch", async target => {
  const issue = await reserve(); const db = state.db;
  let reached!: () => void, resume!: () => void;
  const paused = new Promise<void>(resolve => { reached = resolve; });
  const release = new Promise<void>(resolve => { resume = resolve; });
  let intercepted = false;
  const guardedDb = new Proxy(db, { get(root, prop) {
    if (prop === "$transaction") return (work: any, options: any) => root.$transaction((tx: any) => work(new Proxy(tx, { get(t, p) {
      if (p === (target === "employee" ? "user" : "project")) return { ...t[p], findUnique: async (input: any) => {
        const result = await t[p].findUnique(input);
        if (!intercepted) { intercepted = true; reached(); await release; }
        return result;
      } };
      return t[p];
    } })), options);
    const value = root[prop]; return typeof value === "function" ? value.bind(root) : value;
  } });
  const pending = applyProjectOperation(guardedDb, state.session, { action: "DISPATCH", issueId: issue.id, quantities: quantities(issue, 10), idempotencyKey: key() });
  // Attach rejection handling before releasing the deterministic transaction barrier.
  const result = pending.then(value => ({ value, error: null as any }), error => ({ value: null, error }));
  await paused;
  try {
    if (target === "employee") await db.user.update({ where: { id: fixtureId }, data: { role: "VIEWER" } });
    else await db.project.update({ where: { id: project.id }, data: { warehouseIds: [] } });
  } finally { resume(); }
  const outcome = await result;
  expect(outcome.value).toBeNull(); expect(outcome.error?.status).toBe(403);
  expect((await reconcileProject()).physical).toBe(500);
  expect(await db.stockMovement.count()).toBe(0);
  expect((await db.projectMaterialIssueItem.findUnique({ where: { id: issue.items[0].id } })).remainingQuantity).toBe(10);
});
