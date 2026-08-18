# BUILDSTOCK — PHASE 6 ARCHITECTURE AUDIT REPORT
## STOCK ADJUSTMENTS, INVENTORY COUNTING & INVENTORY CONTROL

---

## 1. Executive Summary

This architecture audit establishes the structural baseline for **Phase 6: Stock Adjustments, Inventory Counting & Inventory Control**.
The purpose of Phase 6 is to provide a controlled, auditable, and multi-stage workflow for correcting physical inventory discrepancies without corrupting master stock invariants or bypassing the central stock mutation engine (`executeStockMutationInTx`).

All existing invariants from Phase 0–5E remain **100% intact**:
1. $availableStock = physicalStock - activeReservedStock \ge 0$
2. Sales Orders, Stock Reservations, Pick Lists, and Goods Receipts DRAFT do NOT deduct physical stock.
3. Dispatch POST is the ONLY sales workflow step that physically deducts stock.
4. Physical stock mutations MUST execute atomically inside a single transaction via `executeStockMutationInTx` and write immutable `StockMovement` ledger entries.
5. `StockLocationAllocation` bin totals must reconcile with `StockAllocation` warehouse physical totals.

---

## 2. Architecture & Domain Findings

### Finding 1: Single Central Mutation Engine Compliance [HIGH]
- **Inspection**: Inspected all files in `lib/inventory/`, `lib/procurement/`, `lib/reservations/`, `lib/picking/`, `lib/dispatch/`, `lib/sales/`.
- **Finding**: Physical stock mutations for Good Receipts (Phase 2), Stock Transfers & Relocations (Phase 3), and Dispatches (Phase 5D) strictly route through `executeStockMutationInTx` in `stockService.ts`.
- **Constraint**: Phase 6 Adjustment Posting MUST use `executeStockMutationInTx` exclusively. Direct updates to `StockAllocation`, `StockLocationAllocation`, or `Product.quantity` outside `stockService.ts` are strictly prohibited.

### Finding 2: Stock Adjustment Workflow Non-Mutation [CRITICAL]
- **Inspection**: Evaluated Stock Adjustment lifecycle (`DRAFT` $\rightarrow$ `PENDING_APPROVAL` $\rightarrow$ `APPROVED` $\rightarrow$ `POSTED`).
- **Finding**: Creating a draft adjustment, submitting for review, approving an adjustment, or cancelling/rejecting an adjustment MUST NOT modify physical or reserved inventory. Physical stock mutation occurs **EXCLUSIVELY** during the final authorized `POSTED` action.
- **Constraint**: The `POSTED` action must be idempotent, atomic, and guarded against double-posting or race conditions.

### Finding 3: Inventory Counting & Variance Isolation [CRITICAL]
- **Inspection**: Evaluated Inventory Count lifecycle (`DRAFT` $\rightarrow$ `IN_PROGRESS` $\rightarrow$ `SUBMITTED` $\rightarrow$ `APPROVED` $\rightarrow$ `POSTED` $\rightarrow$ `CLOSED`).
- **Finding**: Inventory Count differences (variance = $countedQuantity - systemQuantity$) MUST NOT directly alter inventory allocations. Counts must generate an approved `StockAdjustment` record, which is then posted through the standard controlled adjustment workflow.
- **Locking Strategy**: During an active `IN_PROGRESS` inventory count, stock movements run normally while the system quantity is captured as an immutable snapshot at count initialization, maintaining operational continuity.

### Finding 4: Authorization & RBAC Control [HIGH]
- **Inspection**: Reviewed `lib/auth/permissions.ts` and role matrices.
- **Finding**: Permissions must separate operational count/draft actions from approval and posting actions.
- **Constraint**: `INVENTORY_ADJUSTMENT_POST` and `INVENTORY_COUNT_POST` must be restricted to `SUPER_ADMIN` and `WAREHOUSE_MANAGER` roles.

---

## 3. Categorized Summary of Audit Items

| ID | Domain | Issue / Requirement | Severity | Resolution Strategy |
| :--- | :--- | :--- | :--- | :--- |
| **AUD-01** | Adjustments | Draft/Pending/Approved state mutation risk | **CRITICAL** | Enforce zero stock mutation on all non-POSTED adjustment status transitions. |
| **AUD-02** | Counting | Direct count variance mutation risk | **CRITICAL** | Route count variances through generated StockAdjustments before physical posting. |
| **AUD-03** | Mutation Engine | Potential duplicate stock mutation code | **HIGH** | Post adjustment line items strictly through `executeStockMutationInTx`. |
| **AUD-04** | Idempotency | Double-posting / race conditions on adjustment posting | **HIGH** | Implement atomic status lock (`DRAFT/APPROVED` $\rightarrow$ `POSTED`) inside a single `$transaction`. |
| **AUD-05** | Location Integrity | Adjustments against inactive bins or wrong warehouses | **MEDIUM** | Validate bin active status and warehouse ownership prior to posting. |
| **AUD-06** | RBAC | Broad posting access to storekeepers | **HIGH** | Restrict `INVENTORY_ADJUSTMENT_POST` and `INVENTORY_COUNT_POST` to Manager/Admin roles. |

---

## 4. Recommended Implementation Strategy

1. **Prisma Models**: Add `StockAdjustment`, `StockAdjustmentItem`, `InventoryCount`, `InventoryCountItem` to `prisma/schema.prisma`.
2. **Permissions**: Define `INVENTORY_ADJUSTMENT_*` and `INVENTORY_COUNT_*` in `lib/auth/permissions.ts`.
3. **Core Services**:
   - `lib/inventory/adjustmentService.ts`: Workflow for draft creation, submission, approval, rejection, cancellation, and atomic posting.
   - `lib/inventory/countingService.ts`: Workflow for count creation, start, recording counts, variance calculation, approval, and adjustment generation.
4. **API Routes**: Implement `/api/inventory/adjustments/*` and `/api/inventory/counts/*`.
5. **UI Views**: Build interactive management interfaces at `/inventory/adjustments` and `/inventory/counting`.
6. **Reporting**: Build read-only variance and accuracy reports.
7. **Test Suite**: Create comprehensive scenario test suites verifying all 22 mandatory test cases.
