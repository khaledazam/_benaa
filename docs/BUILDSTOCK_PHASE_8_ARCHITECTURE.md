# BUILDSTOCK — PHASE 8 ARCHITECTURE GUIDE
## PRODUCTION-GRADE WMS HARDENING & OPERATIONAL INTELLIGENCE

---

## 1. Domain Architecture Model

Phase 8 elevates BuildStock into a fully auditable operational WMS with end-to-end batch traceability, strategy-driven picking, blind cycle counting, and read-only inventory health monitoring:

```
┌──────────────────────────────┐       ┌──────────────────────────────┐       ┌──────────────────────────────┐
│   Product (trackingMode)     │       │     InventoryBatch           │       │    BarcodeScannerInput       │
│   NONE | BATCH | LOT | HEAT  │──────▶│ quantity, reservedQuantity   │◀──────│  Keyboard-Wedge Normalizer   │
└──────────────┬───────────────┘       └──────────────┬───────────────┘       └──────────────────────────────┘
               │                                      │
               ▼                                      ▼
┌──────────────────────────────┐       ┌──────────────────────────────┐       ┌──────────────────────────────┐
│   Blind Counting Engine      │       │   Strategy Picking Engine    │       │   Inventory Health Engine    │
│  OPEN_COUNT vs BLIND_COUNT   │       │  FEFO | FIFO | LOCATION      │       │ READ-ONLY (0-100% Score)     │
└──────────────┬───────────────┘       └──────────────┬───────────────┘       └──────────────┬───────────────┘
               │                                      │                                      │
               └──────────────────────────────────────┴──────────────────────────────────────┘
                                                      │
                                                      ▼
                                   ┌─────────────────────────────────────┐
                                   │  executeStockMutationInTx (SACRED)  │
                                   │  Physical Stock & StockMovements    │
                                   └─────────────────────────────────────┘
```

---

## 2. Invariant & Concurrency Policy

1. **Master Mutation Lock**: All physical stock alterations pass through `executeStockMutationInTx`.
2. **Duplicate Dispatch Locking**: `Dispatch.status` is locked atomically from `DRAFT` to `POSTED` inside `prisma.$transaction` via `updateMany({ where: { id, status: "DRAFT" } })`.
3. **Batch Reserved Quantity Synchronization**: `batch.reservedQuantity` tracks active batch reservations, ensuring `availableBatchStock = physicalBatchStock - activeReservedBatchStock >= 0`.
