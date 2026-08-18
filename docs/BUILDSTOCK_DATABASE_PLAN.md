# BUILDSTOCK — Database Migration Plan

> **IMPORTANT:** This is a PLAN only. DO NOT execute migrations until approved.
> **Database:** MongoDB via Prisma ODM
> **Audit date:** 2026-08-13

---

## 1. Core Principle

- DO NOT delete existing models unless absolutely necessary.
- Add new fields as OPTIONAL (nullable) first — backward-safe.
- No destructive changes in Phase 0.
- Migrations will be applied incrementally in later phases.

---

## 2. Existing Models — Decision for Each

### 2.1 User — MODIFY

**Status:** KEEP with modifications

**Required Changes:**
- Add new roles: `warehouse_manager`, `storekeeper`, `purchasing_officer`, `inventory_officer`, `viewer`
- Add `warehouseIds` (array of warehouse IDs for role-based warehouse access)
- Add `status` field (active/inactive) — currently missing
- Add `phone` field — missing

**Current issue:** `role` is a nullable string. Plan: keep as string but validate against enum in application layer.

```prisma
// PLANNED ADDITIONS (Phase 1)
model User {
  // ... existing fields ...
  phone       String?    // NEW: contact phone
  status      Boolean    @default(true) // NEW: active/inactive
  warehouseIds String[]  @db.ObjectId   // NEW: assigned warehouses
}
```

---

### 2.2 Product — REBUILD (Additive)

**Status:** MAJOR MODIFICATION — add fields without removing existing ones

**Required New Fields:**
- `brand` (String?) — manufacturer brand
- `barcode` (String?) — EAN/UPC barcode
- `unitId` (String?) — reference to Unit model
- `purchaseUnitId` (String?) — unit used for purchasing
- `saleUnitId` (String?) — unit used for selling
- `purchasePrice` (Float?) — cost from supplier
- `wholesalePrice` (Float?) — wholesale sale price (existing `price` becomes retailPrice)
- `minStock` (Float?) — configurable reorder point (replaces hardcoded 20)
- `maxStock` (Float?) — maximum stock level
- `weight` (Float?) — unit weight in kg
- `dimensions` (Json?) — { length, width, height, unit }
- `color` (String?) — color specification
- `material` (String?) — material type
- `modelNumber` (String?) — manufacturer model number
- `notes` (String?) — internal notes

**Rename:** `price` → keep as `price` (retail price) + add `purchasePrice`, `wholesalePrice`

**NO FIELDS DELETED in this phase.**

```prisma
// PLANNED ADDITIONS (Phase 1)
model Product {
  // ... existing fields (all kept) ...
  brand         String?    // NEW
  barcode       String?    // NEW
  unitId        String?    @db.ObjectId  // NEW: ref to Unit
  purchaseUnitId String?   @db.ObjectId  // NEW
  saleUnitId    String?    @db.ObjectId  // NEW
  purchasePrice Float?     // NEW: cost price
  wholesalePrice Float?    // NEW: wholesale price
  minStock      Float?     // NEW: replaces hardcoded threshold
  maxStock      Float?     // NEW
  weight        Float?     // NEW
  dimensions    Json?      // NEW: {length, width, height, unit}
  color         String?    // NEW
  material      String?    // NEW
  modelNumber   String?    // NEW
  notes         String?    // NEW
}
```

---

### 2.3 Category — MODIFY

**Status:** ADD subcategory support

**Required Changes:**
- Add `parentId` (String?) — makes it a self-referential hierarchy

```prisma
// PLANNED ADDITION (Phase 1)
model Category {
  // ... existing fields ...
  parentId  String?   @db.ObjectId  // NEW: parent category (null = top-level)
  code      String?                 // NEW: short category code
}
```

---

### 2.4 Supplier — MODIFY

**Status:** ADD contact and address fields

**Required New Fields:**
- `commercialName` (String?) — trading name
- `taxId` (String?) — VAT/tax registration
- `contactName` (String?) — primary contact
- `phone` (String?) — phone number
- `email` (String?) — email address
- `address` (String?) — already exists as missing — add it
- `city` (String?)
- `country` (String?)
- `paymentTerms` (String?) — e.g., "Net 30"

**NO EXISTING FIELDS DELETED.**

---

### 2.5 Warehouse — MODIFY

**Status:** ADD code field, prepare for hierarchy

**Required Changes:**
- Add `code` (String?) — unique warehouse code (e.g., "WH-01")
- Add `managerId` (String?) — assigned manager reference
- Add `capacity` (Float?) — optional storage capacity

