# BUILDSTOCK — Feature Matrix

> Classification of every existing feature into: KEEP / MODIFY / REMOVE / REBUILD / FUTURE
> Audit date: 2026-08-13

---

## Classification Legend

| Code | Meaning |
|---|---|
| **KEEP** | Feature is useful and should remain as-is |
| **MODIFY** | Feature is useful but must be adapted for BuildStock |
| **REMOVE** | Feature is unnecessary for the initial BuildStock scope |
| **REBUILD** | Feature exists but its architecture/business logic is not suitable |
| **FUTURE** | Should remain possible but not implemented now |

---

## Authentication & Authorization

| Feature | Classification | Reason |
|---|---|---|
| JWT-based login | KEEP | Solid custom implementation; works well |
| Password registration | KEEP | Required for internal staff accounts |
| Google OAuth login | KEEP | Useful for admin convenience |
| Role-based access (admin/user/supplier) | MODIFY | Expand roles: add Storekeeper, Purchasing Officer, Inventory Officer |
| Client portal role | FUTURE | Not needed in B2B WMS initially |
| Supplier portal role | MODIFY | Keep but tie to purchase orders, not product reviews |
| Inline role checks per API handler | MODIFY | Must be centralized into a shared `requireRole()` helper |
| `Permission` model (stub) | REBUILD | Document the model; implement properly when fine-grained RBAC is needed |
| `middleware/authMiddleware.ts` | REMOVE | Dead code — legacy Pages Router API; delete safely |
| next-auth beta dependency | REMOVE | Unused; only custom JWT is used; creates confusion |

---

## User Management

| Feature | Classification | Reason |
|---|---|---|
| Admin user list / management | KEEP | Required for BuildStock |
| User profile edit | KEEP | Required |
| Email preferences per user | MODIFY | Keep structure; update notification types for construction WMS |
| Username uniqueness | KEEP | Useful |
| Demo seed accounts | REMOVE | Replace with BuildStock-specific seed data |

---

## Product Catalog

| Feature | Classification | Reason |
|---|---|---|
| Product CRUD (create/read/update/delete) | MODIFY | Core feature; must add brand, unit, barcode, min/max stock |
| SKU management | KEEP | Core; already unique |
| Product image upload (ImageKit) | KEEP | Core; good implementation |
| QR code generation per product | KEEP | Very useful for physical warehouse scanning |
| Single category per product | MODIFY | Add subcategory support |
| Single supplier per product | KEEP | Keep; multiple suppliers is future |
| Product soft delete | KEEP | Good pattern; prevents data loss when orders reference product |
| Expiration date per product | MODIFY | Useful for perishable materials (adhesives, sealants) |
| Bulk import (CSV/Excel) | KEEP | Essential for large catalogs |
| Import history log | KEEP | Good auditing feature |
| Product status (Available/Low/Out) | MODIFY | Keep concept; make threshold configurable, not hardcoded at 20 |
| Product price (single) | REBUILD | Need purchase price + retail price + wholesale price |
| Product quantity (global BigInt) | MODIFY | Keep BigInt; add Float support for UOM (liters, m2, kg) |
| Unit of measure | REBUILD | Does not exist — must be built |
| Brand field | REBUILD | Does not exist — must be built |
| Barcode field | REBUILD | Does not exist — must be built |
| Product dimensions / weight | FUTURE | Useful but not critical for initial launch |
| Product variants (color, size, material) | FUTURE | Complex; defer |
| Product reviews / ratings | REMOVE | B2B WMS does not use consumer reviews |

---

## Category Management

| Feature | Classification | Reason |
|---|---|---|
| Category CRUD | KEEP | Core |
| Category status (active/inactive) | KEEP | Core |
| Category description/notes | KEEP | Useful |
| Subcategory support | REBUILD | Not implemented; needed for construction material taxonomy (Tiles > Porcelain Tiles) |

---

## Supplier Management

