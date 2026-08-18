# BuildStock — Phase 5B Implementation Summary
## Stock Reservation Engine

**Status:** COMPLETE  
**Verification Baseline:**
- **Test Files:** 128 / 128 passed
- **Total Tests:** 913 / 913 passed
- **TypeScript:** 0 errors (`npx tsc --noEmit`)
- **ESLint:** 0 errors (`npm run lint`)
- **Prisma Client:** Regenerated & aligned (`npx prisma generate`)
- **Production Build:** Next.js Turbopack compilation **SUCCESSFUL** (`npm run build`)

---

## 1. Executive Summary & Core Invariant

Phase 5B implements a production-grade **Stock Reservation Engine** for BuildStock WMS, creating a soft commercial commitment between an **APPROVED Sales Order** and physical **Picking/Dispatch**.

### Critical Stock Isolation Invariant
> **RESERVATION ≠ PHYSICAL STOCK DEDUCTION**
> Creating, updating, releasing, or cancelling a `StockReservation` leaves `StockAllocation.quantity`, `StockLocationAllocation.quantity`, and `StockMovement` records **100% UNCHANGED**.

```
availableStock = physicalStock - activeReservedStock
```

---

## 2. Database Schema & Models

### Added Models in `prisma/schema.prisma`:
1. `StockReservation`:
   - `id`, `reservationNumber` (`RES-2026-XXXXXX`), `salesOrderId`, `warehouseId`, `status` (`ACTIVE`, `PARTIALLY_FULFILLED`, `FULFILLED`, `RELEASED`, `CANCELLED`), `reservedBy`, `releasedBy`, `releasedAt`, `cancelledBy`, `cancelledAt`, `cancellationReason`.
2. `StockReservationItem`:
   - `id`, `reservationId`, `salesOrderItemId`, `productId`, `warehouseId`, `unitId`, `unitSymbol`, `requestedQuantity`, `reservedQuantity`, `releasedQuantity`, `remainingQuantity`, `binId`.
3. Back-relations added on `SalesOrder`, `Warehouse`, `Product`, and `SalesOrderItem`.

---

## 3. Centralized RBAC Permissions

Added 4 permissions to `lib/auth/permissions.ts`:
- `RESERVATION_VIEW`
- `RESERVATION_CREATE`
- `RESERVATION_RELEASE`
- `RESERVATION_CANCEL`

Mapped into role matrix:
- **`SUPER_ADMIN`**: Full permissions
- **`WAREHOUSE_MANAGER`**: Full permissions (`RESERVATION_VIEW`, `RESERVATION_CREATE`, `RESERVATION_RELEASE`, `RESERVATION_CANCEL`)
- **`STOREKEEPER`**: `RESERVATION_VIEW`, `RESERVATION_CREATE`, `RESERVATION_RELEASE`
- **`INVENTORY_OFFICER`**: `RESERVATION_VIEW`, `RESERVATION_CREATE`, `RESERVATION_RELEASE`
- **`PURCHASING_OFFICER`**: `RESERVATION_VIEW`
- **`VIEWER`**: `RESERVATION_VIEW`

---

## 4. REST API Registry

| Route | Method | Purpose | Guarded Permission |
| :--- | :--- | :--- | :--- |
| `/api/reservations` | GET | List reservations (Filter by status, warehouse, SO) | `RESERVATION_VIEW` |
| `/api/reservations` | POST | Create reservation for approved Sales Order | `RESERVATION_CREATE` |
| `/api/reservations/:id` | GET | Reservation detail view | `RESERVATION_VIEW` |
| `/api/reservations/:id/release` | POST | Full or partial reservation release | `RESERVATION_RELEASE` |
| `/api/reservations/:id/cancel` | POST | Cancel reservation & release remaining stock | `RESERVATION_CANCEL` |
| `/api/inventory/availability` | GET | Check physical, reserved & available stock | `STOCK_VIEW` / `RESERVATION_VIEW` |

---

## 5. Operations UI & Dashboard Integration

1. **Stock Reservations Directory (`/inventory/reservations` & `ReservationsView.tsx`):**
   - Table view with status tab bar (`ALL`, `ACTIVE`, `PARTIALLY_FULFILLED`, `FULFILLED`, `RELEASED`, `CANCELLED`), search, and warehouse filters.
2. **Reservation Detail Screen (`/inventory/reservations/[id]` & `ReservationDetailView.tsx`):**
   - Metadata card, Sales Order reference, Customer snapshot, Warehouse details.
   - Items breakdown table (`Product`, `Requested`, `Reserved`, `Released`, `Remaining`).
   - Release and Cancel action modals with read-only guards.
3. **Sales Order Detail Integration (`/sales/[id]` & `SalesOrderDetailView.tsx`):**
   - Displays `Reserve Stock` action button for approved Sales Orders.
   - Displays active reservation link badge when reserved.
4. **Physical Inventory Table (`/inventory` & `InventoryView.tsx`):**
   - Displays physical stock allocation with location bin paths.

---

## 6. Verification Scenarios & Tests

1. **Step 26 Critical E2E Test:**
   - Physical stock: `100 m²`
   - Sales Order: `25 m²`
   - Reserve stock -> Physical = `100 m²`, Reserved = `25 m²`, Available = `75 m²`. `StockAllocation` = `100 m²`, `StockMovement` count = `0`.
   - Release reservation -> Physical = `100 m²`, Reserved = `0 m²`, Available = `100 m²`. `StockAllocation` = `100 m²`, `StockMovement` count = `0`.
2. **Step 27 Concurrency Test:**
   - Concurrent requests for `70 m²` and `50 m²` against `100 m²` physical stock -> system rejects second request, total reserved <= `100 m²`.
3. **Step 28 Multi-Item Atomic Test:**
   - Multi-item reservation fails atomically if ANY item exceeds available stock; zero records persisted.
4. **Step 29 Sales Order Cancellation Integration Test:**
   - Cancelling a Sales Order with an active reservation automatically releases the reservation (`CANCELLED` / `RELEASED`), restoring available stock with zero `StockMovement` entries.
5. **Step 30 Decimal Quantity Test:**
   - Handles `25.50 m²`, `12.75 L`, `0.50 Ton` with zero precision drift.
