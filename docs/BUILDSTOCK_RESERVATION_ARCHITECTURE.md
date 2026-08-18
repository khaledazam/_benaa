# BuildStock — Stock Reservation Engine Architecture

## 1. Executive Summary & Design Core

BuildStock Phase 5B introduces a production-grade **Stock Reservation Engine**. In a construction and modern decoration materials WMS, there is a critical operational distinction between:

1. **Commercial Commitment (Reservation):** Soft-allocating available inventory to an approved Sales Order so that other buyers or sales channels cannot claim the same stock.
2. **Physical Stock Deduction (Picking & Dispatch):** Physically selecting items from warehouse bins and shipping them out of the building.

---

## 2. Critical Stock Isolation Invariant

> **RESERVATION ≠ PHYSICAL DEDUCTION**
> Creating, updating, releasing, or cancelling a `StockReservation` MUST NOT modify:
> - `StockAllocation.quantity`
> - `StockLocationAllocation.quantity`
> - `StockMovement` ledger records

### Stock Relationship Formula
```
availableStock = physicalStock - activeReservedStock
```

Where:
- **`physicalStock`**: Sourced directly from `StockAllocation.quantity` (sum of physical stock in warehouse).
- **`activeReservedStock`**: Sum of `remainingQuantity` from all `StockReservationItem` records belonging to reservations in `ACTIVE` or `PARTIALLY_FULFILLED` status.
- **`availableStock`**: The net quantity remaining for new reservations or sales orders.

### Numerical Example
- Physical Stock in Database (`StockAllocation`): **100 m²**
- Active Reservation (`StockReservationItem`): **25 m²**
- Calculated Available Stock: **75 m²**

Database state during active reservation:
- `StockAllocation.quantity` = **100**
- `StockReservationItem.remainingQuantity` = **25**
- `StockMovement` count = **0** (No stock movement created)

---

## 3. Reservation Domain Models & Schema

### `StockReservation` Model
- `id`: CUID (MongoDB `_id`)
- `reservationNumber`: String (Unique, format `RES-2026-XXXXXX`)
- `salesOrderId`: String (Foreign Key -> `SalesOrder.id`)
- `warehouseId`: String (Foreign Key -> `Warehouse.id`)
- `status`: String (Enum: `ACTIVE`, `PARTIALLY_FULFILLED`, `FULFILLED`, `RELEASED`, `CANCELLED`)
- `reservedBy`: String (User ID)
- `releasedBy`: String? (User ID)
- `releasedAt`: DateTime?
- `cancelledBy`: String? (User ID)
- `cancelledAt`: DateTime?
- `cancellationReason`: String?

### `StockReservationItem` Model
- `id`: CUID (MongoDB `_id`)
- `reservationId`: String (Foreign Key -> `StockReservation.id`)
- `salesOrderItemId`: String (Foreign Key -> `SalesOrderItem.id`)
- `productId`: String (Foreign Key -> `Product.id`)
- `warehouseId`: String (Foreign Key -> `Warehouse.id`)
- `unitId`: String? (Foreign Key -> `Unit.id`)
- `unitSymbol`: String? (e.g. `m²`, `L`, `Ton`)
- `requestedQuantity`: Float (Decimal UOM)
- `reservedQuantity`: Float (Decimal UOM)
- `releasedQuantity`: Float (Default `0`)
- `remainingQuantity`: Float (Decimal UOM: `reservedQuantity - releasedQuantity`)
- `binId`: String? (Optional bin assignment; bin selection is primarily handled during Picking in Phase 5C)

---

## 4. Reservation Status Lifecycle

```
[APPROVED SALES ORDER]
          │
          ▼
   POST /api/reservations
          │
          ▼
       ACTIVE
       /    \
      /      \
 Partial     Full
 Release    Release
    │          │
    ▼          ▼
PARTIALLY_   RELEASED / CANCELLED
FULFILLED    (Available stock restored)
```

1. **`ACTIVE`**: Full requested quantity is actively committed against available stock.
2. **`PARTIALLY_FULFILLED`**: Some reserved items have been picked/released (`releasedQuantity > 0` and `remainingQuantity > 0`).
3. **`FULFILLED`**: All reserved items have been completely fulfilled by picking/dispatch (`remainingQuantity === 0`).
4. **`RELEASED`**: Reservation was explicitly released or un-committed. Remaining reserved stock drops to `0`. Available stock is restored.
5. **`CANCELLED`**: Associated Sales Order or reservation was cancelled. Remaining reserved stock drops to `0`. Available stock is restored.

---

## 5. Multi-Item Atomicity & Concurrency Strategy

### 1. Multi-Item All-or-Nothing Guarantee
When reserving a multi-item Sales Order:
- The system checks available stock for **every line item** in a single database transaction.
- If **ANY** item has `requestedQuantity > availableStock`, the entire reservation transaction aborts immediately with a clear error message specifying the deficient product.
- Partial reservation across line items is **NEVER** persisted automatically.

### 2. Concurrency Protection Strategy
To prevent over-reservation when multiple users attempt to reserve inventory simultaneously:
- **Transaction-Scoped Availability Check:** `getAvailableStock` calculates `physicalStock - activeReservedStock` inside the Prisma `$transaction`.
- **Idempotency Guard:** `salesOrderId` check inside the transaction ensures no duplicate active reservations can exist for the same Sales Order.
- **Strict Guard Assertion:** If `requestedQuantity > availableStock`, the transaction rolls back before any records are inserted.

---

## 6. Integration Rules

### 1. Sales Order Cancellation
If a Sales Order with an `ACTIVE` or `PARTIALLY_FULFILLED` reservation is cancelled:
- The system atomically transitions the Sales Order to `CANCELLED`.
- Automatically calls `cancelReservation()`, setting the reservation status to `CANCELLED` and releasing remaining reserved quantities.
- Physical stock remains **100% UNCHANGED**. Zero `StockMovement` records are created.

### 2. Physical Inventory vs Available Inventory in UI
In WMS inventory lists and product views:
- **`Physical Stock`**: Actual stored inventory on hand.
- **`Reserved Stock`**: Active commercial commitments.
- **`Available Stock`**: `Physical Stock - Reserved Stock`.
- Status Indicator Rules:
  - `AVAILABLE`: `availableStock > lowStockThreshold`
  - `LOW_AVAILABLE`: `availableStock <= lowStockThreshold` and `availableStock > 0`
  - `FULLY_RESERVED`: `physicalStock > 0` but `availableStock === 0`
  - `OUT_OF_STOCK`: `physicalStock === 0`
