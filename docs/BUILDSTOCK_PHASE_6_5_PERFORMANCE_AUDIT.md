# BUILDSTOCK — PHASE 6.5 PERFORMANCE & DATABASE INTEGRITY AUDIT REPORT

---

## 1. Query & Index Optimization

The database schema (`prisma/schema.prisma`) was audited for query efficiency across high-volume operational endpoints:

| Domain / Model | Primary Query Patterns | Index Strategy Applied |
| :--- | :--- | :--- |
| **`StockAllocation`** | `[productId, warehouseId]` lookups | Unique compound index `@@unique([productId, warehouseId])` |
| **`StockLocationAllocation`** | `[productId, binId]` & `warehouseId` scans | Compound indexes `@@unique([productId, binId])` & `@@index([warehouseId])` |
| **`StockMovement`** | Ledger history filter by `productId`, `warehouseId`, `movementType` | Multi-column index `@@index([productId, warehouseId, createdAt])` |
| **`StockAdjustment`** | Directory filter by `warehouseId`, `status`, `adjustmentType` | Index `@@index([warehouseId, status])` |
| **`InventoryCount`** | Directory filter by `warehouseId`, `status`, `scopeType` | Index `@@index([warehouseId, status])` |

---

## 2. Large Dataset Scalability Assumptions

- **10,000 Products & 100,000 Movements**: Stock movement queries use pagination (`page`, `limit`) and explicit field selections (`select`) to prevent returning excessive payload bytes.
- **Reconciliation Engine**: Reconciliation performs read-only aggregates (`groupBy` & indexed compound lookups) without placing lock contention on transactional stock operations.

---

## 3. Database Referential Integrity & Deletion Guards

- **Historical Integrity**: Destructive deletes on `Product`, `Warehouse`, `WarehouseBin`, `GoodsReceipt`, `Dispatch`, or `StockAdjustment` are blocked when linked inventory ledger history exists.
- **Soft Deletion / Deactivation**: Locations support `active: false` toggles to safely prevent stock placement without wiping transaction history.