**Zone/Rack/Shelf/Bin hierarchy is FUTURE — design documented in BUILDSTOCK_DOMAIN.md**

---

### 2.6 StockAllocation — MODIFY

**Status:** KEEP — minimal changes needed

**Required Changes:**
- Add `unitId` (String?) — unit of measure reference
- Consider adding `binId` for future bin-level tracking

**All existing fields KEPT.**

---

### 2.7 StockTransfer — MODIFY

**Status:** KEEP — add transfer items support

**Required Changes:**
- Add `transferNumber` (String?) — human-readable reference
- Add `items` support — currently single-product only

**NOTE:** The existing model only supports a single product per transfer. Future: multi-item transfers.

---

### 2.8 Order — MODIFY

**Status:** KEEP for sales orders — decouple from Stripe/Shippo

**Required Changes:**
- `stripePaymentIntentId` → make optional (already is)
- `trackingNumber/trackingCarrier/trackingUrl/labelUrl` → keep but won't be populated by Shippo
- Add `orderType` (String?) — "sales" | "purchase" — distinguish order types

**NOTE:** The existing Order model serves sales orders. Purchase orders will be a NEW model.

---

### 2.9 OrderItem — KEEP

**Status:** No immediate changes needed.

---

### 2.10 Invoice — MODIFY

**Status:** KEEP — remove Stripe fields from active use

- `stripePaymentIntentId` → keep field but won't be used
- `paymentLink` → keep field — may be used for manual payment links

---

### 2.11 Notification — KEEP

**Status:** No changes needed.

---

### 2.12 AuditLog — MODIFY

**Status:** ADD `before` / `after` snapshot fields

**Required Changes:**
- Add `before` (Json?) — state before change
- Add `after` (Json?) — state after change
- Add `sessionId` (String?) — which session triggered the action
- Existing `details` field is a catch-all — will be supplemented by `before/after`

---

### 2.13 SystemConfig — KEEP

**Status:** No changes needed. Add BuildStock-specific keys via data seeding.

---

### 2.14 ImportHistory — KEEP

**Status:** No changes needed.

---

### 2.15 SupportTicket + SupportTicketReply — KEEP

**Status:** No changes needed.

---

### 2.16 ProductReview — FUTURE / REMOVE

**Status:** NOT needed for BuildStock initial scope.

