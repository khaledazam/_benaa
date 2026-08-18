# BUILDSTOCK — Phase 1 Implementation & Technical Report

> **Project:** BuildStock — Construction Materials & Modern Decoration Warehouse Management System
> **Phase:** Phase 1 — Foundation & Domain Extension
> **Date:** 2026-08-13
> **Status:** COMPLETED

---

## 1. Executive Summary

Phase 1 establishes the core domain foundation and architectural integrity for **BuildStock**. The generic inventory app has been transformed into a production-ready construction materials warehouse management system with:

- **Safe Cleanup:** Removal of dead code (`middleware/authMiddleware.ts`), unused dependencies (`next-auth`), and 5 stub Prisma models (`Department`, `Session`, `VerificationToken`, `UserAction`, `StockAlert`).
- **Security & Authorization Foundation:** Root `/middleware.ts` for route protection, centralized server-side authorization in `/lib/auth/requireRole.ts` and `/lib/auth/permissions.ts`.
- **Role-Based Access Control (RBAC):** Defined 6 initial BuildStock roles (`SUPER_ADMIN`, `WAREHOUSE_MANAGER`, `STOREKEEPER`, `PURCHASING_OFFICER`, `INVENTORY_OFFICER`, `VIEWER`) with a full role-permission matrix.
- **Product Domain Extension:** Extended `Product` with barcode, brand, subcategory, model, size, color, material, weight, dimensions, 3 price tiers (purchase, retail, wholesale), and units of measure.
- **Decimal Quantity Support:** Replaced integer/BigInt quantities with Float representation to support decimal measurements (e.g., 1.44 m², 2.75 L, 0.5 ton, 12.5 kg).
- **Unit of Measure & Conversions:** Implemented `Unit` model with 12 standard units and `UnitConversion` model supporting both global and product-specific conversion factors.
- **Brand System:** Implemented `Brand` model and brand service.
- **Internal Stock Movement Ledger:** Built `StockMovement` model and central `stockService.ts` executing all stock mutations atomically with complete previous/new stock history tracking across 11 movement types.
- **Configurable Stock Thresholds:** Removed hardcoded 20-unit threshold. Implemented dynamic status calculation (`IN_STOCK`, `LOW_STOCK`, `OUT_OF_STOCK`, `OVERSTOCK`) using `Product.minimumStock` and `Product.maximumStock`.
- **Testing & Verification:** Added unit and integration tests verifying stock math, unit conversions, authorization, and the Step 18 critical movement scenario (100 + 50 - 25 - 5 = 120 boxes).

---

## 2. Models Added & Modified

### New Prisma Models

```prisma
model Brand {
  id          String    @id @default(auto()) @map("_id") @db.ObjectId
  name        String    @unique
  code        String?
  description String?
  logoUrl     String?
  active      Boolean   @default(true)
  createdAt   DateTime  @default(now()) @db.Date
  updatedAt   DateTime? @db.Date
}

model Unit {
  id           String   @id @default(auto()) @map("_id") @db.ObjectId
  name         String
  code         String   @unique
  symbol       String
  type         String
  isBaseUnit   Boolean  @default(false)
  active       Boolean  @default(true)
  createdAt    DateTime @default(now()) @db.Date
}

model UnitConversion {
  id          String   @id @default(auto()) @map("_id") @db.ObjectId
  fromUnitId  String   @db.ObjectId
  toUnitId    String   @db.ObjectId
  factor      Float
  productId   String?  @db.ObjectId
  createdAt   DateTime @default(now()) @db.Date

  @@index([fromUnitId])
  @@index([toUnitId])
  @@index([productId])
}

model StockMovement {
  id                 String    @id @default(auto()) @map("_id") @db.ObjectId
  movementNumber     String    @unique
  productId          String    @db.ObjectId
  warehouseId        String    @db.ObjectId
  quantity           Float
  unitId             String?   @db.ObjectId
  quantityInBaseUnit Float
  movementType       String
  previousStock      Float
  newStock           Float
  referenceType      String?
  referenceId        String?   @db.ObjectId
  reason             String?
  performedBy        String    @db.ObjectId
  approvedBy         String?   @db.ObjectId
  createdAt          DateTime  @default(now()) @db.Date

  @@index([productId])
  @@index([warehouseId])
  @@index([movementType])
  @@index([createdAt])
  @@index([referenceType, referenceId])
}
```

### Models Modified
- **User:** Added `phone`, `status`, `warehouseIds`, updated `role` definition.
- **Product:** Quantities changed from `BigInt` to `Float`. Added `barcode`, `brandId`, `brandName`, `subcategoryId`, `model`, `size`, `color`, `material`, `weight`, `dimensions`, `purchasePrice`, `wholesalePrice`, `retailPrice`, `unitId`, `purchaseUnitId`, `saleUnitId`, `minimumStock`, `maximumStock`, `isActive`.
- **StockAllocation:** Quantities changed from `BigInt` to `Float`. Added `unitId`.
- **StockTransfer:** Quantities changed from `BigInt` to `Float`. Added `unitId`, `transferNumber`.
- **Category:** Added `parentId` for subcategory hierarchy.
- **Supplier:** Added `contactName`, `phone`, `email`, `address`, `city`, `country`, `taxId`, `paymentTerms`.
- **Warehouse:** Added `code`, `managerId`.
- **Permission:** Updated schema for structured role/resource permission querying.

