# BUILDSTOCK — Warehouse Location Hierarchy & Inventory Architecture

> **Document:** BuildStock Location Architecture Specification
> **Phase:** Phase 3 — Location Hierarchy & Physical Inventory Organization
> **Date:** 2026-08-13

---

## 1. Audit of Current Stock Architecture

| Question | Current Implementation |
|---|---|
| **1. Is `StockAllocation` product + warehouse?** | Yes. `StockAllocation` has `@unique([productId, warehouseId])` as the primary warehouse-level inventory boundary. |
| **2. Is there already any location concept?** | No. Stock is currently tracked at warehouse granularity only. |
| **3. Can one product have multiple `StockAllocation` records?** | Yes, across different warehouses (one allocation record per warehouse per product). |
| **4. How are stock movements linked to warehouse?** | `StockMovement` contains `productId`, `warehouseId`, `movementType`, `previousStock`, `newStock`, `referenceType`, `referenceId`. |
| **5. How does Goods Receipt select destination?** | `GoodsReceipt` inherits `warehouseId` directly from its parent `PurchaseOrder`. |
| **6. How does `StockTransfer` identify source/destination?** | `StockTransfer` has `fromWarehouseId` and `toWarehouseId` for inter-warehouse transfers. |

---

## 2. Location Hierarchy Architecture

BuildStock implements a 5-tier location hierarchy within each warehouse:

```
Warehouse (Primary Boundary)
   ↓
WarehouseZone (e.g. "TILES", "PAINTS", "LUMBER")
   ↓
WarehouseRack (e.g. "R-01", "R-02")
   ↓
WarehouseShelf (e.g. "S-01", "S-02")
   ↓
WarehouseBin (e.g. "B-01", "B-02")
```

### Hierarchy Traceability & Parent Invariant
Every `WarehouseBin` traces back through `Shelf -> Rack -> Zone -> Warehouse`.
A Bin belongs to **exactly one** Warehouse.

### Human-Readable Location Path
Example: `MAIN-WH / TILES / R-01 / S-02 / B-05`  
Generated dynamically or denormalized on `WarehouseBin` (`locationPath`) for high-performance UI display and search indexing.

---

## 3. Physical Inventory Model: `StockLocationAllocation`

To support a product existing across multiple bins in the same warehouse, BuildStock introduces `StockLocationAllocation`:

- `id`: ObjectId
- `productId`: ObjectId (ref to Product)
- `warehouseId`: ObjectId (ref to Warehouse)
- `binId`: ObjectId (ref to WarehouseBin)
- `quantity`: Float (location stock)
- `unitId`: ObjectId (optional ref to Unit)
- `quantityInBaseUnit`: Float
- `createdAt`, `updatedAt`

### Unassigned Stock Strategy (Existing Stock Compatibility)
Existing warehouse stock (`StockAllocation.quantity`) is preserved without generating dummy bins.
- **Assigned Bin Stock:** Sum of all `StockLocationAllocation` records for `(productId, warehouseId)`.
- **Unassigned Warehouse Stock:** `StockAllocation.quantity - Sum(StockLocationAllocation.quantity)`.
- **Stock Invariant:**  
  `Sum(Bin Allocations) + Unassigned Stock = Total Warehouse StockAllocation`.

---

## 4. Bin Relocation vs. Inter-Warehouse Transfer

BuildStock distinguishes between two distinct operations:

1. **Bin Relocation (Intra-Warehouse):**
   - Source Bin `B-01` -> Destination Bin `B-02` inside the **SAME** warehouse.
   - Movement Type: `RELOCATION`.
   - **Warehouse total stock remains UNCHANGED.**
2. **Stock Transfer (Inter-Warehouse):**
   - Source Warehouse `WH-A` (Bin `B-01`) -> Destination Warehouse `WH-B` (Bin `B-05`).
   - Movement Types: `TRANSFER_OUT` from `WH-A` and `TRANSFER_IN` to `WH-B`.

---

## 5. Goods Receipt & Location Integration

When posting a `GoodsReceipt`:
- `GoodsReceiptItem` optionally specifies `destinationBinId`.
- Validation verifies that `destinationBinId` belongs to the PO's destination `warehouseId`.
- Upon posting:
  1. Updates or creates `StockLocationAllocation` for `destinationBinId`.
  2. Updates overall `StockAllocation` for the warehouse.
  3. Creates `PURCHASE` `StockMovement` containing `destinationBinId`.
