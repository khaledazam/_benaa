# BUILDSTOCK — PHASE 7 TECHNICAL IMPLEMENTATION DOCUMENTATION

---

## 1. Overview of Phase 7 Modules

1. **`lib/inventory/barcodeService.ts`**:
   - `lookupProductByBarcode(rawBarcode, warehouseIdFilter)`: Fast barcode, SKU, and ID lookups for keyboard-wedge scanners.
2. **`lib/inventory/batchService.ts`**:
   - `generateBatchNumber()`: `BAT-YYYYMMDD-XXXX`.
   - `createOrUpdateBatchOnReceiptInTx()`: Atomic batch stock creation during GRN POST.
   - `deductBatchQuantityInTx()`: Atomic batch stock deduction during Dispatch POST.
   - `getBatchSuggestions()`: FEFO (Expiry Date ASC) and FIFO (Creation Date ASC) batch selection.
   - `getInventoryBatches()`: Paginated query API handler.
3. **`lib/dispatch/dispatchService.ts`**:
   - `updateDeliveryStatus(dispatchId, deliveryStatus, deliveryData, userId)`: Updates `deliveryStatus` (`POSTED`, `OUT_FOR_DELIVERY`, `DELIVERED`, `CANCELLED`), driver name, vehicle, address, and notes with 0 stock mutation.
4. **`lib/inventory/reconciliationService.ts`**:
   - Extended read-only audit engine for batch vs physical stock, expired active batches, and negative batch quantities.

---

## 2. API Endpoints

- `GET /api/products/barcode/[barcode]`
- `GET /api/inventory/batches`
- `GET /api/inventory/batches/suggestions`
- `POST /api/dispatches/[id]/delivery`
