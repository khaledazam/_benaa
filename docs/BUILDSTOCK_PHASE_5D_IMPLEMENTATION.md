# BUILDSTOCK — PHASE 5D IMPLEMENTATION DOCUMENTATION
## DISPATCH & PHYSICAL STOCK DEDUCTION ENGINE

---

## 1. Executive Summary

Phase 5D introduces a production-grade **Dispatch & Physical Stock Deduction Engine** for BuildStock.
In accordance with core system invariants:
- **BEFORE DISPATCH**: Physical stock levels (`Product.quantity`, `StockAllocation.quantity`, `StockLocationAllocation.quantity`) remain 100% unchanged during Picking (Phase 5C) and Reservation (Phase 5B).
- **AT DISPATCH**: Posting a Dispatch is the **FIRST and ONLY** operation in the Sales lifecycle allowed to physically deduct inventory.
- **MUTATION LAYER**: All physical stock deductions execute strictly via central `stockService` transaction helpers with `movementType = "SALE"`, creating explicit, immutable ledger entries in `StockMovement`.
- **RECONCILIATION**: Reservations are automatically reconciled (`releasedQuantity += dispatchedQty`, `remainingQuantity = Math.max(0, remainingQty - dispatchedQty)`), and Sales Orders transition to `COMPLETED` when fully dispatched.

---

## 2. Core Architecture & Database Models

### 2.1 Prisma Schema Additions (`prisma/schema.prisma`)

```prisma
model Dispatch {
  id                   String                @id @default(auto()) @map("_id") @db.ObjectId
  dispatchNumber       String                @unique
  salesOrderId         String                @db.ObjectId
  pickListId           String                @db.ObjectId
  warehouseId          String                @db.ObjectId
  status               String                @default("DRAFT") // DRAFT, POSTED, CANCELLED
  notes                String?
  customerNameSnapshot String?
  customerCodeSnapshot String?
  createdBy            String                @db.ObjectId
  postedBy             String?               @db.ObjectId
  cancelledBy          String?               @db.ObjectId
  postedAt             DateTime?             @db.Date
  cancelledAt          DateTime?             @db.Date
  cancellationReason   String?
  createdAt            DateTime              @default(now()) @db.Date
  updatedAt            DateTime?             @db.Date
  salesOrder           SalesOrder            @relation(fields: [salesOrderId], references: [id])
  pickList             PickList              @relation(fields: [pickListId], references: [id])
  warehouse            Warehouse             @relation(fields: [warehouseId], references: [id])
  items                DispatchItem[]

  @@index([salesOrderId])
  @@index([pickListId])
  @@index([warehouseId])
  @@index([status])
  @@index([createdAt])
}

model DispatchItem {
  id                 String                  @id @default(auto()) @map("_id") @db.ObjectId
  dispatchId         String                  @db.ObjectId
  salesOrderItemId   String                  @db.ObjectId
  pickListItemId     String                  @db.ObjectId
  productId          String                  @db.ObjectId
  productName        String
  productSku         String?
  unitId             String?                 @db.ObjectId
  unitSymbol         String?
  requestedQuantity  Float
  pickedQuantity     Float
  dispatchedQuantity Float
  createdAt          DateTime                @default(now()) @db.Date
  dispatch           Dispatch                @relation(fields: [dispatchId], references: [id], onDelete: Cascade)
  product            Product                 @relation(fields: [productId], references: [id])
  pickListItem       PickListItem            @relation(fields: [pickListItemId], references: [id])
  binAllocations     DispatchBinAllocation[]

  @@index([dispatchId])
  @@index([salesOrderItemId])
  @@index([pickListItemId])
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
  @@index([productId])
}
```

---

## 3. Workflow Implementation

### 3.1 Dispatch Lifecycle
1. **Creation (`createDispatch`)**:
   - Accepts a `COMPLETED` PickList.
   - Generates `dispatchNumber` (`DSP-2026-XXXXXX`).
   - Copies picked item quantities and bin location allocations into DRAFT `DispatchItem` and `DispatchBinAllocation` records.
   - **Zero physical stock deduction occurs**.

2. **Posting (`postDispatch`)**:
   - Executes inside a single `prisma.$transaction(async (tx) => { ... })`.
   - Locks Dispatch status in `DRAFT`.
   - Validates that physical stock in target warehouse bins is sufficient.
   - Invokes `executeStockMutationInTx(tx, params)` for each item and bin allocation:
     - Deducts bin physical stock (`StockLocationAllocation.quantity`).
     - Deducts overall warehouse physical stock (`StockAllocation.quantity`).
     - Deducts total product physical stock (`Product.quantity`).
     - Inserts `SALE` `StockMovement` ledger entries referencing the Dispatch.
   - Reconciles `StockReservation` (`releasedQuantity += dispatchedQty`, `remainingQuantity = Math.max(0, remainingQty - dispatchedQty)`).
   - Reconciles `SalesOrder` (`COMPLETED` if all items fully dispatched).
   - Records structured `AuditLog` events.

3. **Cancellation (`cancelDispatch`)**:
   - Only DRAFT Dispatches can be cancelled.
   - Transitions status to `CANCELLED`.
   - **Zero physical stock mutation occurs**.

---

## 4. Physical Stock Invariant Verification

```
availableStock = physicalStock - activeReservedStock
```
- During Stock Reservation (Phase 5B): `activeReservedStock` increases by $R$, `availableStock` decreases by $R$. `physicalStock` is unchanged.
- During Dispatch (Phase 5D): `physicalStock` decreases by $D$, `activeReservedStock` decreases by $D$. `availableStock` remains identical before and after posting dispatch.

---

## 5. UI & Navigation

- **Navigation**: Added `/inventory/dispatches` under Warehouse Operations in main navigation.
- **Pick List View**: Added a "Create Dispatch Record" primary action button on `COMPLETED` Pick Lists.
- **Dispatch List View**: Dynamic filters by Search, Status, and Warehouse.
- **Dispatch Detail View**:
  - Live pre-post stock preview detailing physical deduction impact per bin.
  - Confirmation modal highlighting permanent physical deduction.
  - Interactive Stock Movement Ledger tab for posted dispatches.

---

## 6. Comprehensive Verification Summary

- **TypeScript Typecheck**: 0 errors (`npx tsc --noEmit`)
- **ESLint Code Quality**: 0 errors (`npm run lint`)
- **Vitest Unit & Integration Test Suite**: 130 test files, 957 tests passed (100% pass rate)
- **Production Build**: Clean production build (`npm run build`)
