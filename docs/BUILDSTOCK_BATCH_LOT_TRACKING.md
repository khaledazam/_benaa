# BUILDSTOCK — BATCH, LOT & HEAT TRACKING MANUAL
## MATERIAL TRACEABILITY & FEFO/FIFO SELECTION POLICY

---

## 1. Tracking Modes

BuildStock supports four distinct tracking modes configurable per product:

| Tracking Mode | Industry Use Case | Tracked Identifiers | Expiry Policy |
| :--- | :--- | :--- | :--- |
| **`NONE`** | General hardware, tools, fittings | SKU / Barcode | N/A |
| **`BATCH`** | Cement bags, paints, adhesives, tile production runs | `batchNumber`, `manufactureDate`, `expiryDate` | FEFO (First Expiring, First Out) |
| **`LOT`** | Plasterboards, gypsum, insulation rolls | `lotNumber`, `batchNumber` | FIFO (First In, First Out) |
| **`HEAT`** | Structural steel rebar, pipes, metallurgical beams | `heatNumber`, Mill Test Certification | FIFO (First In, First Out) |

---

## 2. Batch Lifecycle & Stock Flow

1. **Receipt (`PURCHASE`)**:
   - Posting a Goods Receipt automatically creates or increments an `InventoryBatch` record when `trackingMode != NONE`.
2. **Picking (`LOGICAL ALLOCATION`)**:
   - Pickers receive FEFO/FIFO batch suggestions via `GET /api/inventory/batches/suggestions`.
   - Batch selection does NOT physically deduct stock during picking.
3. **Dispatch (`SALE`)**:
   - Posting a Dispatch deducts batch quantity inside the transaction (`deductBatchQuantityInTx`), recording the `batchId` on the `StockMovement` ledger entry.
