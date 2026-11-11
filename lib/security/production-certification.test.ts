vi.mock("@/lib/cache/post-mutation", () => ({ scheduleInvalidateUserCaches: vi.fn() }));
vi.mock("@/lib/queue/qstash", () => ({ isQStashConfigured: () => false }));
vi.mock("@/lib/email/queue", () => ({ sendEmailDirectly: vi.fn() }));
import { beforeEach, describe, expect, it, vi } from "vitest";
import jwt from "jsonwebtoken";
import { NextRequest } from "next/server";
const db = vi.hoisted(() => ({ revokedSession: { findUnique: vi.fn(async () => null) }, $transaction: vi.fn(), auditLog: { create: vi.fn() }, user: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn(), create: vi.fn() }, warehouse: { findMany: vi.fn(), count: vi.fn() } }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/cache", () => ({ scheduleInvalidateAuthCaches: vi.fn() }));
vi.mock("@/lib/auth/oauth", () => ({ isGoogleOAuthConfigured: () => true, getGoogleClientId: () => "mock-client", getGoogleClientSecret: () => "mock-secret" }));
vi.mock("@/prisma/client", () => ({ prisma: db }));
vi.mock("@/lib/ai/benaa-analytics-engine", () => ({ computeAuthoritativeMetrics: vi.fn(), generateBenaaAiIntelligence: vi.fn() }));
import { generateToken, getSessionFromRequest, isAccountAccessAllowed, verifyToken } from "@/utils/auth";
import * as employees from "@/app/api/admin/employees/route";
import * as intelligence from "@/app/api/ai/benaa-intelligence/route";
import { POST as register } from "@/app/api/auth/register/route";
import * as seed from "@/app/api/seed/route";
import { GET as oauthCallback } from "@/app/api/auth/oauth/google/callback/route";
import { POST as shippingWebhook } from "@/app/api/shipping/webhook/route";
import { POST as emailQueue } from "@/app/api/email/queue/process/route";
import { sendEmailDirectly } from "@/lib/email/queue";
import { hasPermission } from "@/lib/auth/permissions";
import { GET as listProducts } from '@/app/api/products/route';
import { GET as productDetail } from '@/app/api/products/[id]/route';
const id = "0123456789abcdef01234567";
const secret = "isolated-test-signing-key-at-least-32-chars";
function req(path: string, body?: unknown) { return new NextRequest(`http://localhost${path}`, { method: body ? "POST" : "GET", headers: { authorization: `Bearer ${generateToken(id)}`, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }); }
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("JWT_SECRET", secret); });
describe("production certification security regression (mocked DB only)", () => {
  it('rejects explicitly restricted catalog access before shared caches and details are queried', async () => {
    db.user.findUnique.mockResolvedValue({ id, status: true, role: 'WAREHOUSE_MANAGER', permissionsRestricted: true, permissions: [] });
    expect((await listProducts(req('/api/products'))).status).toBe(403);
    expect((await productDetail(req('/api/products/' + id), { params: Promise.resolve({ id }) })).status).toBe(403);
  });
  it("fails closed without a strong JWT signing secret", () => { vi.stubEnv("JWT_SECRET", ""); expect(() => generateToken(id)).toThrow(); expect(verifyToken(jwt.sign({ userId: id }, "your_jwt_secret"))).toBeNull(); });
  it("rejects invalid JWT payload and missing expiration", () => { expect(verifyToken(jwt.sign({ userId: id }, secret))).toBeNull(); expect(verifyToken(jwt.sign({ userId: { $ne: null } }, secret, { expiresIn: "1h" }))).toBeNull(); });
  it("rejects expired tokens", () => { expect(verifyToken(jwt.sign({ userId: id }, secret, { expiresIn: -1 }))).toBeNull(); });
  it("rechecks suspension against existing bearer token", async () => { db.user.findUnique.mockResolvedValue({ id, status: false }); expect(await getSessionFromRequest(req('/api/users'))).toBeNull(); });
  it("rechecks subscription expiry against existing bearer token", async () => { db.user.findUnique.mockResolvedValue({ id, status: true, subscriptionEndDate: new Date(0) }); expect(await getSessionFromRequest(req('/api/users'))).toBeNull(); });
  it("denies future subscription starts", () => { expect(isAccountAccessAllowed({ status: true, subscriptionStartDate: new Date('2999-01-01') })).toBe(false); });
  it("reads current warehouse scope for an existing JWT", async () => { db.user.findUnique.mockResolvedValue({ id, status: true, warehouseIds: ['warehouse-B'] }); expect((await getSessionFromRequest(req('/api/users')))?.warehouseIds).toEqual(['warehouse-B']); });
  for (const method of ['GET','POST','PUT'] as const) {
    it(`employee ${method} rejects unauthenticated caller before queries`, async () => { const response = await employees[method](new NextRequest('http://localhost/api/admin/employees')); expect(response.status).toBe(401); expect(db.user.findMany).not.toHaveBeenCalled(); expect(db.user.update).not.toHaveBeenCalled(); expect(db.user.create).not.toHaveBeenCalled(); });
    it(`employee ${method} rejects storekeeper`, async () => { db.user.findUnique.mockResolvedValue({ id, status: true, role: 'STOREKEEPER' }); const response=await employees[method](req('/api/admin/employees', {role:'SUPER_ADMIN'})); expect(response.status).toBe(403); expect(db.user.create).not.toHaveBeenCalled(); expect(db.user.update).not.toHaveBeenCalled(); });
  }
  for (const method of ['GET','POST'] as const) it(`AI ${method} rejects forged role and scope from storekeeper`, async () => { db.user.findUnique.mockResolvedValue({ id, status: true, role: 'STOREKEEPER' }); expect((await intelligence[method](req('/api/ai/benaa-intelligence?role=SUPER_ADMIN&warehouseId=other', method==='POST'?{action:'analyze_now'}:undefined))).status).toBe(403); });
  it("disables public account registration", async () => { expect((await register()).status).toBe(403); expect(db.user.create).not.toHaveBeenCalled(); });
  it("disables GET and POST HTTP seeding", async () => { expect((await seed.GET()).status).toBe(403); expect((await seed.POST()).status).toBe(403); });
  it("denies unknown roles read permissions", () => { expect(hasPermission('UNKNOWN', 'REPORT_VIEW')).toBe(false); });
});

