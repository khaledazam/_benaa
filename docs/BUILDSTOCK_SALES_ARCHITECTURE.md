# BuildStock — Sales Architecture & Customer Domain (`/docs/BUILDSTOCK_SALES_ARCHITECTURE.md`)

## 1. Executive Summary & Domain Audit Findings

### Legacy `Order` Model vs Dedicated `SalesOrder` Domain
An exhaustive audit of the existing codebase revealed that the legacy `Order` and `OrderItem` models were designed for e-commerce B2C store checkouts (containing fields such as `stripePaymentIntentId`, `trackingCarrier`, `trackingUrl`, `labelUrl`, `shippingAddress` Json, and direct links to online `User` authentication).

BuildStock is an enterprise **Warehouse Management System (WMS) for Construction Materials & Modern Decoration**. It requires a dedicated B2B/B2C sales domain that meets WMS operational requirements:
1. **Independent `Customer` Entity:** A customer is a commercial client or construction firm, independent of system user login accounts (`User`). Customers do NOT need a BuildStock authentication account.
2. **Dedicated `SalesOrder` & `SalesOrderItem` Models:** Mirrors the enterprise architecture pattern established by `PurchaseOrder` and `PurchaseOrderItem` in Phase 2.
3. **Strict WMS Status Lifecycle:** `DRAFT` → `PENDING_APPROVAL` → `APPROVED` → `PROCESSING` → `COMPLETED` (with terminal `CANCELLED` state).
4. **Data Snapshots:** Captures historical snapshots of product name, SKU, unit symbol, customer code, customer name, and customer phone at the time of order creation.
5. **Critical Stock Isolation Invariant (Phase 5A):** Sales orders in Phase 5A do **NOT** reserve, allocate, pick, dispatch, or mutate physical inventory. All operations leave `StockAllocation`, `StockLocationAllocation`, and `StockMovement` **UNCHANGED**.

---

## 2. Customer Domain Specification

### Schema (`Customer`)
```prisma
model Customer {
  id             String       @id @default(auto()) @map("_id") @db.ObjectId
  customerCode   String       @unique // e.g. CUS-2026-000001
  name           String
  phone          String?
  alternatePhone String?
  email          String?
  address        String?
  city           String?
  country        String?
  taxNumber      String?
  notes          String?
  active         Boolean      @default(true)
  createdAt      DateTime     @default(now()) @db.Date
  updatedAt      DateTime?    @db.Date
  createdBy      String       @db.ObjectId
  updatedBy      String?      @db.ObjectId
  salesOrders    SalesOrder[]

  @@index([customerCode])
  @@index([name])
  @@index([phone])
  @@index([active])
}
```

### Customer Code Format
Server-generated human-readable code: `CUS-2026-XXXXXX` (e.g. `CUS-2026-000001`). Sequential database IDs are never exposed.

### Customer Lifecycle & Deactivation
- `ACTIVE`: Eligible for receiving new Sales Orders.
- `INACTIVE`: Cannot receive new Sales Orders. Remains visible in historical orders and reporting.
- **Deactivation Protection:** Hard deletion is blocked if historical sales order records exist. Logical deactivation (`PATCH /api/customers/:id` with `{ active: false }` or `DELETE /api/customers/:id`) is enforced.

---

## 3. Sales Order Domain Specification

### Schema (`SalesOrder` & `SalesOrderItem`)
```prisma
model SalesOrder {
  id                    String           @id @default(auto()) @map("_id") @db.ObjectId
  salesOrderNumber      String           @unique // e.g. SO-2026-000001
  customerId            String           @db.ObjectId
  customerCodeSnapshot  String?
  customerNameSnapshot  String?
  customerPhoneSnapshot String?
  warehouseId           String           @db.ObjectId
  status                String           @default("DRAFT")
  orderDate             DateTime         @default(now()) @db.Date
  requestedDeliveryDate DateTime?        @db.Date
  subtotal              Float            @default(0)
  discount              Float?
  tax                   Float?
  total                 Float            @default(0)
  notes                 String?
  createdBy             String           @db.ObjectId
  approvedBy            String?          @db.ObjectId
  approvedAt            DateTime?        @db.Date
  cancelledBy           String?          @db.ObjectId
  cancelledAt           DateTime?        @db.Date
  cancellationReason    String?
  createdAt             DateTime         @default(now()) @db.Date
  updatedAt             DateTime?        @db.Date
  customer              Customer         @relation(fields: [customerId], references: [id])
  warehouse             Warehouse        @relation(fields: [warehouseId], references: [id])
  items                 SalesOrderItem[]

  @@index([customerId])
  @@index([warehouseId])
  @@index([status])
  @@index([createdAt])
}

model SalesOrderItem {
  id              String     @id @default(auto()) @map("_id") @db.ObjectId
  salesOrderId    String     @db.ObjectId
  productId       String     @db.ObjectId
  productName     String     // Snapshot
  productSku      String?    // Snapshot
  unitId          String?    @db.ObjectId
  unitSymbol      String?    // Snapshot e.g. m², L, Ton
  orderedQuantity Float
  unitPrice       Float
  discount        Float?
  tax             Float?
  lineTotal       Float
  notes           String?
  createdAt       DateTime   @default(now()) @db.Date
  salesOrder      SalesOrder @relation(fields: [salesOrderId], references: [id], onDelete: Cascade)
  product         Product    @relation(fields: [productId], references: [id])

  @@index([salesOrderId])
  @@index([productId])
}
```

---

