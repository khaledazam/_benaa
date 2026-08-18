# BuildStock — Phase 5A Implementation Summary
## Customers & Sales Order Foundation

**Status:** COMPLETE  
**Verification Baseline:**
- **Test Files:** 126 / 126 passed
- **Total Tests:** 896 / 896 passed
- **TypeScript:** 0 errors (`npx tsc --noEmit`)
- **ESLint:** 0 errors (`npm run lint`)
- **Prisma Client:** Regenerated & aligned (`npx prisma generate`)

---

## 1. Executive Summary & Architecture Decisions

Phase 5A establishes the core Customer and Sales Order management foundation for BuildStock WMS. Per explicit design directives, Phase 5A enforces the **CRITICAL STOCK ISOLATION INVARIANT**:

> **SALES ORDER ≠ STOCK DEDUCTION**  
> Creating, updating, submitting, approving, starting processing, completing, or cancelling a `SalesOrder` leaves physical inventory (`StockAllocation`, `StockLocationAllocation`, and `StockMovement`) **100% UNCHANGED**.

### Architecture Highlights
1. **Dedicated Models:** Created independent `Customer`, `SalesOrder`, and `SalesOrderItem` Prisma models (`Customer` != `User`; `SalesOrder` != e-commerce `Order`).
2. **Code Standards:**
   - Customer Code: `CUS-2026-XXXXXX` (server-generated)
   - Sales Order Number: `SO-2026-XXXXXX` (server-generated)
3. **Product & Customer Snapshots:** Historical line item snapshots (`productName`, `productSku`, `unitSymbol`, `customerNameSnapshot`, `customerCodeSnapshot`, `customerPhoneSnapshot`) ensure historical data integrity if catalog items or customer profiles update in the future.
4. **Decimal UOM Quantity Support:** Fully supports decimal quantities (e.g. `25.50 m²`, `12.75 L`, `0.50 Ton`) with server-authoritative money calculations (`roundMoney`).

---

## 2. Model & Database Schema

### `Customer` Model
- `id`: CUID
- `customerCode`: String (Unique, `CUS-2026-XXXXXX`)
- `name`: String
- `phone`, `alternatePhone`, `email`, `address`, `city`, `country`, `taxNumber`, `notes`
- `active`: Boolean (Default `true`; logical deactivation via `DELETE /api/customers/:id`)

### `SalesOrder` Model
- `id`: CUID
- `salesOrderNumber`: String (Unique, `SO-2026-XXXXXX`)
- `customerId`: String (Foreign Key -> `Customer.id`)
- `customerCodeSnapshot`, `customerNameSnapshot`, `customerPhoneSnapshot`: String
- `warehouseId`: String (Foreign Key -> `Warehouse.id`)
- `status`: Enum (`DRAFT`, `PENDING_APPROVAL`, `APPROVED`, `PROCESSING`, `COMPLETED`, `CANCELLED`)
- `orderDate`: DateTime
- `requestedDeliveryDate`: DateTime?
- `subtotal`, `discount`, `tax`, `total`: Float
- `notes`: String?
- `createdBy`, `approvedBy`, `approvedAt`, `cancelledBy`, `cancelledAt`, `cancellationReason`

### `SalesOrderItem` Model
- `id`: CUID
- `salesOrderId`: String (Foreign Key -> `SalesOrder.id`)
- `productId`: String (Foreign Key -> `Product.id`)
- `productName`, `productSku`, `unitId`, `unitSymbol`: String
- `orderedQuantity`: Float (Decimal UOM)
- `unitPrice`, `discount`, `tax`, `lineTotal`: Float

---

## 3. Centralized Permissions & Role Matrix

Added 12 granular permissions to `lib/auth/permissions.ts`:
- **Customer Permissions:** `CUSTOMER_VIEW`, `CUSTOMER_CREATE`, `CUSTOMER_UPDATE`, `CUSTOMER_DEACTIVATE`
- **Sales Order Permissions:** `SALES_ORDER_VIEW`, `SALES_ORDER_CREATE`, `SALES_ORDER_UPDATE`, `SALES_ORDER_SUBMIT`, `SALES_ORDER_APPROVE`, `SALES_ORDER_CANCEL`, `SALES_ORDER_PROCESS`, `SALES_ORDER_COMPLETE`

| Role | Customer Ops | SO Create/Edit | SO Submit | SO Approve | SO Process/Complete | SO Cancel |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **SUPER_ADMIN** | Full | Full | Full | Full | Full | Full |
| **WAREHOUSE_MANAGER** | Full | Full | Full | Full | Full | Full |
| **STOREKEEPER** | View | Read | Read | No | Full | No |
| **PURCHASING_OFFICER** | View | Read | Read | No | No | No |
| **INVENTORY_OFFICER** | View | Read | Read | No | Read | No |
| **VIEWER** | View | Read | Read | No | Read | No |

---

## 4. REST API Endpoint Registry

