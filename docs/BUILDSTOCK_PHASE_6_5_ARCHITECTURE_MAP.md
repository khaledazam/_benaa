# BUILDSTOCK — PHASE 6.5 ARCHITECTURE MAP & REPOSITORY INVENTORY

---

## 1. System Overview

BuildStock is an independent, enterprise-grade Warehouse Management System (WMS) for construction and modern decoration materials (tiles, cement, paints, plaster, profiles, marble, tools, and hardware).

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                   CLIENT LAYER                                         │
│   Next.js App Router (Dashboard Views, Modals, Touch-Friendly Operational Screens)     │
└───────────────────────────────────────────┬────────────────────────────────────────────┘
                                            │ REST / Server Actions (JSON)
                                            ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                              AUTHENTICATION & RBAC LAYER                               │
│   Session Verification (lib/auth-server.ts) & Permission Checks (lib/auth/permissions.ts)│
└───────────────────────────────────────────┬────────────────────────────────────────────┘
                                            │ Authenticated Request Context
                                            ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                   SERVICE DOMAINS                                      │
│                                                                                        │
│  [Procurement]          [Locations & Bins]       [Sales Orders]       [Reservations]   │
│  procurementService.ts  warehouseLocationService  salesOrderService    reservationService│
│                                                                                        │
│  [Picking & Allocation] [Dispatch & Deduction]   [Stock Adjustments]  [Inventory Count]│
│  pickingService.ts      dispatchService.ts       adjustmentService.ts  countingService.ts│
│                                                                                        │
│                                           │ All Physical Mutations                     │
│                                           ▼                                            │
│                      ┌──────────────────────────────────────────┐                      │
│                      │  CENTRAL MUTATION ENGINE (stockService)   │                      │
│                      │  executeStockMutationInTx                │                      │
│                      └────────────────────┬─────────────────────┘                      │
└───────────────────────────────────────────┼────────────────────────────────────────────┘
                                            │ Transactional Operations ($transaction)
                                            ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                  DATABASE & STORAGE                                    │
│       Prisma ORM Client <---> MongoDB / Postgre / MySQL Database                      │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Directory Structure & Module Breakdown

- **`app/`**: Next.js App Router endpoints and page routes.
  - `app/api/`: REST API endpoints grouped by domain (`inventory/`, `purchase-orders/`, `goods-receipts/`, `sales-orders/`, `reservations/`, `pick-lists/`, `dispatches/`, `warehouses/`, `products/`, `reports/`, etc.).
  - `app/(dashboard)/`: Server-rendered page wrappers rendering client view components.
- **`components/`**: Modular React UI view components grouped by domain (`procurement/`, `sales/`, `reservations/`, `picking/`, `dispatch/`, `inventory/`, `shared/`, `ui/`).
- **`lib/`**: Core business domain logic, validation schemas, authorization matrix, and utilities.
  - `lib/auth/`: RBAC permission schemas (`permissions.ts`), role mappings, session mappers.
  - `lib/auth-server.ts`: Server-side session verification.
  - `lib/inventory/`: Central stock engine (`stockService.ts`), location service, adjustment service, counting service, dispatch service, picking service, reservation service, reconciliation service, reporting service.
  - `lib/validations/`: Zod input validation schemas for all domain endpoints.
- **`prisma/`**: Prisma database schema (`schema.prisma`) and client instance exports (`client.ts`).
- **`docs/`**: Architectural audit reports, technical guides, and domain manuals (Phases 0–6).

---

## 3. Physical Stock Mutation Lifecycle & Invariants

All physical inventory changes route exclusively through `executeStockMutationInTx` in `lib/inventory/stockService.ts`.

### Mutation Triggers
1. **Goods Receipt POST** $\rightarrow$ `PURCHASE` movement $\rightarrow$ Physical stock increases (+).
2. **Dispatch POST** $\rightarrow$ `SALE` movement $\rightarrow$ Physical stock decreases (-).
3. **Stock Relocation** $\rightarrow$ `RELOCATION` movement $\rightarrow$ Bin location transfer (0 warehouse net change).
4. **Stock Adjustment POST** $\rightarrow$ `ADJUSTMENT_IN` / `ADJUSTMENT_OUT` / `DAMAGE` / `LOSS` / `EXPIRY` / `FOUND` movement $\rightarrow$ Physical stock increases/decreases ($\pm$).

### Sacred Master Invariants
1. $availableStock = physicalStock - activeReservedStock \ge 0$.
2. Physical stock deduction belongs **EXCLUSIVELY** to authorized `POST` operations.
3. Every physical stock mutation generates a `StockMovement` row.
4. `StockLocationAllocation` sum per product/warehouse equals `StockAllocation.quantity`.
