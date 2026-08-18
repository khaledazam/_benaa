# BuildStock — Phase 5C Implementation Summary
## Picking & Pick List Engine

### Overview
Phase 5C completes the **Picking & Pick List Engine** for BuildStock WMS. 
Picking bridges commercial Stock Reservations (Phase 5B) with physical bin selection before final Dispatch (Phase 5D).

---

### Core Principles & Critical Invariant

> **CRITICAL INVARIANT: PICKING ≠ STOCK DEDUCTION**
> - Picking MUST NOT deduct physical inventory.
> - Picking MUST NOT modify `StockAllocation.quantity` or `StockLocationAllocation.quantity`.
> - Picking MUST NOT create `SALE` `StockMovement` records.
> - Picking MUST NOT reduce reservation quantities.
> - Physical stock deduction and `SALE` `StockMovement` records belong exclusively to Phase 5D Dispatch.

---

### Key Capabilities Implemented

1. **Domain Models (`prisma/schema.prisma`)**:
   - `PickList`: Managed lifecycle (`DRAFT` → `ASSIGNED` → `IN_PROGRESS` → `COMPLETED` / `CANCELLED`). Sequential `PICK-2026-XXXXXX` numbering.
   - `PickListItem`: Line item status (`PENDING`, `PARTIALLY_PICKED`, `PICKED`, `SHORT`).
   - `PickAllocation`: Bin-level physical selection without deducting physical stock.

2. **Physical Stock Isolation & Concurrency Guard**:
   - Computes Pickable Stock per Bin:
     $$\text{pickableStock} = \text{StockLocationAllocation.quantity} - \sum \text{PickAllocation.requestedQuantity for OTHER active picks}$$
   - Prevents concurrent pickers from over-committing physical bin stock.

3. **Auto-Suggest Bin Strategy**:
   - Greedily suggests active bins within the target warehouse containing requested product, sorted by `locationPath` (logical warehouse route).

4. **Short Picking Protocol**:
   - Supports explicit short picking (e.g. 80 picked out of 100 requested).
   - Marks line item as `SHORT`, records `short_pick_recorded` audit event, and leaves unfulfilled portion (`20`) reserved on the Stock Reservation for future picking or release.

5. **Centralized RBAC**:
   - Configured 7 permissions: `PICK_LIST_VIEW`, `PICK_LIST_CREATE`, `PICK_LIST_ASSIGN`, `PICK_LIST_START`, `PICK_LIST_UPDATE`, `PICK_LIST_COMPLETE`, `PICK_LIST_CANCEL`.

6. **REST API Suite**:
   - `GET /api/pick-lists`
   - `POST /api/pick-lists`
   - `GET /api/pick-lists/:id`
   - `POST /api/pick-lists/:id/assign`
   - `POST /api/pick-lists/:id/start`
   - `POST /api/pick-lists/:id/allocations`
   - `PATCH /api/pick-lists/:id/allocations/:allocationId`
   - `POST /api/pick-lists/:id/complete`
   - `POST /api/pick-lists/:id/cancel`
   - `GET /api/pick-lists/:id/suggestions`
   - `GET /api/inventory/picking-availability`

7. **User Interface**:
   - Directory page: `/inventory/picking` with status tabs, search, warehouse filter, picker assignment status, and creation modal.
   - Detail page: `/inventory/picking/[id]` with line item details, physical bin selection, location path formatting (`Warehouse / Zone / Rack / Shelf / Bin`), auto-suggestion button, save allocations, complete pick list (with short pick confirmation modal), and cancel pick list.

---

### Verification Summary
- **Prisma Schema**: `npx prisma generate` successful.
- **TypeScript**: 0 errors (`npx tsc --noEmit`).
- **ESLint**: 0 errors (`npm run lint`).
- **Unit & Integration Tests**: 100% passing across 129 test files and 920 tests (`npx vitest run`).
- **Production Build**: Successful bundle (`npm run build`).