### Models Removed
- `Department`
- `Session`
- `VerificationToken`
- `UserAction`
- `StockAlert`

---

## 3. Architecture & Security Infrastructure

### 3.1 Route Protection (`middleware.ts`)
Created root `middleware.ts` protecting application routes (`/admin`, `/dashboard`, `/products`, `/categories`, `/warehouses`, `/inventory`, `/suppliers`, `/purchasing`, `/reports`, `/orders`, `/invoices`, `/settings`, `/business-insights`, `/support-tickets`). Unauthenticated requests are redirected to `/login` with `callbackUrl`. Security response headers (`X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`) are applied.

### 3.2 Centralized Server-Side Authorization (`/lib/auth/requireRole.ts`, `/lib/auth/permissions.ts`)
Server-side requests use `requireAuth(request, permission)` or `requireRole(request, allowedRoles)`. Client-side code cannot bypass authorization as checks are enforced on every route handler.

### 3.3 BuildStock Roles & Permission Matrix

| Role | Description | Key Permissions |
|---|---|---|
| `SUPER_ADMIN` | Full system administrator | All permissions |
| `WAREHOUSE_MANAGER` | Oversees warehouse stock and operations | Product, warehouse, stock movements, transfers, adjustments, reports |
| `STOREKEEPER` | Physical stock handling | Stock view, stock in, stock out, stock transfer, goods receipt |
| `PURCHASING_OFFICER` | Procurement from suppliers | Supplier management, purchase orders, product view |
| `INVENTORY_OFFICER` | Stock reconciliation & ledger | Stock movements, adjustments, counts, unit conversions, reports |
| `VIEWER` | Read-only access | Product, stock, warehouse, and report viewing |

---

## 4. Internal Stock Movement Ledger (`stockService.ts`)

All stock mutations go through `executeStockMutation` in `/lib/inventory/stockService.ts`.

### Movement Types
- `OPENING_BALANCE`
- `PURCHASE`
- `TRANSFER_IN`
- `TRANSFER_OUT`
- `SALE`
- `CUSTOMER_RETURN`
- `SUPPLIER_RETURN`
- `ADJUSTMENT_IN`
- `ADJUSTMENT_OUT`
- `DAMAGE`
- `LOSS`

### Stock Integrity Rules Enforced
1. Every stock change creates a `StockMovement` ledger entry.
2. No silent stock modifications.
3. Unit conversions automatically convert quantities to product base unit.
4. Stock allocations and global product stock update atomically in a Prisma transaction.
5. Attempting to deduct more stock than available throws a validation error.
6. Product status updates dynamically based on `Product.minimumStock` and `Product.maximumStock`.

---

## 5. API Endpoints Added

| Endpoint | Method | Description |
|---|---|---|
| `/api/brands` | GET | List active brands |
| `/api/brands` | POST | Create new brand |
| `/api/units` | GET | List units (auto-seeds defaults if empty) |
| `/api/units` | POST | Create new unit |
| `/api/unit-conversions` | GET | Get unit conversions (filtered by productId) |
| `/api/unit-conversions` | POST | Create unit conversion factor |
| `/api/stock-movements` | GET | Query stock movement ledger history |
| `/api/stock-movements` | POST | Submit stock operation (opening balance, purchase, damage, loss, adjustment) |
| `/api/stock-transfers` | POST | Execute stock transfer with paired `TRANSFER_OUT` + `TRANSFER_IN` ledger entries |

---

## 6. Decimal Quantity Strategy

1. **Storage:** MongoDB Double / Prisma `Float` @default(0).
2. **Precision:** IEEE 754 floating-point standard supported natively in JS/TS without requiring `BigInt` wrappers.
3. **Rounding:** Quantities rendered with unit-appropriate precision (e.g. 2 decimal places for m²/liters).
4. **Data Safety:** Backward-compatible representation preserves existing integer values while enabling decimal quantities.

---

## 7. Next Steps & Phase 2 Recommendations

1. **Phase 2 — Procurement & Purchase Orders:**
   - Purchase Order (PO) CRUD & workflow
   - Goods Receipt Note (GRN) receiving workflow linked to `PURCHASE` stock movement
   - Supplier invoice reconciliation

2. **Phase 2 — Warehouse Location Hierarchy:**
   - Warehouse -> Zone -> Rack -> Shelf -> Bin location tracking

3. **Phase 2 — UI Extensions:**
   - Units, Brands, and Stock Movement Ledger UI screens
   - Configurable minimum/maximum stock inputs in product forms