**Action:** Keep the model in schema (MongoDB won't complain about unused models), but remove UI routes and API endpoints for ProductReview in cleanup phase.

---

### 2.17 Permission — REBUILD

**Status:** Currently a stub with no implementation.

**Plan:** Redesign as a proper permission document:
```prisma
// PLANNED REBUILD (Phase 2)
model Permission {
  id        String   @id @default(auto()) @map("_id") @db.ObjectId
  userId    String   @db.ObjectId
  resource  String   // "products", "warehouses", "purchase_orders", etc.
  actions   String[] // ["create", "read", "update", "delete"]
  warehouseId String? @db.ObjectId  // null = all warehouses
}
```

---

### 2.18 Department — REMOVE

**Status:** Empty stub with only an ID field. No business logic references it.

**Action:** Safe to remove in Phase 1 when cleaning schema.

---

### 2.19 Session — REMOVE

**Status:** Leftover from next-auth adapter. Not used by custom JWT auth.

**Action:** Safe to remove after confirming no code references it.

---

### 2.20 VerificationToken — REMOVE

**Status:** Leftover from next-auth adapter. Not used.

**Action:** Safe to remove.

---

### 2.21 UserAction — REMOVE

**Status:** Empty stub. No fields, no references.

**Action:** Safe to remove.

---

### 2.22 StockAlert — REMOVE

**Status:** Empty stub. Stock alerts are handled via notifications — this model is unused.

**Action:** Safe to remove.

---

## 3. New Models Required

### 3.1 StockMovement — NEW (CRITICAL)

```prisma
model StockMovement {
  id              String    @id @default(auto()) @map("_id") @db.ObjectId
  movementNumber  String    @unique
  productId       String    @db.ObjectId
  warehouseId     String    @db.ObjectId
  type            String    // PURCHASE | SALE | TRANSFER_IN | TRANSFER_OUT |
                            // RETURN_TO_SUPPLIER | CUSTOMER_RETURN |
                            // ADJUSTMENT_IN | ADJUSTMENT_OUT | DAMAGE | LOSS | OPENING_BALANCE
  quantity        Float     // positive = IN, negative = OUT
  unitId          String?   @db.ObjectId
  referenceType   String?   // "PurchaseOrder" | "Order" | "StockTransfer" | "Adjustment"
  referenceId     String?   @db.ObjectId
  notes           String?
  createdAt       DateTime  @default(now()) @db.Date
  createdBy       String    @db.ObjectId

  @@index([productId])
  @@index([warehouseId])
  @@index([type])
  @@index([createdAt])
  @@index([referenceType, referenceId])
}
```

### 3.2 Unit (Unit of Measure) — NEW

```prisma
model Unit {
  id           String   @id @default(auto()) @map("_id") @db.ObjectId
  name         String   // "Square Meter"
  abbreviation String   // "m2"
  type         String   // quantity | area | weight | volume | length
  isBaseUnit   Boolean  @default(false)
  status       Boolean  @default(true)
  createdAt    DateTime @default(now()) @db.Date

  @@unique([abbreviation])
  @@index([type])
}
```

### 3.3 UnitConversion — NEW

```prisma
model UnitConversion {
  id          String   @id @default(auto()) @map("_id") @db.ObjectId
  fromUnitId  String   @db.ObjectId
  toUnitId    String   @db.ObjectId
  factor      Float    // toUnit = fromUnit * factor
  productId   String?  @db.ObjectId  // null = global; set for product-specific
  createdAt   DateTime @default(now()) @db.Date

  @@index([fromUnitId])
  @@index([toUnitId])
}
```

### 3.4 Brand — NEW

```prisma
model Brand {
  id        String   @id @default(auto()) @map("_id") @db.ObjectId
  name      String
  country   String?
  logoUrl   String?
  status    Boolean  @default(true)
  createdAt DateTime @default(now()) @db.Date

  @@unique([name])
}
```

### 3.5 PurchaseOrder — NEW (Phase 1)

```prisma
model PurchaseOrder {
  id              String             @id @default(auto()) @map("_id") @db.ObjectId
  poNumber        String             @unique
  supplierId      String             @db.ObjectId
  warehouseId     String             @db.ObjectId
  status          String             @default("draft") // draft|sent|confirmed|partially_received|received|cancelled
  expectedDate    DateTime?          @db.Date
  notes           String?
  subtotal        Float              @default(0)
  total           Float              @default(0)
  createdAt       DateTime           @default(now()) @db.Date
  updatedAt       DateTime?          @db.Date
  createdBy       String             @db.ObjectId
  updatedBy       String?            @db.ObjectId
  items           PurchaseOrderItem[]

  @@index([supplierId])
  @@index([warehouseId])
  @@index([status])
}

model PurchaseOrderItem {
  id              String   @id @default(auto()) @map("_id") @db.ObjectId
  purchaseOrderId String   @db.ObjectId
  productId       String   @db.ObjectId
  productName     String   // snapshot
  sku             String?  // snapshot
  quantity        Float
  unitId          String?  @db.ObjectId
  unitPrice       Float
  subtotal        Float
  purchaseOrder   PurchaseOrder @relation(fields: [purchaseOrderId], references: [id], onDelete: Cascade)
}
```

---

## 4. Migration Safety Rules

1. **ADD ONLY** in Phase 0/1 — no field removals.
2. All new fields must be optional (nullable) initially.
3. Empty stub models can be removed in a SEPARATE, explicitly reviewed migration.
4. Every migration must be tested locally before applying to production.
5. Before any migration, dump a complete MongoDB backup.
6. Never use `prisma migrate reset` on production.
7. Use `prisma db push` for additive-only changes in MongoDB (no migration files needed for MongoDB — it is schemaless).
8. Validate that Prisma client generation succeeds after every schema change.

---

## 5. Recommended Migration Order

| Phase | Actions |
|---|---|
| Phase 0 | Audit only — no changes |
| Phase 1-A | Remove stub models (Department, Session, VerificationToken, UserAction, StockAlert) |
| Phase 1-B | Add Unit, UnitConversion, Brand models |
| Phase 1-C | Add new optional fields to Product (brand, barcode, unit, prices, minStock, maxStock) |
| Phase 1-D | Add new optional fields to Supplier (phone, email, address, paymentTerms) |
| Phase 1-E | Add new optional fields to Category (parentId) |
| Phase 1-F | Add new optional fields to Warehouse (code, managerId) |
| Phase 1-G | Add StockMovement model |
| Phase 2-A | Add PurchaseOrder + PurchaseOrderItem models |
| Phase 2-B | Rebuild Permission model |
| Phase 2-C | Add Warehouse Zone/Rack/Shelf/Bin hierarchy |
