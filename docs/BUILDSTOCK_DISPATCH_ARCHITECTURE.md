# BuildStock — Dispatch & Physical Stock Deduction Architecture

## 1. Context & Purpose

In **BuildStock WMS**, Dispatch is the **FIRST and ONLY operation in the Sales workflow that is allowed to physically deduct inventory**.

Dispatch bridges physical bin selection (`PickList`, Phase 5C) with final physical stock deduction, `SALE` StockMovement ledger recording, reservation reconciliation, and Sales Order completion.

```
Sales Order (APPROVED) ──> Stock Reservation (ACTIVE) ──> Pick List (COMPLETED) ──> Dispatch (POSTED)
                                                                                         ↓
                                                                             Physical Stock Deduction
                                                                             & SALE StockMovements
                                                                             & SalesOrder COMPLETED
```

---

## 2. Core Invariants

> **BEFORE DISPATCH: PHYSICAL STOCK IS 100% UNCHANGED**  
> Creating, approving, reserving, picking, or completing a Sales Order or Pick List MUST leave `StockAllocation.quantity`, `StockLocationAllocation.quantity`, and `StockMovement` records completely untouched.

> **AFTER DISPATCH: PHYSICAL STOCK IS DEDUCTED EXACTLY ONCE**  
> Posting a `Dispatch` atomically deducts physical stock from target location bins, creates `SALE` `StockMovement` records in the ledger, reconciles reservation quantities, and finalizes the Sales Order.

$$ \text{availableStock} = \text{physicalStock} - \text{activeReservedStock} $$

---

## 3. Data Architecture & Models

```
SalesOrder (1) ───< StockReservation (1) ───< PickList (1) ───< Dispatch (1)
                        │                         │                  │
                        └──> ReservationItem      └──> PickListItem  ├──> DispatchItem (N)
                                                                     └──> DispatchBinAllocation (N)
```

### Proposed Schema Additions (`prisma/schema.prisma`):

```prisma
model Dispatch {
  id                    String                @id @default(auto()) @map("_id") @db.ObjectId
  dispatchNumber        String                @unique // DSP-2026-XXXXXX
  salesOrderId          String                @db.ObjectId
  pickListId            String                @db.ObjectId
  warehouseId           String                @db.ObjectId
  status                String                @default("DRAFT") // DRAFT, POSTED, CANCELLED
  createdBy             String                @db.ObjectId
  postedBy              String?               @db.ObjectId
  postedAt              DateTime?             @db.Date
  cancelledBy           String?               @db.ObjectId
  cancelledAt           DateTime?             @db.Date
  cancellationReason    String?
  notes                 String?
  customerNameSnapshot  String?
  customerCodeSnapshot  String?
  createdAt             DateTime              @default(now()) @db.Date
  updatedAt             DateTime?             @db.Date
  salesOrder            SalesOrder            @relation(fields: [salesOrderId], references: [id])
  pickList              PickList              @relation(fields: [pickListId], references: [id])
  warehouse             Warehouse             @relation(fields: [warehouseId], references: [id])
  items                 DispatchItem[]

  @@index([salesOrderId])
  @@index([pickListId])
  @@index([warehouseId])
  @@index([status])
  @@index([postedAt])
}

model DispatchItem {
  id                String                  @id @default(auto()) @map("_id") @db.ObjectId
  dispatchId        String                  @db.ObjectId
  salesOrderItemId  String                  @db.ObjectId
  pickListItemId    String                  @db.ObjectId
  productId         String                  @db.ObjectId
  productName       String
  productSku        String?
  unitId            String?                 @db.ObjectId
  unitSymbol        String?
  requestedQuantity Float
  pickedQuantity    Float
  dispatchedQuantity Float
  createdAt         DateTime                @default(now()) @db.Date
  updatedAt         DateTime?               @db.Date
  dispatch          Dispatch                @relation(fields: [dispatchId], references: [id], onDelete: Cascade)
  product           Product                 @relation(fields: [productId], references: [id])
  binAllocations    DispatchBinAllocation[]

  @@index([dispatchId])
  @@index([productId])
}

model DispatchBinAllocation {
  id                 String       @id @default(auto()) @map("_id") @db.ObjectId
  dispatchItemId     String       @db.ObjectId
  binId              String       @db.ObjectId
  productId          String       @db.ObjectId
  dispatchedQuantity Float
  unitId             String?      @db.ObjectId
  locationPath       String?
  createdAt          DateTime     @default(now()) @db.Date
  dispatchItem       DispatchItem @relation(fields: [dispatchItemId], references: [id], onDelete: Cascade)
  bin                WarehouseBin @relation(fields: [binId], references: [id])

  @@index([dispatchItemId])
  @@index([binId])
}
```

---

## 4. Atomic Transaction & Rollback Guarantee

Posting a dispatch runs inside a single database transaction (`prisma.$transaction`).
The transaction atomically executes:
1. Conditional status validation (`where: { id: dispatchId, status: "DRAFT" }`).
2. PickList & PickAllocation validation.
3. Bin-level physical stock validation (`StockLocationAllocation.quantity >= binDispatchedQty`).
4. Warehouse physical stock validation (`StockAllocation.quantity >= totalDispatchedQty`).
5. Physical stock deduction (`StockLocationAllocation` & `StockAllocation`).
6. `SALE` `StockMovement` creation via `stockService.executeStockMutationInTx`.
7. `StockReservationItem` reconciliation (`releasedQuantity += dispatchedQty`, `remainingQuantity -= dispatchedQty`).
8. `StockReservation` status update (`FULFILLED` or `PARTIALLY_FULFILLED`).
9. `PickList` finalization mark (`isDispatched = true`, `dispatchedAt = new Date()`).
10. `SalesOrder` completion (`COMPLETED` if all line items fully dispatched).
11. Structured audit log creation (`dispatch_posted`, `stock_deducted_by_dispatch`, `reservation_fulfilled_by_dispatch`, `pick_list_dispatched`).
12. `Dispatch` status mark `POSTED`.

**If ANY step fails, EVERYTHING is rolled back cleanly.**

---

## 5. Short Pick Handling Policy

- If a Sales Order requested 100 m² and only 80 m² was picked (20 m² short):
  - Dispatch deducts **ONLY 80 m²**.
  - `StockReservationItem.remainingQuantity` is reduced by 80 (from 100 -> 20).
  - The remaining 20 m² is **NOT** silently deducted.
  - The `StockReservation` transitions to `PARTIALLY_FULFILLED`. The unfulfilled 20 m² remains reserved for a secondary pick list or explicit release via `releaseReservation`.

---

## 6. Centralized RBAC Permissions

- `DISPATCH_VIEW`
- `DISPATCH_CREATE`
- `DISPATCH_POST`
- `DISPATCH_CANCEL`
