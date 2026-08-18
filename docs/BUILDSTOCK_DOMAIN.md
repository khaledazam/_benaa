# BUILDSTOCK — Domain Definition

> **Product Name:** BuildStock
> **Full Name:** BuildStock — Construction Materials & Modern Decoration Warehouse Management System
> **Audit date:** 2026-08-13

---

## 1. What BuildStock Is

BuildStock is NOT a generic warehouse application.

It is specifically designed for businesses that trade, store, and distribute:

- **Construction materials** — bricks, blocks, cement, mortar, concrete, rebar, structural steel
- **Tiles** — ceramic tiles, porcelain tiles, natural stone tiles, mosaic
- **Paints** — interior paint, exterior paint, primers, varnishes, lacquers
- **Sanitary ware** — toilets, basins, bathtubs, shower trays
- **Plumbing supplies** — pipes, fittings, valves, water heaters, pumps
- **Finishing materials** — gypsum, plaster, putty, fillers, screeds
- **Decoration materials** — wallpaper, decorative panels, false ceilings, moldings
- **Tools** — hand tools, power tools, safety equipment
- **Electrical accessories** — cables, switches, sockets, breakers, conduit
- **Flooring** — parquet, laminate, vinyl, carpet, terrazzo
- **Wall decoration** — wall cladding, 3D panels, wall art
- **Adhesives and installation materials** — tile adhesive, grout, sealants, silicone, epoxy

---

## 2. Target Users

| Role | Responsibility in BuildStock |
|---|---|
| **Administrator** | Full system access — users, settings, all reports |
| **Warehouse Manager** | Manages warehouses, stock, transfers, adjustments |
| **Storekeeper** | Receives goods, picks orders, performs stock counts |
| **Purchasing Officer** | Creates and manages purchase orders from suppliers |
| **Inventory Officer** | Monitors stock levels, adjustments, reconciliation |
| **Management / Viewer** | Read-only access to reports and dashboards |

---

## 3. Core Domain Concepts

> **NOTE:** This section DEFINES the domain. Not all models will be implemented immediately.

### 3.1 Product

Represents a physical item in the warehouse.

```
Product
  ├── name              — display name
  ├── sku               — unique internal code
  ├── barcode           — EAN/UPC barcode for scanning
  ├── brand             — manufacturer/brand name
  ├── category          — primary category (Tiles, Paints, Flooring, etc.)
  ├── subcategory       — secondary classification
  ├── model             — model/series number
  ├── color             — for color-coded materials
  ├── material          — substrate (porcelain, ceramic, vinyl, etc.)
  ├── size              — physical size (e.g., 60x60 cm)
  ├── weight            — unit weight in kg
  ├── dimensions        — L x W x H per unit
  ├── purchaseUnit      — unit used when buying (e.g., Pallet)
  ├── storageUnit       — unit used in warehouse (e.g., Box)
  ├── saleUnit          — unit used when selling (e.g., Piece)
  ├── purchasePrice     — cost from supplier (per storage unit)
  ├── retailPrice       — standard sale price
  ├── wholesalePrice    — bulk/wholesale sale price
  ├── minStock          — reorder point (per product)
  ├── maxStock          — maximum stock level
  ├── status            — active | discontinued | pending
  ├── imageUrl          — product image
  ├── qrCodeUrl         — QR code for scanning
  └── supplier          — primary supplier reference
```

### 3.2 Category

Hierarchical classification of products:

```
Category
  ├── name              — e.g., "Tiles"
  ├── parentId          — null for top-level, ref for subcategories
  ├── description
  └── status

Examples:
  Tiles → Porcelain Tiles
  Tiles → Ceramic Tiles
  Tiles → Mosaic
  Paints → Interior Paints
  Paints → Exterior Paints
  Flooring → Laminate
  Flooring → Parquet
```

### 3.3 Brand

Manufacturer / brand information:

```
Brand
  ├── name              — e.g., "Weber", "Dulux", "Roca", "Grespania"
  ├── country           — country of origin
  ├── logoUrl
  └── status
```

### 3.4 Unit of Measure (UOM)

