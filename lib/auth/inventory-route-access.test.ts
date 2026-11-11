import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const state = vi.hoisted(() => ({ session: null as any, findTransfer: vi.fn(), transaction: vi.fn() }));
vi.mock("@/utils/auth", () => ({ getSessionFromRequest: async () => state.session, hashPassword: vi.fn() }));
vi.mock("@/prisma/client", () => ({ prisma: { stockTransfer: { findUnique: state.findTransfer }, $transaction: state.transaction } }));
vi.mock("@/lib/cache/post-mutation", () => ({ scheduleInvalidateStockAllocationCaches: vi.fn(async () => undefined) }));
import { GET as crossWarehouse } from "@/app/api/inventory/cross-warehouse/route";
import { GET as transferGet, POST as transferPost } from "@/app/api/inventory/transfers/lifecycle/route";
import { GET as syncGet, POST as syncPost } from "@/app/api/mobile-sync/route";

function request(body?: any) {
  return new NextRequest("http://isolated.test/api/test", body ? { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } } : undefined);
}
describe("Inventory route authorization", () => {
  beforeEach(() => { state.session = null; vi.clearAllMocks(); });
  it.each([crossWarehouse, transferGet, syncGet])("rejects unauthenticated GET before querying inventory", async (handler) => {
    expect((await handler(request())).status).toBe(401);
  });
  it.each([transferPost, syncPost])("rejects unauthenticated POST before mutation", async (handler) => {
    expect((await handler(request({ action: "REQUEST", userId: "spoofed-admin", actorRole: "SUPER_ADMIN" }))).status).toBe(401);
    expect(state.transaction).not.toHaveBeenCalled();
  });
  it("retires duplicate mobile user provisioning despite spoofed role", async () => {
    state.session = { id: "staff", role: "STOREKEEPER", warehouseIds: ["wh1"] };
    expect((await syncPost(request({ action: "register_user", role: "SUPER_ADMIN" }))).status).toBe(410);
  });
  it("forbids scoped employee foreign warehouse mobile catalog pull", async () => {
    state.session = { id: "staff", role: "STOREKEEPER", warehouseIds: ["wh1"] };
    expect((await syncPost(request({ action: "pull_items", warehouseId: "wh2" }))).status).toBe(403);
  });
  it("forbids storekeeper approval despite spoofed actor identity", async () => {
    state.session = { id: "staff", role: "STOREKEEPER", warehouseIds: ["wh1"] };
    state.findTransfer.mockResolvedValue({ fromWarehouseId: "wh1", toWarehouseId: "wh2" });
    expect((await transferPost(request({ action: "APPROVE", transferId: "trf", actorRole: "SUPER_ADMIN", userId: "admin" }))).status).toBe(403);
  });
  it("forbids receipt outside the employee current destination scope", async () => {
    state.session = { id: "staff", role: "STOREKEEPER", warehouseIds: ["wh1"] };
    state.findTransfer.mockResolvedValue({ fromWarehouseId: "wh1", toWarehouseId: "wh2" });
    expect((await transferPost(request({ action: "RECEIVE", transferId: "trf" }))).status).toBe(403);
    expect(state.transaction).not.toHaveBeenCalled();
  });
});
