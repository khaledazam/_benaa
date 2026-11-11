/** Explicit opt-in, disposable replica only. Does not import .env or prisma/client.
 * Run: vitest run --config vitest.audit.config.ts
 * Passing defect characterizations document blockers, not production correctness.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
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

beforeAll(async () => {
  const binary = path.join(process.env.USERPROFILE || "", ".cache", "mongodb-binaries", "mongod-x64-win32-8.2.6.exe");
  if (!fs.existsSync(binary)) throw new Error("Cached mongod is required; downloads are prohibited for this audit");
  process.env.MONGOMS_RUNTIME_DOWNLOAD = "false";
  replica = await MongoMemoryReplSet.create({ binary: { systemBinary: binary, version: "8.2.6" }, replSet: { count: 1, ip: "127.0.0.1" } });
  const uri = replica.getUri(`benaa_audit_${Date.now()}`);
  if (!/^mongodb:\/\/127\.0\.0\.1:\d+\/benaa_audit_\d+\?/.test(uri)) throw new Error("Refusing non-isolated database URL");
  state.db = new PrismaClient({ datasources: { db: { url: uri } } });
  await state.db.$connect();
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

describe("Isolated replica: five dynamic warehouses and transfer defect proofs", () => {
  it("REQUEST -> APPROVE -> RECEIVE creates inventory without dispatch", async () => {
    const before = await state.db.stockAllocation.aggregate({ _sum: { quantity: true } });
    const response = await call({ action: "REQUEST", productId: product.id, fromWarehouseId: warehouses[0].id, toWarehouseId: warehouses[1].id, quantity: 30 });
    expect(response.status).toBe(201);
    const { transfer } = await response.json();
    expect((await call({ action: "APPROVE", transferId: transfer.id })).status).toBe(200);
    expect((await call({ action: "RECEIVE", transferId: transfer.id, receivedQuantity: 30 })).status).toBe(200);
    const after = await state.db.stockAllocation.aggregate({ _sum: { quantity: true } });
    expect(after._sum.quantity - before._sum.quantity).toBe(30);
    const source = await state.db.stockAllocation.findUnique({ where: { productId_warehouseId: { productId: product.id, warehouseId: warehouses[0].id } } });
    expect(source.quantity).toBe(100);
    expect(source.reservedQuantity).toBe(30);
    console.log("DEFECT PROVEN: five warehouses, aggregate physical 500 -> 530; source remains 100 with 30 reserved; zero dispatch");
  });

  it("negative receipt creates a negative destination allocation", async () => {
    const transfer = await state.db.stockTransfer.create({ data: { transferNumber: "AUDIT-NEGATIVE", productId: product.id, fromWarehouseId: warehouses[2].id, toWarehouseId: warehouses[3].id, quantity: 10, status: "DISPATCHED", userId: fixtureId } });
    const response = await call({ action: "RECEIVE", transferId: transfer.id, receivedQuantity: -150 });
    expect(response.status).toBe(200);
    const dest = await state.db.stockAllocation.findUnique({ where: { productId_warehouseId: { productId: product.id, warehouseId: warehouses[3].id } } });
    expect(dest.quantity).toBe(-50);
    console.log("DEFECT PROVEN: receivedQuantity=-150 accepted; destination 100 -> -50");
  });

  it("two stale APPROVED prechecks permit duplicate dispatch under controlled request scheduling", async () => {
    const db = state.db;
    const source = warehouses[4];
    const transfer = await db.stockTransfer.create({ data: { transferNumber: "AUDIT-CONCURRENT", productId: product.id, fromWarehouseId: source.id, toWarehouseId: warehouses[2].id, quantity: 10, status: "APPROVED", userId: fixtureId } });
    await db.stockAllocation.update({ where: { productId_warehouseId: { productId: product.id, warehouseId: source.id } }, data: { reservedQuantity: 10 } });
    // Hold both requests after their external prechecks, then serialize their REAL
    // DB transactions. This deterministic scheduling exposes the missing in-tx CAS.
    let arrivals = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let queue = Promise.resolve();
    state.db = new Proxy(db, { get(target, key) {
      if (key === "$transaction") return async (fn: any) => {
        if (++arrivals === 2) release();
        await gate;
        const run = queue.then(() => target.$transaction(fn));
        queue = run.then(() => undefined);
        return run;
      };
      const value = target[key];
      return typeof value === "function" ? value.bind(target) : value;
    } });
    try {
      const responses = await Promise.all([call({ action: "DISPATCH", transferId: transfer.id }), call({ action: "DISPATCH", transferId: transfer.id })]);
      expect(responses.map((response) => response.status)).toEqual([200, 200]);
      const allocation = await db.stockAllocation.findUnique({ where: { productId_warehouseId: { productId: product.id, warehouseId: source.id } } });
      expect(allocation.quantity).toBe(80);
      expect(await db.stockMovement.count({ where: { warehouseId: source.id, movementType: "TRANSFER_OUT" } })).toBe(2);
      console.log("DEFECT PROVEN: two requests pass APPROVED precheck; one 10-unit transfer deducts 20 via two real transactions");
    } finally { state.db = db; }
  });

  it("records limited contention metrics at 10/25/50/100 clients without certifying acceptance", async () => {
    const db = state.db;
    const metrics: any[] = [];
    for (const clients of [10, 25, 50, 100]) {
      for (const action of ["REQUEST", "DISPATCH", "RECEIVE"]) {
        const source = warehouses[0], dest = warehouses[1];
        for (const warehouse of [source, dest]) {
          await db.stockAllocation.update({ where: { productId_warehouseId: { productId: product.id, warehouseId: warehouse.id } }, data: { quantity: 1000, reservedQuantity: action === "DISPATCH" && warehouse.id === source.id ? 1 : 0 } });
        }
        const transfer = action === "REQUEST" ? null : await db.stockTransfer.create({ data: { transferNumber: `AUDIT-LOAD-${action}-${clients}`, productId: product.id, fromWarehouseId: source.id, toWarehouseId: dest.id, quantity: 1, status: action === "DISPATCH" ? "APPROVED" : "DISPATCHED", userId: fixtureId } });
        const outcomes = await Promise.all(Array.from({ length: clients }, async () => {
          const started = performance.now();
          const response = await call(action === "REQUEST" ? { action, productId: product.id, fromWarehouseId: source.id, toWarehouseId: dest.id, quantity: 1 } : { action, transferId: transfer.id });
          const result = await response.json();
          return { status: response.status, elapsedMs: performance.now() - started, error: result.error || null };
        }));
        const durations = outcomes.map((item) => item.elapsedMs).sort((a, b) => a - b);
        const sourceAfter = await db.stockAllocation.findUnique({ where: { productId_warehouseId: { productId: product.id, warehouseId: source.id } } });
        const destAfter = await db.stockAllocation.findUnique({ where: { productId_warehouseId: { productId: product.id, warehouseId: dest.id } } });
        const metric = { clients, action, successes: outcomes.filter((item) => item.status < 300).length, errors: outcomes.filter((item) => item.status >= 400).length,
          p50Ms: Math.round(durations[Math.ceil(clients * .5) - 1]!), p95Ms: Math.round(durations[Math.ceil(clients * .95) - 1]!), maxMs: Math.round(durations[clients - 1]!),
          sourceStock: sourceAfter.quantity, destinationStock: destAfter.quantity, sourceReserved: sourceAfter.reservedQuantity,
          sampleError: outcomes.find((item) => item.error)?.error || null };
        metrics.push(metric);
        console.log(JSON.stringify(metric));
        if (transfer) {
          const priorQty = action === "DISPATCH" ? sourceAfter.quantity : destAfter.quantity;
          const retry = await call({ action, transferId: transfer.id });
          const afterRetry = await db.stockAllocation.findUnique({ where: { productId_warehouseId: { productId: product.id, warehouseId: action === "DISPATCH" ? source.id : dest.id } } });
          // Sequential retry is rejected once a request completes, unlike stale concurrent prechecks.
          expect(retry.status).toBe(400);
          expect(afterRetry.quantity).toBe(priorQty);
        }
      }
    }
    const response = await discover(new NextRequest(`http://isolated.test/api/inventory/cross-warehouse?productId=${product.id}&currentWarehouseId=${warehouses[0].id}`));
    expect(response.status).toBe(200);
    const discovery = await response.json();
    const directory = path.resolve("docs/PRODUCTION_CERTIFICATION");
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, "isolated-contention-metrics.json"), JSON.stringify({
      generatedAt: new Date().toISOString(), environment: "Disposable MongoDB 8.2.6 single-member replica on loopback; real Prisma and route handlers; mocked verified super-admin session; 5 dynamic warehouses; no production connection", interpretation: "Limited contention observations and defect evidence; not a production load certification", metrics, discovery,
    }, null, 2));
  }, 120000);
});
