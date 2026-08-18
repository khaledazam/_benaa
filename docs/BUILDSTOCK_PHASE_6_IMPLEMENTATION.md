# BUILDSTOCK — PHASE 6 TECHNICAL IMPLEMENTATION GUIDE
## STOCK ADJUSTMENTS, INVENTORY COUNTING & INVENTORY CONTROL

---

## 1. Core Domain Architecture

Phase 6 adds two core domains for physical stock correction and cycle counting:

```
                          ┌───────────────────────────┐
                          │   Inventory Count (Scope) │
                          │ DRAFT -> IN_PROGRESS      │
                          └─────────────┬─────────────┘
                                        │
                                        ▼
                          ┌───────────────────────────┐
                          │ Physical Count Sheet Line │
                          │  countedQty - systemQty   │
                          └─────────────┬─────────────┘
                                        │
                                        ▼ (Variance > 0 or < 0)
┌───────────────────────────────────────┴──────────────────────────────────────┐
│                        Stock Adjustment Workflow                             │
│  DRAFT -> PENDING_APPROVAL -> APPROVED --(POSTED ONLY)--> Central Mutation   │
└──────────────────────────────────────────────────────────────────────────────┘
                                                                       │
                                                                       ▼
                                                       ┌──────────────────────────┐
                                                       │  executeStockMutation    │
                                                       │  StockAllocation + SLA   │
                                                       │  StockMovement Ledger    │
                                                       └──────────────────────────┘
```

---

## 2. Invariants & Security Rules

1. **Zero Stock Mutation Prior to POST**: Creating, starting, recording, submitting, approving, rejecting, or cancelling adjustments or counts MUST NOT modify stock allocations or write `StockMovement` ledger entries.
2. **Exclusivity of Physical Mutation**: Stock changes occur **EXCLUSIVELY** during the final authorized `postAdjustment` or `postInventoryCount` action.
3. **Atomic Execution**: Posting executes all line items inside a single `prisma.$transaction`.
4. **Idempotency & Concurrency Lock**: Status is locked to `POSTED` inside the transaction before mutations begin. Second posting attempts are rejected.
5. **Centralized Mutation Engine**: Posting uses `executeStockMutationInTx` in `lib/inventory/stockService.ts` to ensure consistency between `StockAllocation` and `StockLocationAllocation`.

---

## 3. Data Models Added

- **`StockAdjustment`**: Header representing a stock adjustment request (`adjustmentNumber`, `warehouseId`, `adjustmentType`, `status`, `createdBy`, `submittedBy`, `approvedBy`, `postedBy`, `rejectionReason`, `cancellationReason`).
- **`StockAdjustmentItem`**: Line item (`productId`, `binId`, `unitId`, `systemQuantity`, `adjustmentQuantity`, `resultingQuantity`, `reason`).
- **`InventoryCount`**: Header for counting session (`countNumber`, `warehouseId`, `scopeType`, `scopeId`, `status`, `createdBy`, `startedBy`, `submittedBy`, `approvedBy`, `postedBy`, `closedBy`, `adjustmentId`).
- **`InventoryCountItem`**: Line item (`productId`, `binId`, `systemQuantity`, `countedQuantity`, `varianceQuantity`, `variancePercentage`).

---

## 4. API Endpoints

- `GET /api/inventory/adjustments` & `POST /api/inventory/adjustments`
- `GET /api/inventory/adjustments/[id]`
- `POST /api/inventory/adjustments/[id]/submit`
- `POST /api/inventory/adjustments/[id]/approve`
- `POST /api/inventory/adjustments/[id]/post`
- `POST /api/inventory/adjustments/[id]/cancel`
- `GET /api/inventory/counts` & `POST /api/inventory/counts`
- `GET /api/inventory/counts/[id]`
- `POST /api/inventory/counts/[id]/start`
- `POST /api/inventory/counts/[id]/record`
- `POST /api/inventory/counts/[id]/submit`
- `POST /api/inventory/counts/[id]/approve`
- `POST /api/inventory/counts/[id]/post`
- `POST /api/inventory/counts/[id]/close`
- `GET /api/inventory/reports/variance`
