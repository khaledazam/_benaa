# BUILDSTOCK — PHASE 8 IMPLEMENTATION DOCUMENTATION

---

## 1. Primary Service & Module Enhancements

1. **`lib/inventory/batchService.ts`**:
   - `validateProductTrackingModeInTx()`: Server-side validation enforcing `NONE`, `BATCH`, `LOT`, and `HEAT` rules.
   - `reserveBatchQuantityInTx()`: Increments `batch.reservedQuantity` during reservation.
   - `releaseBatchReservationInTx()`: Decrements `batch.reservedQuantity` on release or cancellation.
2. **`lib/picking/pickingService.ts`**:
   - `getStrategyPickingSuggestions()`: Strategy-driven engine supporting `FEFO`, `FIFO`, `LOCATION_PATH`, and `MANUAL`.
3. **`components/shared/BarcodeScannerInput.tsx`**:
   - Keyboard-wedge component handling `CR`/`LF` normalization, debouncing, loading feedback, and duplicate scan guards.
4. **`lib/inventory/countingService.ts`**:
   - Supported `OPEN_COUNT` vs `BLIND_COUNT`. Masked system quantities for non-managers when `countMode === "BLIND_COUNT"`.
5. **`lib/inventory/healthService.ts` & `/inventory/health`**:
   - Computed WMS health score (0-100%) and detected negative stock, bin overruns, batch overruns, and expired active batches.

---

## 2. New REST Endpoints

- `GET /api/inventory/health`
- `GET /api/products/barcode/[barcode]`
- `GET /api/inventory/batches`
- `GET /api/inventory/batches/suggestions`
- `POST /api/dispatches/[id]/delivery`