| Route | Method | Purpose | Guarded Permission |
| :--- | :--- | :--- | :--- |
| `/api/customers` | GET | List customers (Search & status filter) | `CUSTOMER_VIEW` |
| `/api/customers` | POST | Create customer | `CUSTOMER_CREATE` |
| `/api/customers/:id` | GET | Customer details | `CUSTOMER_VIEW` |
| `/api/customers/:id` | PATCH | Update customer details | `CUSTOMER_UPDATE` |
| `/api/customers/:id` | DELETE | Logical customer deactivation | `CUSTOMER_DEACTIVATE` |
| `/api/customers/:id/sales` | GET | Customer purchasing statistics & history | `CUSTOMER_VIEW` |
| `/api/sales-orders` | GET | List sales orders (Status, Warehouse, Search) | `SALES_ORDER_VIEW` |
| `/api/sales-orders` | POST | Create DRAFT sales order | `SALES_ORDER_CREATE` |
| `/api/sales-orders/:id` | GET | Sales Order detail view | `SALES_ORDER_VIEW` |
| `/api/sales-orders/:id` | PATCH | Update DRAFT sales order | `SALES_ORDER_UPDATE` |
| `/api/sales-orders/:id/submit` | POST | Transition DRAFT -> PENDING_APPROVAL | `SALES_ORDER_SUBMIT` |
| `/api/sales-orders/:id/approve` | POST | Transition PENDING_APPROVAL -> APPROVED | `SALES_ORDER_APPROVE` |
| `/api/sales-orders/:id/start-processing` | POST | Transition APPROVED -> PROCESSING | `SALES_ORDER_PROCESS` |
| `/api/sales-orders/:id/complete` | POST | Transition PROCESSING -> COMPLETED | `SALES_ORDER_COMPLETE` |
| `/api/sales-orders/:id/cancel` | POST | Cancel Sales Order | `SALES_ORDER_CANCEL` |

---

## 5. Operations UI Components & Navigation

1. **Customer Directory (`/customers` & `components/customers/CustomersView.tsx`):**
   - Search by name, customer code, phone, or email.
   - Filter by status (`ACTIVE`, `INACTIVE`, `ALL`).
   - Create Customer modal, Edit Customer modal, and Deactivation dialog.
2. **Customer Detail Profile (`/customers/[id]` & `components/customers/CustomerDetailView.tsx`):**
   - KPI metric cards: Total Orders, Open Orders, Completed Orders, Total Order Value.
   - Profile information & tax number.
   - Historical sales orders list with deep links.
3. **Sales Orders List (`/sales` & `components/sales/SalesOrdersView.tsx`):**
   - Status tab bar (`ALL`, `DRAFT`, `PENDING_APPROVAL`, `APPROVED`, `PROCESSING`, `COMPLETED`, `CANCELLED`).
   - Search by SO Number, Customer Name, or Phone.
   - Fulfillment Warehouse filter.
4. **Sales Order Form Wizard (`/sales/new` & `components/sales/SalesOrderFormView.tsx`):**
   - Customer dropdown (active customers only).
   - Warehouse selector.
   - Product search autocomplete (handles large catalogs).
   - Decimal quantity input, unit price input, UOM unit symbol preview.
   - Subtotal, Order Discount, Order Tax, and Total calculations.
5. **Sales Order Detail View (`/sales/[id]` & `components/sales/SalesOrderDetailView.tsx`):**
   - Order metadata, Customer snapshot, Warehouse details.
   - Line items table & order financial summary.
   - Immutable status guards for approved/terminal orders.
   - Permission-aware action buttons for state transitions.
6. **Operations Dashboard Widget (`components/admin/BuildStockOperationsDashboard.tsx`):**
   - Sales Order Pipeline widget displaying live counts for Draft, Pending, Approved, Processing, and Completed orders.

---

## 6. Critical Step 35 E2E Verification Scenario

A dedicated test suite in `lib/sales/salesOrderService.test.ts` executes the **Step 35 E2E Stock Isolation Scenario**:

```
Initial Stock Allocation: 100 m² (Product: Porcelain Tile, Warehouse: Main WH)
Initial Stock Movements Count: 0

Step 1: Create Sales Order (25 m²)   -> Status: DRAFT              -> Stock Allocation: 100 m², Stock Movements: 0
Step 2: Submit Sales Order           -> Status: PENDING_APPROVAL   -> Stock Allocation: 100 m², Stock Movements: 0
Step 3: Approve Sales Order          -> Status: APPROVED           -> Stock Allocation: 100 m², Stock Movements: 0
Step 4: Start Processing Order       -> Status: PROCESSING         -> Stock Allocation: 100 m², Stock Movements: 0
Step 5: Complete Sales Order         -> Status: COMPLETED          -> Stock Allocation: 100 m², Stock Movements: 0
```

**Verification Result:** `StockAllocation` remains **EXACTLY 100 m²**, `StockLocationAllocation` is **UNCHANGED**, and `StockMovement` count remains **0**.