```
Unit
  ├── name              — e.g., "Box", "Square Meter", "Kilogram"
  ├── abbreviation      — e.g., "BOX", "m2", "kg"
  ├── type              — quantity | area | weight | volume | length
  └── isBaseUnit        — whether this is a base unit

Supported Units:
  - Piece (PCS)
  - Box (BOX)
  - Meter (m)
  - Square Meter (m2)
  - Cubic Meter (m3)
  - Kilogram (kg)
  - Ton (T)
  - Liter (L)
  - Gallon (gal)
  - Roll (ROL)
  - Bundle (BND)
  - Package (PKG)
  - Pallet (PLT)
  - Bag (BAG)
  - Can (CAN)
  - Tube (TBE)
```

### 3.5 Unit Conversion

```
UnitConversion
  ├── fromUnitId        — e.g., "Box"
  ├── toUnitId          — e.g., "Piece"
  ├── factor            — e.g., 6 (1 Box = 6 Pieces)
  └── productId         — optional: product-specific conversion

Examples:
  1 Pallet = 48 Boxes (tiles)
  1 Box = 6 Pieces (60x60 tiles)
  1 Bag (25kg) = 25 Kilograms (cement)
  1 Roll = 25 Square Meters (wallpaper)
```

### 3.6 Supplier

```
Supplier
  ├── name
  ├── commercialName    — trading name
  ├── taxId             — VAT/Tax ID
  ├── contactName       — primary contact person
  ├── phone
  ├── email
  ├── address           — full address
  ├── city
  ├── country
  ├── paymentTerms      — e.g., "Net 30", "Cash on Delivery"
  ├── notes
  └── status
```

### 3.7 Warehouse

```
Warehouse
  ├── name
  ├── code              — short code (e.g., "WH-01")
  ├── address
  ├── type              — main | secondary | storage | showroom
  ├── manager           — assigned manager (User ref)
  └── status

  → Zone
      ├── name (e.g., "A", "B", "Heavy Materials")
      └── warehouseId

      → Rack
          ├── name (e.g., "A-01")
          └── zoneId

          → Shelf
              ├── name (e.g., "A-01-1")
              └── rackId

              → Bin / Location
                  ├── name (e.g., "A-01-1-01")
                  └── shelfId

                  → ProductStock
                      ├── productId
                      ├── binId
                      └── quantity
```

### 3.8 Purchase Order

```
PurchaseOrder
  ├── poNumber          — unique PO number
  ├── supplierId
  ├── warehouseId       — receiving warehouse
  ├── status            — draft | sent | confirmed | partially_received | received | cancelled
  ├── expectedDate      — expected delivery date
  ├── notes
  └── items             — PurchaseOrderItem[]
      ├── productId
      ├── quantity
      ├── unit
      ├── unitPrice
      └── subtotal
```

### 3.9 Goods Receipt

```
GoodsReceipt
  ├── grNumber          — unique GR number
  ├── purchaseOrderId
  ├── warehouseId
  ├── receivedDate
  ├── receivedBy        — User ref
  ├── notes
  └── items             — GoodsReceiptItem[]
      ├── purchaseOrderItemId
      ├── productId
      ├── quantityExpected
      ├── quantityReceived
      └── unit
```

### 3.10 Stock Movement (Ledger)

```
StockMovement
  ├── movementNumber    — unique reference
  ├── productId
  ├── warehouseId
  ├── type              — see movement types below
  ├── quantity          — positive for IN, negative for OUT
  ├── unit
  ├── referenceType     — "PurchaseOrder" | "Order" | "StockTransfer" | "Adjustment" | "Manual"
  ├── referenceId       — ID of the source document
  ├── notes
  ├── createdAt
  └── createdBy

Movement Types:
  PURCHASE            — goods received from supplier
  SALE                — goods dispatched for customer order
  TRANSFER_IN         — stock received from another warehouse
  TRANSFER_OUT        — stock sent to another warehouse
  RETURN_TO_SUPPLIER  — goods returned to supplier
  CUSTOMER_RETURN     — goods returned by customer
  ADJUSTMENT_IN       — manual positive adjustment
  ADJUSTMENT_OUT      — manual negative adjustment
  DAMAGE              — damaged/written-off goods
  LOSS                — lost/shrinkage
  OPENING_BALANCE     — initial stock entry on system go-live
```

### 3.11 Stock Transfer

```
StockTransfer
  ├── transferNumber
  ├── fromWarehouseId
  ├── toWarehouseId
  ├── status            — draft | in_transit | completed | cancelled
  ├── transferDate
  ├── notes
  └── items             — StockTransferItem[]
      ├── productId
      ├── quantity
      └── unit
```

