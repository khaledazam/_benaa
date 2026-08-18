# BUILDSTOCK — Goods Receipt Creation & Posting Workflow Audit

> **Document:** BuildStock Goods Receipt Audit Report
> **Phase:** Phase 2 Hardening
> **Date:** 2026-08-13

---

## 1. Audit Summary & Behavior Assessment

An in-depth audit of the initial Phase 2 implementation was conducted across `/app/api/goods-receipts`, `/app/api/goods-receipts/[id]/post`, and `/lib/procurement/procurementService.ts`.

### Findings Matrix

| Question | Discovered Behavior | Status |
|---|---|---|
| 1. Does `POST /api/goods-receipts` create a DRAFT receipt? | It created a receipt and immediately posted it in the same call. | ❌ Needs Fix |
| 2. Does `POST /api/goods-receipts` immediately update `StockAllocation`? | Yes. Stock was modified on creation. | ❌ Needs Fix |
| 3. Does it immediately create `StockMovement`? | Yes. `PURCHASE` movement was created on creation. | ❌ Needs Fix |
| 4. Does it immediately update `PurchaseOrderItem.receivedQuantity`? | Yes. | ❌ Needs Fix |
| 5. Does it immediately change `PurchaseOrder` status? | Yes. | ❌ Needs Fix |
| 6. Does it immediately create an audit log? | Yes (`goods_receipt_posted`). | ❌ Needs Fix |
| 7. Does `POST /api/goods-receipts/:id/post` perform stock operations? | No. It only updated `status: "POSTED"` on an already created receipt. | ❌ Needs Fix |
| 8. Can the same receipt be posted twice? | `/post` checked `if (status === "POSTED")`, but creation already posted the receipt. | ⚠️ Needs Hardening |
| 9. Can a DRAFT receipt affect stock? | Stock was mutated during creation, leaving no true DRAFT state. | ❌ Needs Fix |
| 10. Can a POSTED receipt be modified? | Direct updates were missing, but posting/creation separation was not enforced. | ⚠️ Needs Hardening |

---

## 2. Root Cause & Architectural Mismatch

In the initial implementation:
- `POST /api/goods-receipts` executed `postGoodsReceipt(...)` which performed both document creation and inventory posting in a single invocation.
- `/api/goods-receipts/[id]/post` only updated the `status` string field without performing stock mutations or PO updates.

This violated the core business requirement that **Creating a Goods Receipt MUST NOT change warehouse stock**, while **Posting a Goods Receipt MUST change warehouse stock**.

---

## 3. Required Fix Plan

1. **Separate Functions in `lib/procurement/procurementService.ts`:**
   - `createGoodsReceiptDraft(...)`: Creates `GoodsReceipt` with `status: "DRAFT"` and `GoodsReceiptItem` records. Performs ZERO stock updates, ZERO `StockMovement` creation, ZERO PO updates. Logs `goods_receipt_created`.
   - `postGoodsReceipt(...)`: Takes `receiptId`. Validates receipt is in `DRAFT` status and PO is `APPROVED`/`PARTIALLY_RECEIVED`. Executes atomic stock mutation, `StockMovement` creation, `PurchaseOrderItem` update, `PurchaseOrder` status update (`PARTIALLY_RECEIVED`/`FULLY_RECEIVED`), updates receipt status to `POSTED` with `postedAt`, and logs `goods_receipt_posted`.

2. **API Endpoint Alignment:**
   - `POST /api/goods-receipts`: Calls `createGoodsReceiptDraft(...)` -> returns DRAFT receipt.
   - `POST /api/goods-receipts/:id/post`: Calls `postGoodsReceipt(id, userId)` -> performs atomic stock posting.

3. **Double-Posting Protection & Concurrency Safety:**
   - Use atomic conditional status transition in Prisma transaction (`where: { id: receiptId, status: GRNStatus.DRAFT }`). If update fails or status is not `DRAFT`, reject immediately with clear error.