## 4. Status Lifecycle & Transition Matrix

### Allowed Transitions
| Current Status | Next Status | Allowed Action | Server Service Method | Guard Rules |
| :--- | :--- | :--- | :--- | :--- |
| `DRAFT` | `PENDING_APPROVAL` | Submit for Approval | `submitSalesOrder` | Validates active customer, valid items, quantities > 0 |
| `DRAFT` | `CANCELLED` | Cancel Draft | `cancelSalesOrder` | Marks order cancelled |
| `PENDING_APPROVAL` | `APPROVED` | Approve Order | `approveSalesOrder` | Requires `SALES_ORDER_APPROVE` permission |
| `PENDING_APPROVAL` | `DRAFT` | Revert to Draft | `revertSalesToDraft` | Allows revision before approval |
| `PENDING_APPROVAL` | `CANCELLED` | Reject / Cancel | `cancelSalesOrder` | Marks order cancelled with reason |
| `APPROVED` | `PROCESSING` | Start Processing | `startProcessingSalesOrder` | Transitions order to processing |
| `APPROVED` | `CANCELLED` | Cancel Approved | `cancelSalesOrder` | Requires `SALES_ORDER_CANCEL` permission |
| `PROCESSING` | `COMPLETED` | Complete Order | `completeSalesOrder` | Domain state completion in Phase 5A |
| `COMPLETED` | *(Terminal)* | None | None | **IMMUTABLE** — No status change allowed |
| `CANCELLED` | *(Terminal)* | None | None | **IMMUTABLE** — No status change allowed |

---

## 5. Critical Stock Isolation Invariant (Phase 5A Rule)

In Phase 5A:
$$\text{SalesOrder Actions} \implies \Delta (\text{StockAllocation}) = 0, \; \Delta (\text{StockLocationAllocation}) = 0, \; \Delta (\text{StockMovement}) = 0$$

- **Create, Update, Submit, Approve, Start Processing, Complete, or Cancel** operations perform **ZERO** inventory database mutations.
- `stockService` is not invoked for inventory deductions during Phase 5A.
- Stock reservation, picking, dispatch, delivery, and stock deduction are explicitly deferred to Phase 5B (Reservations) and Phase 5C (Picking & Dispatch).

---

## 6. Centralized Permission Matrix

| Permission Key | Description | Roles Granted |
| :--- | :--- | :--- |
| `CUSTOMER_VIEW` | View customer directory & profile | All Roles (`SUPER_ADMIN`, `WAREHOUSE_MANAGER`, `STOREKEEPER`, `PURCHASING_OFFICER`, `INVENTORY_OFFICER`, `VIEWER`) |
| `CUSTOMER_CREATE` | Create new customer records | `SUPER_ADMIN`, `WAREHOUSE_MANAGER` |
| `CUSTOMER_UPDATE` | Edit existing customer details | `SUPER_ADMIN`, `WAREHOUSE_MANAGER` |
| `CUSTOMER_DEACTIVATE` | Deactivate/reactivate customer | `SUPER_ADMIN`, `WAREHOUSE_MANAGER` |
| `SALES_ORDER_VIEW` | View sales orders & order details | All Roles |
| `SALES_ORDER_CREATE` | Create new DRAFT sales orders | `SUPER_ADMIN`, `WAREHOUSE_MANAGER` |
| `SALES_ORDER_UPDATE` | Edit DRAFT sales orders | `SUPER_ADMIN`, `WAREHOUSE_MANAGER` |
| `SALES_ORDER_SUBMIT` | Submit DRAFT for approval | `SUPER_ADMIN`, `WAREHOUSE_MANAGER` |
| `SALES_ORDER_APPROVE` | Approve pending sales orders | `SUPER_ADMIN`, `WAREHOUSE_MANAGER` |
| `SALES_ORDER_CANCEL` | Cancel sales orders | `SUPER_ADMIN`, `WAREHOUSE_MANAGER` |
| `SALES_ORDER_PROCESS` | Move order to PROCESSING | `SUPER_ADMIN`, `WAREHOUSE_MANAGER`, `STOREKEEPER` |
| `SALES_ORDER_COMPLETE` | Move order to COMPLETED | `SUPER_ADMIN`, `WAREHOUSE_MANAGER`, `STOREKEEPER` |

---

## 7. Financial Calculations & UOM Compatibility

### Calculation Formulas (Server-Authoritative)
For each line item:
$$\text{lineTotal} = (\text{orderedQuantity} \times \text{unitPrice}) - \text{discount} + \text{tax}$$

For the overall order:
$$\text{subtotal} = \sum \text{lineTotal}$$
$$\text{total} = \text{subtotal} - \text{orderDiscount} + \text{orderTax}$$

- Floating-point calculations are rounded deterministically to 2 decimal places.
- Decimal quantities (e.g., $12.50\text{ m}^2$, $5.75\text{ L}$, $0.50\text{ Ton}$) are fully supported.
- Selected units are validated against product sales units via `UnitConversion` service where applicable.

---

## 8. Audit Logging & Concurrency Protection

- **Audit Logs Recorded:** `customer_created`, `customer_updated`, `customer_deactivated`, `sales_order_created`, `sales_order_updated`, `sales_order_submitted`, `sales_order_approved`, `sales_order_cancelled`, `sales_order_processing_started`, `sales_order_completed`.
- **Atomic Transitions:** Status transition service methods perform atomic Prisma updates (`where: { id, status: currentStatus }`) to guarantee protection against race conditions.
