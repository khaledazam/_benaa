/** Known-defect characterizations. Passing means the defect remains reproducible.
 * Prisma and stock mutations are fully mocked: no database or network access.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const fixtures = vi.hoisted(() => {
  const db: any = {};
  return { db, mutate: vi.fn() };
});
vi.mock("@/prisma/client", () => ({ prisma: fixtures.db }));
vi.mock("@/lib/inventory/stockService", () => ({
  executeStockMutation: fixtures.mutate,
  executeStockMutationInTx: fixtures.mutate,
  StockMovementTypes: { PURCHASE: "PURCHASE", SALE: "SALE" },
}));
vi.mock("@/lib/inventory/batchService", () => ({
  createOrUpdateBatchOnReceiptInTx: vi.fn(),
  validateProductTrackingModeInTx: vi.fn(),
  reserveBatchQuantityInTx: vi.fn(),
  releaseBatchReservationInTx: vi.fn(),
  deductBatchQuantityInTx: vi.fn(),
}));
import { postGoodsReceipt } from "@/lib/procurement/procurementService";
import { createStockReservation } from "@/lib/reservations/reservationService";
import { postDispatch } from "@/lib/dispatch/dispatchService";
import { applyIncrementalInvoicePayment } from "@/lib/payments/order-payment-from-amounts";

describe("Production audit: remediated engine behavior (regression assertions)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(fixtures.db).forEach((key) => delete fixtures.db[key]);
    fixtures.db.$transaction = vi.fn(async (fn: any) => fn(fixtures.db));
    fixtures.db.auditLog = { create: vi.fn() };
    const actor = { id: "auditor", status: true, role: "SUPER_ADMIN", warehouseIds: [] };
    fixtures.db.user = { findUnique: vi.fn(async ({ where }: any) => where.id === actor.id ? actor : null), update: vi.fn(async ({ data }: any) => Object.assign(actor, data)) };
  });

  it("rejects GRN posting when purchase-order status is invalid without mutating receipt to POSTED", async () => {
    const receipt = { id: "grn", status: "DRAFT", items: [], purchaseOrder: { status: "CANCELLED", items: [] } };
    fixtures.db.goodsReceipt = {
      findUnique: vi.fn(async () => receipt),
      updateMany: vi.fn(async ({ data }: any) => { Object.assign(receipt, data); return { count: 1 }; }),
    };
    await expect(postGoodsReceipt("grn", "auditor")).rejects.toThrow("Purchase order is not open for receipt");
    expect(receipt.status).toBe("DRAFT");
    expect(fixtures.db.$transaction).toHaveBeenCalled();
  });

  it("duplicate product lines aggregating beyond physical stock are rejected with insufficient stock", async () => {
    fixtures.db.salesOrder = {
      findUnique: vi.fn(async () => ({
        id: "so", status: "APPROVED", warehouseId: "wh", items: [1, 2].map((n) => ({
          id: `line${n}`, productId: "p", productName: "Tile", orderedQuantity: 60, unitId: null, unitSymbol: "PCS",
        })),
      })),
      update: vi.fn(),
    };
    fixtures.db.product = {
      findUnique: vi.fn(async () => ({ id: "p", unitId: null, quantity: 100, reservedQuantity: 0 })),
      update: vi.fn(),
    };
    fixtures.db.stockAllocation = {
      update: vi.fn(),
      findUnique: vi.fn(async () => ({ quantity: 100, reservedQuantity: 0, warehouseId: "wh" })),
      findMany: vi.fn(async () => [{ quantity: 100, reservedQuantity: 0, warehouseId: "wh" }]),
    };
    fixtures.db.stockReservationItem = { findMany: vi.fn(async () => []) };
    fixtures.db.projectMaterialIssueItem = { findMany: vi.fn(async () => []) };
    fixtures.db.stockReservation = {
      findFirst: vi.fn(async () => null),
    };
    await expect(createStockReservation("so", "auditor")).rejects.toThrow("Insufficient available stock for product 'p'");
  });

  it("dispatch rejects warehouse scope mismatch and enforces active reservation", async () => {
    const dispatch: any = {
      id: "d", status: "DRAFT", warehouseId: "wh-1", salesOrderId: "so",
      pickList: { salesOrderId: "so", warehouseId: "wh-2", status: "COMPLETED", reservationId: "res" },
      salesOrder: { warehouseId: "wh-1", status: "PROCESSING" },
      items: [{ productId: "p", dispatchedQuantity: 50, pickedQuantity: 50, binAllocations: [] }],
    };
    fixtures.db.dispatch = {
      findUnique: vi.fn(async () => dispatch),
      update: vi.fn(async () => dispatch),
    };
    await expect(postDispatch("d", "auditor")).rejects.toThrow("Dispatch order/pick warehouse scope mismatch");
    expect(fixtures.mutate).not.toHaveBeenCalled();
  });

  it("full incremental payment refuses to revive cancelled invoice and preserves cancelled status", () => {
    expect(applyIncrementalInvoicePayment({ priorAmountPaid: 0, total: 100, chargeAmount: 100, priorStatus: "cancelled" }).status).toBe("cancelled");
  });
});
