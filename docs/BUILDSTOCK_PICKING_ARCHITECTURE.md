# BuildStock — Picking & Pick List Engine Architecture

## 1. Context & Purpose

In **BuildStock WMS**, Picking represents the physical selection and staging of reserved materials from specific warehouse location bins.

Picking takes place after **Stock Reservation** (Phase 5B) and before **Dispatch** (Phase 5D).

```
Sales Order (APPROVED) ──> Stock Reservation (ACTIVE) ──> Pick List (COMPLETED) ──> Dispatch (Phase 5D)
                                                                                         ↓
                                                                             Physical Stock Deduction
                                                                             & SALE StockMovements
```

---

## 2. Critical Stock Isolation Invariant

> **PICKING ≠ PHYSICAL STOCK DEDUCTION**  
> Creating, assigning, picking, modifying, completing, or cancelling a `PickList` or `PickAllocation` MUST leave `StockAllocation.quantity`, `StockLocationAllocation.quantity`, and `StockMovement` **100% UNCHANGED**.

Physical stock deduction and `SALE` type `StockMovement` records belong exclusively to **Phase 5D Dispatch**.

---

## 3. Data Architecture & Models

```
StockReservation (1) ───< PickList (1) ───< PickListItem (N) ───< PickAllocation (N)
                             │                  │                     │
                             ├──> Warehouse     ├──> Product          └──> WarehouseBin
                             └──> SalesOrder    └──> StockResItem
```

### Proposed Schema Additions (`prisma/schema.prisma`):

```prisma
model PickList {
  id                 String         @id @default(auto()) @map("_id") @db.ObjectId
  pickListNumber     String         @unique // PICK-2026-XXXXXX
  salesOrderId       String         @db.ObjectId
  reservationId      String         @db.ObjectId
  warehouseId        String         @db.ObjectId
  status             String         @default("DRAFT") // DRAFT, ASSIGNED, IN_PROGRESS, COMPLETED, CANCELLED
  createdBy          String         @db.ObjectId
  assignedTo         String?        @db.ObjectId
  startedAt          DateTime?      @db.Date
  completedAt        DateTime?      @db.Date
  cancelledAt        DateTime?      @db.Date
  cancellationReason String?
  createdAt          DateTime       @default(now()) @db.Date
  updatedAt          DateTime?      @db.Date
  salesOrder         SalesOrder     @relation(fields: [salesOrderId], references: [id])
  reservation        StockReservation @relation(fields: [reservationId], references: [id])
  warehouse          Warehouse      @relation(fields: [warehouseId], references: [id])
  items              PickListItem[]

  @@index([salesOrderId])
  @@index([reservationId])
  @@index([warehouseId])
  @@index([status])
}

model PickListItem {
  id                String           @id @default(auto()) @map("_id") @db.ObjectId
  pickListId        String           @db.ObjectId
  salesOrderItemId  String           @db.ObjectId
  reservationItemId String           @db.ObjectId
  productId         String           @db.ObjectId
  unitId            String?          @db.ObjectId
  unitSymbol        String?
  requestedQuantity Float
  pickedQuantity    Float            @default(0)
  remainingQuantity Float
  status            String           @default("PENDING") // PENDING, PARTIALLY_PICKED, PICKED, SHORT
  createdAt         DateTime         @default(now()) @db.Date
  updatedAt         DateTime?        @db.Date
  pickList          PickList         @relation(fields: [pickListId], references: [id], onDelete: Cascade)
  product           Product          @relation(fields: [productId], references: [id])
  reservationItem   StockReservationItem @relation(fields: [reservationItemId], references: [id])
  allocations       PickAllocation[]

  @@index([pickListId])
  @@index([productId])
}

model PickAllocation {
  id                String       @id @default(auto()) @map("_id") @db.ObjectId
  pickListItemId    String       @db.ObjectId
  binId             String       @db.ObjectId
  productId         String       @db.ObjectId
  requestedQuantity Float
  pickedQuantity    Float        @default(0)
  unitId            String?      @db.ObjectId
  createdAt         DateTime     @default(now()) @db.Date
  updatedAt         DateTime?    @db.Date
  pickListItem      PickListItem @relation(fields: [pickListItemId], references: [id], onDelete: Cascade)
  bin               WarehouseBin @relation(fields: [binId], references: [id])
  product           Product      @relation(fields: [productId], references: [id])

  @@index([pickListItemId])
  @@index([binId])
  @@index([productId])
}
```

---

## 4. Picking Availability & Concurrency Guard

Because picking does not deduct physical stock immediately, we calculate **Pickable Stock per Bin**:

$$\text{pickableBinStock} = \text{StockLocationAllocation.quantity} - \sum \text{PickAllocation.requestedQuantity for OTHER active picks}$$

Active picks include `PickList` statuses `['DRAFT', 'ASSIGNED', 'IN_PROGRESS']`.

This ensures two pickers operating concurrently cannot commit more than the physical bin stock.

---

## 5. Bin Suggestion Strategy (Auto-Suggest)

The auto-suggest engine finds bins for a product within the target warehouse:
1. Filter `StockLocationAllocation` by `warehouseId` & `productId`.
2. Filter active bins (`bin.active == true`).
3. Calculate `pickableBinStock` for each bin.
4. Order by `locationPath` (FIFO / logical pick path).
5. Greedy allocation: allocate required quantity from available pickable bins until `requestedQuantity` is fulfilled.

---

## 6. Short Picking Protocol

If physical bin stock is insufficient:
- Picker records available quantity picked (e.g. `pickedQuantity = 80`).
- System sets item status to `SHORT` and `remainingQuantity = 20`.
- The `StockReservation` remains active for the unfulfilled portion (`20`).
- Phase 5D Dispatch will only dispatch the `80` picked units, leaving `20` reserved for a subsequent pick list or reservation release.

---

## 7. Centralized RBAC Permissions

- `PICK_LIST_VIEW`
- `PICK_LIST_CREATE`
- `PICK_LIST_ASSIGN`
- `PICK_LIST_START`
- `PICK_LIST_UPDATE`
- `PICK_LIST_COMPLETE`
- `PICK_LIST_CANCEL`
