# BUILDSTOCK — Operations UI & Dashboard Architecture

> **Document:** BuildStock Operations UI Architecture Specification
> **Phase:** Phase 4 — Operations UI & Warehouse Management Interface
> **Date:** 2026-08-13

---

## 1. UI Architecture Audit Findings

### Existing System Inspection
- **Framework & Layout:** Next.js 16 App Router using `components/layouts/Header.tsx` and `components/layouts/AdminSidebar.tsx`.
- **State Management & Data Fetching:** React Query (`hooks/queries`) and Zustand (`stores`).
- **Form Controls & Validation:** React Hook Form + Zod (`@hookform/resolvers/zod`).
- **Design System:** Tailwind CSS + Radix UI primitives (`components/ui`).

---

## 2. Operations-First Design Principles

BuildStock is designed for **warehouse employees, inventory officers, purchasing managers, and storekeepers**.

- **Desktop & Tablet Optimized:** High-density, high-contrast readability for warehouse workstations and rugged tablets.
- **Enterprise Software Aesthetics:** Clean typography, status indicator badges (`IN_STOCK`, `LOW_STOCK`, `OUT_OF_STOCK`, `OVERSTOCK`), zero decorative glassmorphism or bloated gradients.
- **Decimal & Unit Precision:** Clear formatting for decimal measurements (e.g. `125.50 m²`, `2.75 L`, `0.5 Ton`).
- **Barcode & SKU Search Priority:** Direct scanner keyboard input compatibility across search fields.

---

## 3. Operations Navigation Structure

```
DASHBOARD (/admin/dashboard-overall-insights)

WAREHOUSE
├── Warehouses (/warehouses)
├── Warehouse Detail & Locations (/warehouses/[id])
├── Physical Inventory (/inventory)
├── Bin Relocations (/inventory/relocations)
├── Stock Transfers (/inventory/transfers)
└── Stock Movement Ledger (/inventory/movements)

PROCUREMENT
├── Purchase Orders (/purchasing)
├── Goods Receipts (/purchasing/goods-receipts)
└── Suppliers (/suppliers)

CATALOG
├── Products (/products)
├── Categories (/categories)
├── Brands (/brands)
└── Units of Measure (/units)

ADMINISTRATION
├── User Management (/admin/user-management)
├── Activity History (/admin/activity-history)
└── Settings (/settings)
```

---

## 4. Permission-Aware UI Enforcement

Navigation items, action buttons (e.g. `Relocate Stock`, `Post Goods Receipt`, `Approve PO`), and CRUD dialogs check server permissions via `hasPermission(userRole, permission)` before rendering. UI checks are supplementary to mandatory server-side API authorization.