| Feature | Classification | Reason |
|---|---|---|
| Supplier CRUD | KEEP | Core |
| Supplier status | KEEP | Core |
| Supplier description/notes | KEEP | Useful |
| Supplier contact info (phone, email) | REBUILD | Does not exist — must be built |
| Supplier address | REBUILD | Does not exist — must be built |
| Supplier tax ID / commercial registration | FUTURE | Needed for invoicing/compliance |
| Supplier payment terms | FUTURE | Needed for purchase orders |
| Supplier portal (suppliers log in) | MODIFY | Keep; adapt to purchase order visibility |
| Supplier-linked products | KEEP | Core filtering feature |

---

## Warehouse Management

| Feature | Classification | Reason |
|---|---|---|
| Warehouse CRUD | KEEP | Core |
| Warehouse status (active/inactive) | KEEP | Core |
| Warehouse type (main/secondary/storage) | KEEP | Useful metadata |
| Warehouse address | KEEP | Useful |
| Per-warehouse stock (StockAllocation) | KEEP | Core architecture |
| Delete guards (cannot delete warehouse with stock) | KEEP | Critical safety rule |
| Warehouse Zone/Rack/Shelf/Bin hierarchy | FUTURE | Design it now; implement in Phase 2 |
| Warehouse-specific reports | MODIFY | Keep; update KPIs for construction WMS |

---

## Inventory / Stock

| Feature | Classification | Reason |
|---|---|---|
| Per-warehouse stock allocation | KEEP | Core architecture |
| Stock reservation (pending orders) | KEEP | Core; prevents overselling |
| Stock transfer between warehouses | KEEP | Core for multi-warehouse operations |
| Quantity reconcile (Product vs Allocation sum) | KEEP | Critical safety mechanism |
| Stock low / out notifications (email) | KEEP | Core alerting |
| Stock movement ledger (history) | REBUILD | Does NOT exist — must be built as StockMovement model |
| Stock adjustment (manual correction) | REBUILD | Does NOT exist as a proper operation — must be built |
| Stock count / physical count | FUTURE | Needed for audit; design in Phase 0 |
| Opening balance entry | FUTURE | Needed for go-live migration |
| Unit conversions (m2, kg, liter) | FUTURE | Design now; implement in Phase 2 |
| Low stock threshold configurable per product | MODIFY | Currently hardcoded at 20; must be per-product field |

---

## Orders (Sales)

| Feature | Classification | Reason |
|---|---|---|
| Sales order CRUD | MODIFY | Keep but decouple from Stripe/Shippo |
| Order status workflow | MODIFY | Keep; simplify statuses to WMS-relevant: pending → confirmed → dispatched → completed |
| Order line items (products) | KEEP | Core |
| Warehouse selection per order line | KEEP | REQ-0068 — important for multi-warehouse |
| Order stock reservation | KEEP | Core |
| Order cancellation (release stock) | KEEP | Core |
| Client-linked orders | FUTURE | Once client portal is rebuilt |
| Shippo shipping integration | REMOVE | Not applicable for local warehouse management |
| Stripe payment integration | REMOVE | Not applicable for B2B WMS |
| Shipping address / billing address | MODIFY | Keep structure; rename to delivery address for B2B |
| Tracking number (manual entry) | FUTURE | If self-delivery tracking is needed |

---

## Purchase Orders (Inbound)

| Feature | Classification | Reason |
|---|---|---|
| Purchase order from supplier | REBUILD | Does NOT exist — critical for construction WMS |
| Goods receipt (confirm delivery) | REBUILD | Does NOT exist — must be built with Phase 1 |
| Purchase order invoice from supplier | REBUILD | Does NOT exist — different from sales invoice |
| Purchase order to stock movement | REBUILD | Does NOT exist — must generate PURCHASE stock movement |

---

## Invoices

| Feature | Classification | Reason |
|---|---|---|
| Sales invoice CRUD | MODIFY | Keep; decouple from Stripe |
| Invoice number generation | KEEP | Core |
| Invoice status workflow (draft/sent/paid/overdue/cancelled) | KEEP | Core |
| Partial payment tracking (amountPaid/amountDue) | KEEP | Important for B2B |
| Invoice PDF generation | KEEP | Essential |
| Invoice email send (Brevo) | KEEP | Core |
| Invoice due date reminders | KEEP | Core |
| Stripe payment link in invoice | REMOVE | Not applicable |
| One-to-one Order-Invoice relationship | MODIFY | Loosen; allow invoices without orders (e.g., purchase invoices) |

