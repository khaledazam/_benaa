# BUILDSTOCK — REALISTIC PRODUCTION-LIKE DATA SEED
## CONSTRUCTION MATERIALS & MODERN DECORATION WAREHOUSE DATASET

---

## 1. Executive Summary

This document specifies the architecture, entity graph, Egyptian business domain mapping, environment safety policies, operational credentials, and validation rules for the BuildStock realistic data seed engine (`scripts/seed-realistic-data.ts`).

The seed produces a complete, production-grade operational WMS dataset reflecting real-world construction materials (tiles, cement, steel, plumbing, paint, adhesives, sanitary ware) and modern decoration products (marble, granite, wall panels, mosaic, WPC) in Egypt.

---

## 2. Safety & Environment Controls

To protect production database instances from accidental mutation, the seed script enforces two safety environment flags:

```bash
# Permitted execution modes:
SEED_MODE="realistic"
ALLOW_REALISTIC_SEED="true"
```

If neither variable is present, the script immediately aborts with a security violation error:

```
[SAFETY GUARD] Execution rejected: Neither SEED_MODE='realistic' nor ALLOW_REALISTIC_SEED='true' is set.
Refusing to run against database environment without explicit authorization.
```

---

## 3. Operational Development Credentials

The seed generates six operational user accounts covering all BuildStock RBAC roles. All passwords are securely hashed using `bcryptjs` (salt rounds: 10).

| Role | Name | Email | Username | Default Password |
| :--- | :--- | :--- | :--- | :--- |
| **SUPER_ADMIN (Primary)** | Khaled Admin | `khaled@admin.com` | `khaled_admin` | `102003000@` |
| **SUPER_ADMIN** | Eng. Tarek El-Mansoury | `tarek.admin@buildstock-eg.com` | `admin_tarek` | `BuildStock@2026` |
| **WAREHOUSE_MANAGER** | Mahmoud Abdel-Aziz | `mahmoud.wh@buildstock-eg.com` | `wh_mahmoud` | `BuildStock@2026` |
| **STOREKEEPER** | Ahmed Hassan | `ahmed.store@buildstock-eg.com` | `store_ahmed` | `BuildStock@2026` |
| **INVENTORY_OFFICER** | Mohamed Ali | `mohamed.inv@buildstock-eg.com` | `inv_mohamed` | `BuildStock@2026` |
| **PURCHASING_OFFICER** | Omar Mahmoud | `omar.purch@buildstock-eg.com` | `purch_omar` | `BuildStock@2026` |
| **VIEWER** | Youssef Ibrahim | `youssef.view@buildstock-eg.com` | `view_youssef` | `BuildStock@2026` |

---

## 4. Entity Topology & Target Counts

| Entity Domain | Target Count | Key Attributes & Rules |
| :--- | :--- | :--- |
| **Users** | 6 | 6 RBAC roles, hashed passwords, synthetic Egyptian names |
| **Warehouses** | 3 | `MAIN-WH` (Cairo Construction Yard), `DECOR-WH` (Giza Decoration Hub), `BACKUP-WH` (Alexandria Logistics Hub) |
| **Zones** | 8 | TILES, CEMENT, STEEL, PLUMBING, ELECTRICAL, PAINT, SANITARY, DECOR-PANELS |
| **Racks** | 20 | Structured rack numbering per zone (`R-01` to `R-20`) |
| **Shelves** | 40 | Structured shelf numbering per rack (`S-01` to `S-02`) |
| **Bins** | 120+ | Physical bin locations with structured location paths (`Zone / Rack / Shelf / Bin`) |
| **Units & Conversions** | 10 Units, 8 Conversions | PCS, BOX, M2, M3, KG, TON, LITER, METER, ROLL, BAG with verified conversions (1 BOX = 1.44 M2, 1 TON = 1000 KG, 1 BAG = 50 KG) |
| **Categories & Brands** | 16 Categories, 12 Brands | Cleopatra, Ceramica Alfa, Saveto, Suez Cement, Ezz Steel, Jotun, GLC, Ideal Standard, Duravit, Grohe, etc. |
| **Products** | 120 | Full construction & decoration catalog with SKUs, barcodes, min/max thresholds, tracking modes (`NONE`, `BATCH`, `LOT`, `HEAT`) |
| **Suppliers** | 20 | Egyptian building material suppliers with codes, phones, and emails |
| **Purchase Orders** | 25 | `DRAFT`, `PENDING_APPROVAL`, `APPROVED`, `PARTIALLY_RECEIVED`, `FULLY_RECEIVED`, `CANCELLED` |
| **Goods Receipts** | 18 | Draft and Posted GRNs populating physical stock & batches strictly via `executeStockMutationInTx` |
| **Inventory Batches** | 35 | Active, near-expiry, and expired batches with manufacture/expiry dates and tracking numbers |
| **Customers** | 40 | Contractors, real estate developers, interior designers, retail customers across Egypt |
| **Sales Orders** | 35 | `DRAFT`, `PENDING_APPROVAL`, `APPROVED`, `PROCESSING`, `COMPLETED`, `CANCELLED` |
| **Stock Reservations** | 22 | `ACTIVE`, `PARTIALLY_FULFILLED`, `FULFILLED`, `RELEASED`, `CANCELLED` syncing batch reserved stock |
| **Pick Lists** | 18 | `FEFO`, `FIFO`, `LOCATION_PATH` strategy picking lists across multiple bins |
| **Dispatches** | 15 | Draft & Posted dispatches with delivery metadata (`driverName`, `vehicleNumber`, `deliveryAddress`), deducting physical stock strictly on POST |
| **Inventory Counts** | 6 | `OPEN_COUNT` & `BLIND_COUNT` sessions across warehouses, zones, and bins |
| **Stock Adjustments** | 8 | Posted `DAMAGE`, `LOSS`, `FOUND`, and `CORRECTION` adjustments |
| **Audit Logs** | 100+ | System action log history generated naturally during service execution |

---

## 5. Execution & Reset Instructions

```powershell
# 1. Execute Realistic Seeding:
$env:ALLOW_REALISTIC_SEED="true"
npx tsx scripts/seed-realistic-data.ts

# 2. Run Seed Validation Audit:
npx tsx scripts/validate-realistic-seed.ts
```
