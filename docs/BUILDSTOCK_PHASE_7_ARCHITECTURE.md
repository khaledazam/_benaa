# BUILDSTOCK — PHASE 7 SYSTEM ARCHITECTURE GUIDE
## BARCODE OPERATIONS, BATCH/LOT TRACKING & DISPATCH ENHANCEMENTS

---

## 1. Domain Architecture Model

Phase 7 introduces enterprise-grade barcode operations, multi-mode batch/lot/heat tracking, FEFO/FIFO suggestions, and dispatch delivery status tracking:

```
                                  ┌───────────────────────────────┐
                                  │   Product (trackingMode)      │
                                  │   NONE | BATCH | LOT | HEAT   │
                                  └───────────────┬───────────────┘
                                                  │
                                                  ▼
                                  ┌───────────────────────────────┐
                                  │       InventoryBatch          │
                                  │ batchNumber, expiryDate, qty  │
                                  └───────────────┬───────────────┘
                                                  │
            ┌─────────────────────────────────────┼─────────────────────────────────────┐
            │                                     │                                     │
            ▼                                     ▼                                     ▼
┌───────────────────────┐             ┌───────────────────────┐             ┌───────────────────────┐
│   Goods Receipt POST  │             │   FEFO / FIFO Engine  │             │    Dispatch POST      │
│  createOrUpdateBatch  │             │  getBatchSuggestions  │             │  deductBatchQuantity  │
└───────────┬───────────┘             └───────────────────────┘             └───────────┬───────────┘
            │                                                                           │
            └─────────────────────────────────────┬─────────────────────────────────────┘
                                                  │
                                                  ▼
                                ┌───────────────────────────────────┐
                                │ executeStockMutationInTx (SACRED) │
                                │ StockAllocation & StockMovement   │
                                └───────────────────────────────────┘
```

---

## 2. Master Stock Invariant Preservation

- **Invariant A**: $\text{availableStock} = \text{physicalStock} - \text{activeReservedStock} \ge 0$.
- **Invariant B**: $\sum(\text{batch quantities}) \le \text{physical warehouse stock}$.
- **Invariant C**: Physical stock deduction occurs **EXCLUSIVELY** on authorized `Dispatch POST`. Delivery status changes (`OUT_FOR_DELIVERY`, `DELIVERED`) NEVER alter physical or batch stock.
- **Invariant D**: Goods Receipt `POST` creates batch quantities atomically in the same transaction as physical stock additions.