### 3.12 Stock Adjustment

```
StockAdjustment
  ├── adjustmentNumber
  ├── warehouseId
  ├── type              — positive | negative
  ├── reason            — damage | loss | count_correction | opening_balance | other
  ├── approvedBy        — User ref (requires authorization)
  ├── notes
  └── items             — StockAdjustmentItem[]
      ├── productId
      ├── quantity
      └── unit
```

### 3.13 Stock Count (Physical Inventory)

```
StockCount
  ├── countNumber
  ├── warehouseId
  ├── status            — draft | in_progress | completed
  ├── scheduledDate
  ├── completedDate
  ├── countedBy         — User ref
  └── items             — StockCountItem[]
      ├── productId
      ├── expectedQuantity   — system quantity
      ├── actualQuantity     — physically counted
      └── variance          — difference
```

### 3.14 Sales Order (Outbound)

```
SalesOrder
  ├── orderNumber
  ├── customerId / clientId
  ├── warehouseId       — dispatching warehouse
  ├── status            — draft | confirmed | picking | dispatched | delivered | cancelled
  ├── deliveryAddress
  ├── notes
  └── items             — SalesOrderItem[]
      ├── productId
      ├── quantity
      ├── unit
      ├── unitPrice
      └── subtotal
```

### 3.15 User

```
User
  ├── name, email, password (hashed)
  ├── role              — admin | warehouse_manager | storekeeper | purchasing_officer | inventory_officer | viewer | supplier
  ├── warehouseIds      — assigned warehouses (for role-based access)
  └── status
```

### 3.16 Role

```
Roles:
  administrator         — full system access
  warehouse_manager     — manage warehouses, stock, transfers
  storekeeper           — receive goods, pick orders, stock counts
  purchasing_officer    — create/manage purchase orders
  inventory_officer     — stock adjustments, reconciliation
  viewer                — read-only reports and dashboards
  supplier              — supplier portal access only
```

### 3.17 Permission

```
Permission
  ├── role or userId
  ├── resource          — "products", "warehouses", "purchase_orders", etc.
  └── actions           — create | read | update | delete
```

### 3.18 Audit Log

```
AuditLog
  ├── userId
  ├── action            — create | update | delete | approve | reject | login | logout
  ├── entityType        — Product | StockMovement | PurchaseOrder | Order | User | etc.
  ├── entityId
  ├── before            — JSON snapshot before change
  ├── after             — JSON snapshot after change
  ├── ipAddress
  └── createdAt
```

---

## 4. Business Rules

1. Every stock change MUST generate a `StockMovement` record.
2. Stock quantities MUST NOT be modified silently — all changes traceable.
3. `Product.quantity` MUST always equal the sum of all `StockAllocation.quantity` for that product.
4. Purchase orders MUST be approved before goods can be received.
5. Stock adjustments MUST be approved by a manager or above.
6. Warehouse quantities are always warehouse-specific.
7. Unit conversions MUST be respected when recording movements.
8. Products cannot be deleted if they have stock movement history (soft delete only).
9. Low stock alerts MUST be triggered when stock falls below `Product.minStock`.
10. All financially significant operations MUST be auditable.

---

## 5. Language and Localization Requirements

- **Primary language:** Arabic (primary user base)
- **Secondary language:** English
- **UI direction:** RTL (Arabic) / LTR (English)
- **Number formatting:** Support Arabic-Indic numerals optionally
- **Date formatting:** Support Gregorian and Hijri calendars optionally
- **Currency:** Support multiple currencies (EGP, SAR, AED, USD)

---

## 6. Technical Principles for BuildStock

1. Inventory must be auditable.
2. Stock quantities must not be modified silently.
3. Every stock-changing operation must generate a StockMovement.
4. Warehouse stock must be warehouse-specific.
5. Product quantities must support unit conversions.
6. Business logic must not be duplicated between UI and API.
7. API validation must be centralized using Zod schemas.
8. Authorization must be enforced server-side in every route.
9. Financially important operations must be auditable with before/after snapshots.
10. Database changes must be backward-safe (no destructive migrations).
11. The system must be ready for a future React Native Android application.
12. The API layer must remain independent from the web UI.
13. BuildStock must support Arabic and English in the future.
14. RTL/LTR must be considered in the UI architecture from the start.
15. The system should be scalable to multiple warehouses and branches.
