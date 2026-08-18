# BUILDSTOCK — BUSINESS GAP ANALYSIS
## WAREHOUSE OPERATIONAL CAPABILITY EVALUATION

---

## 1. Domain Capability Matrix

This gap analysis evaluates real-world operational requirements for construction and decoration material warehouses (tiles, cement, paints, marble, profiles, tools, and hardware).

| Business Capability | Status | Operational Coverage | Classification |
| :--- | :--- | :--- | :--- |
| **Procurement & Goods Receipt** | `READY` | Full PO creation, approval, GRN receiving into bin locations, physical stock addition. | Core Baseline |
| **Warehouse Hierarchy & Bins** | `READY` | Warehouses $\rightarrow$ Zones $\rightarrow$ Racks $\rightarrow$ Shelves $\rightarrow$ Bins with location paths and active flags. | Core Baseline |
| **Sales Orders & Reservations** | `READY` | Order creation, reservation holding floor, available stock calculation ($physical - reserved$). | Core Baseline |
| **Picking & Pick Allocation** | `READY` | Pick list generation, bin allocation, picker assignment, pick completion (0 physical stock deduction). | Core Baseline |
| **Dispatch & Delivery Deductions** | `READY` | Dispatch creation, physical stock deduction exclusively on POST, immutable dispatch records. | Core Baseline |
| **Stock Adjustments & Counts** | `READY` | Multi-scope cycle counts, variance calculation, multi-stage adjustment approvals, atomic posting. | Core Baseline |
| **Inventory Reconciliation** | `READY` | Read-only integrity audit engine detecting unassigned stock, over-reservation, or ledger mismatches. | Core Baseline |
| **Barcode / Scanner Input** | `PARTIAL` | Search inputs support keyboard/wedge scanner input for SKU and Barcode strings. | Enhancements |
| **Batch / Lot & Expiry Tracking** | `PARTIAL` | Expiry adjustments supported; full batch/lot number tracking on bin allocations. | Future Phase 7 |
| **Material Photo Attachments** | `PARTIAL` | ImageKit URL support on Products; photo uploads on GRN or Damage reports. | Future Phase 7 |
| **Driver & Fleet Dispatch Notes** | `PARTIAL` | Dispatch tracking numbers and shipping rates supported via Shippo integration. | Future Phase 7 |

---

## 2. Recommendations for Post-Deployment Enhancements

1. **Hardware Barcode Scanner Integration**: Direct camera scan integration for mobile warehouse tablets.
2. **Batch / Heat Lot Numbering**: For specialty chemical mortars, adhesives, or steel rebar certifications.
3. **Delivery Truck Route Planning**: Grouping dispatches by transport vehicle capacity.