for (const account of [null, { id, status: false }, { id, status: true, subscriptionEndDate: new Date(0) }]) {
  it("OAuth denies unprovisioned/suspended/expired account without creating a user", async () => {
    db.user.findUnique.mockResolvedValue(account);
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: "mock-access" }) }).mockResolvedValueOnce({ ok: true, json: async () => ({ id: "mock-google-id", email: "employee@example.test", verified_email: true }) });
    vi.stubGlobal("fetch", fetchMock);
    const request = new NextRequest("http://localhost/api/auth/oauth/google/callback?code=mock-code&state=mock-state", { headers: { cookie: "oauth_state=mock-state" } });
    const result = await oauthCallback(request);
    expect(result.headers.get("location")).toContain("account_not_authorized");
    expect(result.cookies.get("session_id")).toBeUndefined();
    expect(db.user.create).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
}

it("rejects boolean coercion and arbitrary employee roles before writes", async () => {
  db.user.findUnique.mockResolvedValue({ id, status: true, role: "SUPER_ADMIN" });
  for (const body of [{id, status:"false"}, {id, role:"UNAUTHORIZED_ROLE"}]) {
    expect((await employees.PUT(req('/api/admin/employees', body))).status).toBe(400);
  }
  expect(db.user.update).not.toHaveBeenCalled();
});
it("primary reassignment removes old primary without altering historical records", async () => {
  const oldWh="aaaaaaaaaaaaaaaaaaaaaaaa", newWh="bbbbbbbbbbbbbbbbbbbbbbbb", additionalWh="cccccccccccccccccccccccc";
  // Session lookup, transactional authorization recheck, then the target account.
  // Keep the original reassignment outcome assertions; model the new transaction boundary.
  db.$transaction.mockImplementation(async work => work(db));
  db.auditLog.create.mockResolvedValue({});
  db.warehouse.count.mockResolvedValue(2);
  db.user.findUnique.mockResolvedValueOnce({ id, status: true, role: "SUPER_ADMIN" })
    .mockResolvedValueOnce({ id, status: true, role: "SUPER_ADMIN" })
    .mockResolvedValueOnce({ id, primaryWarehouseId: oldWh, warehouseIds:[oldWh,additionalWh] });
  db.user.update.mockResolvedValue({ id, name:"fixture", primaryWarehouseId:newWh, warehouseIds:[newWh,additionalWh] });
  expect((await employees.PUT(req('/api/admin/employees', {id, primaryWarehouseId:newWh}))).status).toBe(200);
  expect(db.user.update).toHaveBeenCalledWith({where:{id}, data:expect.objectContaining({primaryWarehouseId:newWh, warehouseIds:[newWh,additionalWh]})});
});

it("disables unverified shipping webhook", async () => { expect((await shippingWebhook()).status).toBe(503); });
it("denies unsigned email jobs when queue is not configured", async () => { expect((await emailQueue(req('/api/email/queue/process', {recipientEmail:'test@example.test'}))).status).toBe(503); expect(sendEmailDirectly).not.toHaveBeenCalled(); });
