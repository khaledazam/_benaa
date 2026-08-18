# BUILDSTOCK — Branding Definition

> Audit date: 2026-08-13

---

## 1. Product Identity

| Property | Value |
|---|---|
| **Product Name** | BuildStock |
| **Full Name** | BuildStock — Construction Materials & Modern Decoration Warehouse Management System |
| **Short Name** | BuildStock |
| **Internal Code Name** | BUILDSTOCK |
| **Primary Domain** | Warehouse & Inventory Management |
| **Industry** | Construction, Building Materials, Interior Decoration |
| **Original System (to be replaced)** | Stockly |

---

## 2. Target Users

| Role | Description |
|---|---|
| **Warehouse Manager** | Oversees all warehouse operations, stock levels, and staff |
| **Storekeeper** | Receives goods, manages physical stock, performs counts |
| **Purchasing Officer** | Creates and manages purchase orders from suppliers |
| **Inventory Officer** | Monitors stock levels, performs adjustments and reconciliation |
| **Administrator** | Full system access — users, settings, all reports |
| **Management / Viewer** | Read-only access to reports and analytics dashboards |

---

## 3. Current Branding Issues

The following files contain "Stockly" branding that must be updated:

| File | Location | Current Value | Action |
|---|---|---|---|
| `app/layout.tsx` | line 46 | `"Stockly — Warehouse & Stock Inventory Management System"` | REPLACE |
| `app/layout.tsx` | line 47 | template `"Stockly — ..."` | REPLACE |
| `app/layout.tsx` | line 50 | description mentions "Stockly" | REPLACE |
| `app/layout.tsx` | line 51-58 | authors: Arnob Mahmud, personal URLs | REPLACE |
| `app/layout.tsx` | line 60 | `applicationName: "Stockly"` | REPLACE |
| `app/layout.tsx` | line 90 | `title: "Stockly — ..."` | REPLACE |
| `app/layout.tsx` | line 94 | `siteName: "Stockly"` | REPLACE |
| `app/layout.tsx` | line 100 | `alt: "Stockly — ..."` | REPLACE |
| `app/layout.tsx` | line 106 | `title: "Stockly — ..."` | REPLACE |
| `app/layout.tsx` | line 85 | `stockly-inventory.vercel.app` | REPLACE |
| `prisma/schema.prisma` | line 1 | `Prisma schema for Stockly` | REPLACE |
| `.env.example` | line 8 | `mongodb://localhost:27017/stockly` | REPLACE |
| `package.json` | line 2 | `"name": "stock-inventory"` | REPLACE |
| `package.json` | line 3 | `"version": "2.0.1"` | UPDATE |
| `next.config.ts` | line 45 | `"arnob-mahmuds-org"` (Sentry fallback) | REMOVE fallback |
| `next.config.ts` | line 46 | `"stock-inventory"` (Sentry project) | REPLACE |
| `components/layouts/AdminSidebar.tsx` | line 149 | `"My Store"` section label | REPLACE with "My Warehouse" |
| `README.md` | entire file | Stockly README | REPLACE with BuildStock README |
| `CLAUDE.md` | entire file | Original system docs | UPDATE for BuildStock |

---

## 4. Replacement Values

| Field | New Value |
|---|---|
| App Name | BuildStock |
| Full Title | BuildStock — Construction Materials & Modern Decoration Warehouse Management System |
| Short Description | Professional warehouse management system for construction materials and decoration suppliers. Manage stock, warehouses, suppliers, purchase orders, and inventory with full auditability. |
| Application Name (metadata) | BuildStock |
| Site Name (OG) | BuildStock |
| Database Name | buildstock |
| Package Name | buildstock |
| Package Version | 1.0.0 (fresh versioning for BuildStock) |
| Sentry Project | buildstock |

---

## 5. Phase 0 Safe Branding Changes

> These changes are non-destructive and safe to make in Phase 0:

### 5.1 Update `app/layout.tsx` metadata

Replace "Stockly" in title, description, applicationName, siteName, authors.

**SAFE:** This is purely metadata — no business logic.

### 5.2 Update `package.json` name

Change `"name": "stock-inventory"` to `"name": "buildstock"`.

**SAFE:** Internal npm package name; no production impact.

### 5.3 Update `prisma/schema.prisma` comment

Change the first comment line from "Prisma schema for Stockly" to "Prisma schema for BuildStock".

**SAFE:** Comment only; no schema change.

### 5.4 Update `.env.example` database name

Change `stockly` to `buildstock` in the example DATABASE_URL.

**SAFE:** Example file only; no impact on existing `.env`.

### 5.5 Update Admin Sidebar section labels

Change "My Store" to "My Warehouse" in `AdminSidebar.tsx`.

**SAFE:** UI text only; no business logic.

---

## 6. Phase 0 Branding NOT to Touch

> These changes are deferred — not safe to rush:

- Do NOT redesign the UI.
- Do NOT replace the color scheme yet.
- Do NOT rename API endpoints.
- Do NOT rename database models.
- Do NOT change navigation structure yet.
- Do NOT update `README.md` until Phase 1 is complete.
- Do NOT update `CLAUDE.md` (used for AI context) until Phase 1 is complete.

---

## 7. Future Brand Guidelines (for Phase 2 UI)

When a UI redesign is performed, BuildStock should follow these brand guidelines:

### Color Palette
- **Primary:** Deep amber/orange — representing construction energy and materials
  - Suggested: HSL(32, 85%, 45%) — rich amber
- **Secondary:** Slate gray — representing concrete and steel
  - Suggested: HSL(215, 20%, 30%) — dark slate
- **Accent:** Warm white and off-white backgrounds
- **Danger/Warning:** Standard red/yellow
- **Success:** Forest green — HSL(145, 50%, 35%)

### Typography
- **Primary font:** Inter or Outfit (clean, professional)
- **Monospace:** Geist Mono (already in use)
- **Arabic font:** Noto Naskh Arabic or Cairo (for future RTL support)

### Logo Concept
- A stylized combination of a warehouse building and construction material element
- Clean, bold, modern
- Works in both LTR and RTL contexts

### UI Tone
- Professional and efficient
- Not consumer-facing — designed for warehouse staff
- Dense information density acceptable (not a consumer app)
- Dark mode support (already implemented)

---

## 8. Internationalization Preparation

Even though Arabic/RTL is a FUTURE feature, the following must be prepared now:

| Requirement | Action |
|---|---|
| `lang="en"` in `app/layout.tsx` | Change to support dynamic lang attribute |
| CSS direction | Use logical properties (margin-inline-start) instead of left/right |
| Component alignment | Avoid hardcoded `text-left` — use `text-start` |
| HTML structure | Avoid relying on absolute pixel positioning |
| Number formatting | Use `Intl.NumberFormat` not manual string formatting |
| Date formatting | Use `Intl.DateTimeFormat` not hardcoded formats |