---

## Notifications

| Feature | Classification | Reason |
|---|---|---|
| In-app notifications | KEEP | Core |
| Email notifications (Brevo) | KEEP | Core |
| Low stock email alerts | KEEP | Core |
| Order status email notifications | MODIFY | Simplify for WMS context |
| Invoice email notifications | KEEP | Core |
| Email preferences per user | KEEP | Core |
| Email queue (QStash) | KEEP | Good background job pattern |

---

## Audit Logging

| Feature | Classification | Reason |
|---|---|---|
| AuditLog model | KEEP | Core — must be expanded |
| Audit on product create/update/delete | KEEP | Core |
| Audit on order operations | KEEP | Core |
| Audit on user management | KEEP | Core |
| Audit on stock movements | REBUILD | Not yet auditing stock changes — critical gap |
| Activity history page | KEEP | Useful for admins |

---

## Analytics / Reporting

| Feature | Classification | Reason |
|---|---|---|
| Business insights dashboard | MODIFY | Keep; add BuildStock-specific KPIs |
| Per-warehouse stock report | MODIFY | Keep; add unit-aware quantities |
| Product movement report | MODIFY | Keep; needs StockMovement backing |
| Revenue analytics | MODIFY | Keep; adapt to construction WMS context |
| PDF/Excel export | KEEP | Essential |
| AI-generated insights | FUTURE | Keep code; defer enablement |
| Demand forecasting | FUTURE | Keep code; defer enablement |

---

## System Configuration

| Feature | Classification | Reason |
|---|---|---|
| SystemConfig model (key-value store) | KEEP | Core |
| Admin settings page | KEEP | Core |
| Company name setting | MODIFY | Update to BuildStock |
| Low stock threshold setting | MODIFY | Make it per-product (not global) |
| Email settings | KEEP | Core |

---

## Portals

| Feature | Classification | Reason |
|---|---|---|
| Supplier portal (suppliers log in) | MODIFY | Keep; adapt to purchase orders and delivery confirmations |
| Client portal (clients place orders) | FUTURE | Not needed for initial internal WMS |
| Client product reviews | REMOVE | Not applicable |
| Client order history | FUTURE | With client portal |

---

## Support Tickets

| Feature | Classification | Reason |
|---|---|---|
| Support ticket system | KEEP | Useful for internal staff issue tracking |
| Support ticket replies | KEEP | Useful |
| Priority levels | KEEP | Useful |

---

## Infrastructure / DevOps

| Feature | Classification | Reason |
|---|---|---|
| Redis caching | KEEP | Core for performance |
| Rate limiting | KEEP | Core for security |
| Sentry error monitoring | KEEP | Core |
| OpenAPI / Swagger docs | KEEP | Core for API documentation |
| Health check endpoint | KEEP | Core |
| Performance tracking wrapper | FUTURE | Good pattern; enable when stable |
| Vercel deployment config | OPTIONAL | Keep if deploying to Vercel |

---

## Branding / UI

| Feature | Classification | Reason |
|---|---|---|
| "Stockly" branding in layout.tsx | REMOVE | Replace with "BuildStock" |
| "Stockly" in metadata/SEO tags | REMOVE | Replace with BuildStock |
| Geist + Poppins fonts | KEEP | Good modern typography |
| Dark mode / theme switching | KEEP | Good UX feature |
| Responsive layout | KEEP | Core |
| LTR-only HTML lang="en" | MODIFY | Plan for RTL (Arabic) in layout |

---

## Summary Count

| Classification | Count |
|---|---|
| KEEP | 52 |
| MODIFY | 24 |
| REMOVE | 12 |
| REBUILD | 10 |
| FUTURE | 17 |
