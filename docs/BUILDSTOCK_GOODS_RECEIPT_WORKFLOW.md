# BUILDSTOCK — Goods Receipt Workflow Specification

> **Document:** BuildStock Goods Receipt Workflow Specification
> **Phase:** Phase 2 Hardening
> **Date:** 2026-08-13

---

## 1. Goods Receipt Lifecycle & Workflow Architecture

BuildStock enforces strict separation between **Document Creation** and **Inventory Posting**.

```
CREATE GOODS RECEIPT (POST /api/goods-receipts)
        ↓
    status = DRAFT
    (Stock: UNCHANGED | StockMovement: NONE | PO: UNCHANGED)
        ↓
REVIEW / VALIDATION
        ↓
POST GOODS RECEIPT (POST /api/goods-receipts/:id/post)
        ↓
  [Atomic Transaction]
    ├── Validate status == DRAFT & PO status in [APPROVED, PARTIALLY_RECEIVED]
    ├── Validate receivedQuantity <= remainingQuantity (Over-receiving Guard)
    ├── Atomic Conditional Lock (where status == DRAFT -> status = POSTED)
    ├── Update StockAllocation per warehouse
    ├── Create PURCHASE StockMovement entry
    ├── Update PurchaseOrderItem receivedQuantity & remainingQuantity
    ├── Recalculate & Update PurchaseOrder status (PARTIALLY_RECEIVED / FULLY_RECEIVED)
    └── Record AuditLog ("goods_receipt_posted")
        ↓
    status = POSTED (Immutable)
```

---

## 2. API Contract & Endpoint Specification

### 2.1 Create Goods Receipt Draft
- **Endpoint:** `POST /api/goods-receipts`
- **Permission Required:** `GOODS_RECEIPT_CREATE`
- **Behavior:** Creates `GoodsReceipt` with `status: "DRAFT"` and `GoodsReceiptItem` records.
- **Stock Impact:** ZERO stock mutation, ZERO `StockMovement` generated.

### 2.2 Post Goods Receipt
- **Endpoint:** `POST /api/goods-receipts/:id/post`
- **Permission Required:** `GOODS_RECEIPT_POST`
- **Behavior:** Executes atomic inventory mutation, `StockMovement` creation, line item tracking update, PO status update, and marks receipt as `POSTED`.
- **Double-Post Protection:** Concurrency-safe atomic conditional update (`where: { id: receiptId, status: "DRAFT" }`). Attempting to post an already `POSTED` receipt returns HTTP 400 error.

### 2.3 Get Goods Receipt Detail
- **Endpoint:** `GET /api/goods-receipts/:id`
- **Permission Required:** `GOODS_RECEIPT_VIEW`
- **Behavior:** Retrieves full details of the Goods Receipt including items and purchase order link.

---

## 3. Security, Authorization & Immutability

- **Server-Side Authorization:** Enforced via `/lib/auth/requireRole.ts` with permissions `GOODS_RECEIPT_CREATE`, `GOODS_RECEIPT_POST`, `GOODS_RECEIPT_VIEW`.
- **Immutability:** Once a Goods Receipt transitions to `POSTED`, its status is final. Quantities, items, warehouse, and PO links cannot be modified through update endpoints.
