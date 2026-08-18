# BUILDSTOCK — INVENTORY CONTROL & CYCLE COUNTING MANUAL
## OPERATIONAL GUIDE FOR WAREHOUSE MANAGERS & STOREKEEPERS

---

## 1. Overview & Policy

BuildStock provides enterprise-grade inventory control mechanisms designed specifically for construction materials and modern decoration warehouses.

Key Governance Principles:
- **No Direct Inventory Alteration**: Storekeepers and operational staff cannot manually overwrite physical stock counts without a formal audit trail.
- **Segregation of Duties**:
  - `STOREKEEPER` / `INVENTORY_OFFICER`: Can create draft adjustments, start count sheets, and record counted physical quantities.
  - `WAREHOUSE_MANAGER` / `SUPER_ADMIN`: Can approve count sheets and perform final authorized physical posting.
- **Audit Ledger Transparency**: Every physical correction creates an immutable `StockMovement` entry referencing the exact `StockAdjustment` or `InventoryCount` record.

---

## 2. Stock Adjustment Types

| Adjustment Type | Delta Symbol | Operational Purpose |
| :--- | :--- | :--- |
| **`ADJUSTMENT_IN`** | $+$ | Found inventory, unrecorded stock arrival, positive count correction. |
| **`ADJUSTMENT_OUT`** | $-$ | Unrecorded stock issue, general negative count correction. |
| **`DAMAGE`** | $-$ | Materials damaged during warehouse handling or transport. |
| **`LOSS`** | $-$ | Unexplained inventory loss, theft, or shrinkage. |
| **`EXPIRY`** | $-$ | Chemical adhesives, paints, or mortar materials exceeding shelf life. |
| **`FOUND`** | $+$ | Previously lost or mislaid stock recovered during bin cleaning. |
| **`CORRECTION`** | $\pm$ | General count correction generated automatically from cycle count sheets. |

---

## 3. Inventory Counting Workflows

### Cycle Count Scope Options
1. **Full Warehouse Count**: Audits all stock allocations across every active bin in a warehouse.
2. **Bin Count**: Audits specific high-traffic or bulk storage bin locations.
3. **Product Count**: Audits high-value or fast-moving construction SKUs (e.g. ceramic tiles, marble slabs, timber).
4. **Category Count**: Focuses on specific product categories.
5. **Low Stock Audit**: Targets items at or below minimum reorder thresholds.

### Variance Formula
$$\text{varianceQuantity} = \text{countedQuantity} - \text{systemQuantity}$$
$$\text{variancePercentage} = \begin{cases} \left(\frac{\text{varianceQuantity}}{\text{systemQuantity}}\right) \times 100 & \text{if } \text{systemQuantity} > 0 \\ 100\% & \text{if } \text{systemQuantity} = 0 \text{ and } \text{countedQuantity} > 0 \\ 0\% & \text{otherwise} \end{cases}$$

---

## 4. Reports & Audit Trail

Warehouse managers can monitor inventory health via `/inventory/reports`:
- **Inventory Variance & Accuracy**: Monitors cycle count accuracy percentage and discrepancy unit trends.
- **Adjustment History Audit**: Full auditable log of all posted adjustments with creator and approver stamps.
- **Damage & Loss Analysis**: Tracks material degradation, expiry, and loss by warehouse and date range.
