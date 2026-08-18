# BUILDSTOCK — Procurement & Goods Receipt Architecture

> **Document:** BuildStock Procurement Architecture Specification
> **Phase:** Phase 2
> **Date:** 2026-08-13

---

## 1. Audit of Existing Order System & Architectural Decision

### Existing Order Model Assessment
The current `Order` and `OrderItem` models in BuildStock are strictly **outbound/sales-oriented**:
- Linked to clients/customers (`clientId`, `billingAddress`, `shippingAddress`).
- Linked to outbound shipping tracking (`trackingNumber`, `trackingCarrier`, Shippo metadata).
- Tied 1-to-1 with sales `Invoice`.
- Lacks inbound supplier tracking, vendor terms, receiving notes, or partial delivery tracking.

### Decision: Dedicated Purchase Order & Goods Receipt Domain
Forcing inbound procurement into the outbound sales `Order` model would violate single-responsibility principles and create invalid state transitions.

Therefore, BuildStock Phase 2 implements a **dedicated procurement & goods receiving architecture**:

```
Supplier
   ↓
PurchaseOrder (PO-YYYY-XXXXXX)
   ↓
[Approval Workflow: DRAFT → PENDING_APPROVAL → APPROVED]
   ↓
GoodsReceipt (GRN-YYYY-XXXXXX) [DRAFT → POSTED]
   ↓ (Atomic Prisma Transaction)
   ├── StockAllocation (warehouse stock update)
   ├── StockMovement (PURCHASE ledger entry)
   ├── PurchaseOrderItem (receivedQuantity & remainingQuantity update)
   ├── PurchaseOrder (status update: PARTIALLY_RECEIVED / FULLY_RECEIVED)
   └── AuditLog (procurement action recorded)
```

---

## 2. Reused Architecture from Phase 1

- **Stock Movement Ledger:** Goods Receipts generate `PURCHASE` type stock movements via `/lib/inventory/stockService.ts`.
- **Unit of Measure System:** Quantities are converted to product base units using `Unit` and `UnitConversion`.
- **Decimal Quantities:** All quantities (`orderedQuantity`, `receivedQuantity`, `remainingQuantity`) use `Float` precision.
- **Centralized Authorization:** Authorization checks enforce procurement permissions via `/lib/auth/requireRole.ts` and `/lib/auth/permissions.ts`.
- **Audit Logging:** Procurement lifecycle actions recorded using `createAuditLog`.

---

## 3. Data Models Overview

### 3.1 PurchaseOrder
- `id`: ObjectId
- `purchaseOrderNumber`: String (unique, e.g. `PO-2026-000001`)
- `supplierId`: ObjectId (ref to Supplier)
- `warehouseId`: ObjectId (destination warehouse)
- `status`: String (`DRAFT` | `PENDING_APPROVAL` | `APPROVED` | `PARTIALLY_RECEIVED` | `FULLY_RECEIVED` | `CANCELLED` | `CLOSED`)
- `orderDate`: DateTime
- `expectedDeliveryDate`: DateTime (optional)
- `subtotal`: Float
- `tax`: Float (optional)
- `discount`: Float (optional)
- `total`: Float
- `notes`: String (optional)
- `createdBy`: ObjectId (ref to User)
- `approvedBy`: ObjectId (ref to User, optional)
- `approvedAt`: DateTime (optional)
- `cancelledBy`: ObjectId (ref to User, optional)
- `cancelledAt`: DateTime (optional)
- `cancellationReason`: String (optional)
- `createdAt`: DateTime
- `updatedAt`: DateTime

### 3.2 PurchaseOrderItem
- `id`: ObjectId
- `purchaseOrderId`: ObjectId (ref to PurchaseOrder)
- `productId`: ObjectId (ref to Product)
- `productName`: String (snapshot)
- `productSku`: String (snapshot)
- `unitId`: ObjectId (ref to Unit)
- `orderedQuantity`: Float
- `receivedQuantity`: Float (default 0)
- `remainingQuantity`: Float (orderedQuantity - receivedQuantity)
- `unitPrice`: Float
- `discount`: Float (optional)
- `tax`: Float (optional)
- `lineTotal`: Float

### 3.3 GoodsReceipt
- `id`: ObjectId
- `receiptNumber`: String (unique, e.g. `GRN-2026-000001`)
- `purchaseOrderId`: ObjectId (ref to PurchaseOrder)
- `supplierId`: ObjectId (ref to Supplier)
- `warehouseId`: ObjectId (destination warehouse)
- `status`: String (`DRAFT` | `POSTED` | `CANCELLED`)
- `notes`: String (optional)
- `receivedBy`: ObjectId (ref to User)
- `receivedAt`: DateTime
- `postedAt`: DateTime (optional)
- `createdAt`: DateTime
- `updatedAt`: DateTime

### 3.4 GoodsReceiptItem
- `id`: ObjectId
- `goodsReceiptId`: ObjectId (ref to GoodsReceipt)
- `purchaseOrderItemId`: ObjectId (ref to PurchaseOrderItem)
- `productId`: ObjectId (ref to Product)
- `receivedQuantity`: Float
- `unitId`: ObjectId (ref to Unit)
- `quantityInBaseUnit`: Float
- `notes`: String (optional)

---

## 4. Business Rules & Security Matrix

1. **PO Status Lifecycle:**
   `DRAFT` → `PENDING_APPROVAL` → `APPROVED` → `PARTIALLY_RECEIVED` → `FULLY_RECEIVED` / `CANCELLED`
2. **Receiving Rules:**
   - Goods Receipts can ONLY be created for `APPROVED` or `PARTIALLY_RECEIVED` Purchase Orders.
   - Over-receiving is strictly prohibited: `receivedQuantity` per line item cannot exceed `remainingQuantity`. If an attempt exceeds remaining quantity, the entire transaction is rejected.
   - Receiving into a warehouse automatically updates `StockAllocation` for that warehouse and creates a `PURCHASE` `StockMovement`.
3. **Immutability:**
   - Posted Goods Receipts (`POSTED`) are immutable.
   - Fully received Purchase Orders (`FULLY_RECEIVED`) cannot be cancelled or re-received.
