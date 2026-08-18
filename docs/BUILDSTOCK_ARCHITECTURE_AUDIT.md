# BUILDSTOCK — Full Architecture Audit

> **Original system:** "Stockly" — Generic Warehouse & Stock Inventory Management System
> **Target system:** BuildStock — Construction Materials & Modern Decoration Warehouse Management System
> **Audit date:** 2026-08-13

---

## 1. Current Architecture Overview

| Layer | Technology | Version |
|---|---|---|
| Framework | Next.js (App Router) | ^16.0.0 |
| Language | TypeScript | ^5 |
| Database | MongoDB (via Prisma) | MongoDB driver ^4.17.2 |
| ORM | Prisma | ^6.4.1 |
| Auth | Custom JWT + next-auth beta | next-auth ^5.0.0-beta.30 |
| State (server) | React Query (TanStack) | ^5.90.x |
| State (client) | Zustand | ^5.0.1 |
| Styling | Tailwind CSS | ^3.4.17 |
| UI Components | Radix UI + shadcn/ui | — |
| Forms | React Hook Form + Zod | ^7 + ^3.24 |
| Charts | Recharts | ^3.1.2 |
| Image Storage | ImageKit | ^7.3.0 |
| Email | Brevo (Sendinblue) | API-based |
| Cache/Queue | Upstash Redis + QStash | — |
| Error Monitoring | Sentry | ^10.53.1 |
| Payments | Stripe | ^20.3.0 |
| Shipping | Shippo | ^2.17.4 |
| AI | OpenRouter + Groq | — |
| PDF | jsPDF + jspdf-autotable | ^4 + ^5 |
| Export | ExcelJS + PapaParse | — |
| Testing | Vitest | ^4.1.6 |
| Deployment | Vercel | — |

---

## 2. Frontend Architecture

### Page Structure (`/app` — Next.js App Router)

```
/app
├── layout.tsx                  # Root layout — Providers, Fonts, Metadata ["Stockly" branding]
├── page.tsx                    # Home/landing redirect
├── globals.css                 # Global CSS and Tailwind base
├── login/                      # Login page (JWT + Google OAuth)
├── register/                   # User registration
├── products/                   # Products list + detail
├── warehouses/                 # Warehouses list + detail
├── orders/                     # Orders list + detail
├── invoices/                   # Invoices list + detail
├── categories/                 # Categories list
├── suppliers/                  # Suppliers list (admin)
├── supplier/                   # Supplier self-portal
├── client/                     # Client self-portal
├── settings/                   # User settings (email prefs)
├── support-tickets/            # Support ticket system
├── business-insights/          # Analytics/insights dashboard
├── admin/                      # Admin-only section
│   ├── dashboard-overall-insights/
│   ├── orders/, invoices/, products/, warehouses/
│   ├── suppliers/, categories/, user-management/
│   ├── client-portal/, supplier-portal/
│   ├── product-reviews/, support-tickets/
│   ├── activity-history/, my-activity/
│   ├── personal-invoices/, personal-orders/
│   ├── client-invoices/, client-orders/
│   ├── insights/, settings/
├── api/                        # 31 API Route Handler groups
├── api-docs/                   # OpenAPI/Swagger UI
└── api-status/                 # Health endpoint
```

### Key Frontend Files

| File | Responsibility |
|---|---|
| `app/layout.tsx` | Root layout — providers, metadata, fonts. Branding: **"Stockly"** hardcoded |
| `components/layouts/AdminSidebar.tsx` | Main nav sidebar for admin role |
| `components/layouts/Navbar.tsx` | Top navigation bar (25 KB — complex) |
| `contexts/auth-context.tsx` | Auth context — session, role, user state |
| `lib/react-query/patch-mutation-cache.ts` | Optimistic UI cache patching (56 KB — very complex) |
| `lib/react-query/config.ts` | React Query query definitions (11 KB) |
| `stores/product-store.ts` | Zustand store for product form state |

---

## 3. Backend / API Architecture

### API Route Structure (`/app/api`)

| Endpoint Group | Methods | Notes |
|---|---|---|
| `/api/auth` | login, logout, register, oauth, session | Custom JWT auth |
| `/api/products` | GET, POST, PATCH, DELETE, import, image, qr-code | Full CRUD + image + QR |
| `/api/categories` | GET, POST, PATCH, DELETE | Category CRUD |
| `/api/warehouses` | GET, POST, PATCH, DELETE | Warehouse CRUD |
| `/api/stock-allocations` | GET, POST, PATCH, DELETE | Stock per warehouse |
| `/api/stock-transfers` | GET, POST, PATCH | Transfer between warehouses |
| `/api/orders` | GET, POST, PATCH, DELETE | Order management |
| `/api/invoices` | GET, POST, PATCH | Invoice management |
| `/api/suppliers` | GET, POST, PATCH, DELETE | Supplier management |
| `/api/users` | GET, PATCH | User management (admin) |
| `/api/notifications` | GET, PATCH | In-app notifications |
| `/api/dashboard` | GET | Dashboard aggregated data |
| `/api/ai` | POST | AI insights generation |
| `/api/forecasting` | GET | Demand forecasting |
| `/api/payments` | POST | Stripe payment intent |
| `/api/payments/webhook` | POST | Stripe webhook handler |
| `/api/shipping` | POST, GET | Shippo label/tracking |
| `/api/audit-logs` | GET | Audit log retrieval |
| `/api/product-reviews` | GET, POST, PATCH, DELETE | Product review system |
| `/api/support-tickets` | GET, POST, PATCH | Support ticket system |
| `/api/system-config` | GET, PATCH | Admin system settings |
| `/api/health` | GET | Application health check |

### API Architecture Patterns

- **Authentication:** `getSessionFromRequest()` in every handler — checks JWT cookie
- **Authorization:** Role check inline per handler (NOT centralized)
- **Validation:** Zod schemas in `lib/validations/` — used in most routes
- **Rate Limiting:** `withRateLimit()` — Redis-backed, graceful bypass if Redis down
- **Caching:** Redis `getCache/setCache` + `scheduleAfterResponse()` for lazy invalidation
- **Error Handling:** `logger.ts` + Sentry for unexpected errors; structured JSON errors
- **Audit Logging:** `createAuditLog()` from `prisma/audit-log.ts` — used in major operations

---

## 4. Database Architecture

### Database: MongoDB (via Prisma ODM)

- **Provider:** MongoDB Atlas or local MongoDB
- **Prisma Version:** 6.4.1
- **Schema Location:** `prisma/schema.prisma`

### Models Summary

| Model | Description | Key Fields |
|---|---|---|
| `User` | System users — all roles | email, name, password, role, googleId, emailPreferences |
| `Product` | Inventory items | name, sku, price, quantity, reservedQuantity, categoryId, supplierId, status, imageUrl, expirationDate, deletedAt |
| `Category` | Product categories | name, status, description |
| `Supplier` | Product suppliers | name, status, description |
| `Warehouse` | Physical warehouses | name, address, type, status |
| `StockAllocation` | Per-warehouse product quantity | productId, warehouseId, quantity, reservedQuantity |
| `StockTransfer` | Transfer between warehouses | productId, fromWarehouseId, toWarehouseId, quantity, status |
| `Order` | Customer orders | orderNumber, status, paymentStatus, total, trackingNumber, stripePaymentIntentId |
| `OrderItem` | Line items within an order | orderId, productId, productName, sku, quantity, price, warehouseId |
| `Invoice` | Financial invoices | invoiceNumber, orderId, status, amountPaid, amountDue, paymentLink |
| `Notification` | In-app notifications | userId, type, title, message, read |
| `AuditLog` | System audit trail | userId, action, entityType, entityId, details, ipAddress |
| `SystemConfig` | Admin-managed settings | key, value, type, category |
| `ImportHistory` | Bulk import records | importType, fileName, totalRows, successRows, failedRows |
| `SupportTicket` | Internal support system | subject, description, status, priority, assignedToId |
| `ProductReview` | Product ratings (ecommerce) | productId, userId, orderId, rating, comment, status |
| `Permission` | STUB — unused | userId, resource |
| `Department` | STUB — empty | id only |
| `Session` | Auth session store (leftover) | sessionToken |
| `VerificationToken` | Auth verification (leftover) | token |
| `UserAction` | STUB — empty | id only |
| `StockAlert` | STUB — empty | id only |

### Database Issues Identified

- `Department`, `UserAction`, `StockAlert` — empty stub models with no fields
- `Permission` model exists but is not used by the RBAC logic (role is on User)
- `Session` / `VerificationToken` — leftover next-auth adapter remnants
- No indexes on `Product.supplierId` or `Product.categoryId`
- `Product.quantity` is `BigInt` but many places convert to/from `number` — silent precision risks

---

## 5. Authentication Architecture

### Current Auth Approach — Custom JWT

- **Login flow:** POST `/api/auth/login` → bcrypt compare → sign JWT → set `session` HttpOnly cookie
- **Google OAuth:** Custom handler in `/api/auth/oauth` + `/lib/auth/oauth.ts`
- **Session reading (server):** `getSessionFromRequest()` in `utils/auth.ts`
- **Session reading (client):** `getSession()` via `/api/auth/session` + `AuthContext`
- **Password hashing:** bcryptjs

### Auth Files

| File | Role |
|---|---|
| `utils/auth.ts` | Server-side session decoder |
| `utils/auth.client.ts` | Client-side session helper |
| `lib/auth-server.ts` | Re-export `getSession()` for layout |
| `lib/auth/oauth.ts` | Google OAuth token exchange |
| `contexts/auth-context.tsx` | React context — provides `user`, `role`, `isAdmin` etc. |
| `middleware/authMiddleware.ts` | **DEAD CODE** — uses Pages Router signature, not App Router |

### Auth Problems

- `middleware/authMiddleware.ts` uses legacy Pages Router API (`NextApiRequest`) — dead code
- `next-auth` beta is listed as a dependency but custom JWT is used — creates confusion
- No root `middleware.ts` — route protection is ad-hoc in each handler
- Session token not rotated; no refresh token mechanism

---

## 6. Authorization / RBAC

### Current Role System

Roles stored in `User.role` as a plain string:

| Role | Access |
|---|---|
| `admin` | Full access — all management functions |
| `user` | Limited — personal orders/invoices only |
| `supplier` | Supplier portal — their products only |
| `client` | Client portal — browse, order, review |
| `retailer` | Mentioned in comments but NEVER implemented |
| `null` | Treated as `user` (backward compat) |

### Authorization Pattern

- Role checked **inline** inside each API route handler
- No centralized permission middleware
- `Permission` model exists in schema but **is not used**
- No fine-grained permission system

---

## 7. Inventory Architecture

### Stock Model

```
Product
  ├── quantity (BigInt)           — total stock across all warehouses
  ├── reservedQuantity (BigInt)   — allocated to pending orders (global)
  └── status                      — "Available" | "Stock Low" | "Stock Out"
       (HARDCODED threshold: >20 = Available, 1-20 = Stock Low, 0 = Stock Out)

StockAllocation (per warehouse)
  ├── productId
  ├── warehouseId
  ├── quantity (BigInt)           — warehouse-specific available qty
  └── reservedQuantity (BigInt)  — warehouse-specific reserved qty
```

### Stock Flow

1. **Create product** → set `Product.quantity` (global)
2. **Allocate to warehouse** → create `StockAllocation` record
3. **Create order** → reserve stock: increment `StockAllocation.reservedQuantity`
4. **Complete order** → decrement `StockAllocation.quantity` + `Product.quantity`
5. **Cancel order** → release `StockAllocation.reservedQuantity`
6. **Transfer** → create `StockTransfer` record; move qty between allocations

### Inventory Problems

- **No movement ledger** — there is no `StockMovement` model. Stock changes happen directly with no history trail.
- `Product.quantity` must always equal sum of `StockAllocation.quantity` — enforced only by app logic
- Status threshold is **hardcoded** at 20 — not configurable
- `BigInt` + `number` conversions throughout cause silent precision issues

---

## 8. Warehouse Architecture

### Current Warehouse Model — FLAT (no hierarchy)

```
Warehouse
  ├── id, name, address (string), type (string), status (Boolean)
  └── (no Zone, Rack, Shelf, Bin structure)

StockAllocation
  └── productId + warehouseId + quantity
```

### Warehouse Files

| File | Responsibility |
|---|---|
| `app/api/warehouses/route.ts` | CRUD |
| `lib/server/warehouse-detail-data.ts` | Detail page data loading |
| `lib/server/warehouse-stock-data.ts` | Per-warehouse stock list |
| `lib/warehouses/warehouse-delete-guards.ts` | Prevents deletion of warehouses with stock |

---

## 9. Product Architecture

### Current Product Model

```
Product
  ├── id, name, sku (unique), price, quantity, reservedQuantity
  ├── status ("Available" | "Stock Low" | "Stock Out")
  ├── categoryId (single flat category)
  ├── supplierId (single supplier)
  ├── imageUrl, imageFileId (ImageKit)
  ├── qrCodeUrl, qrCodeFileId (ImageKit)
  ├── expirationDate (optional — perishables)
  └── deletedAt, deletedBy (soft delete)
```

### Missing Fields for BuildStock

| Missing Field | Priority |
|---|---|
| Brand | HIGH |
| Barcode (EAN/UPC) | HIGH |
| Unit of Measure | CRITICAL |
| Unit conversions | CRITICAL |
| Purchase / retail / wholesale price | HIGH |
| Minimum / maximum stock level | HIGH |
| Dimensions (L x W x H), weight | MEDIUM |
| Color, material, size | MEDIUM |
| Model number | MEDIUM |
| Subcategory | MEDIUM |

---

## 10. Order Architecture

Orders represent **sales orders only** (outbound). No purchase orders (inbound from supplier).

```
Order
  ├── status: pending | confirmed | processing | shipped | delivered | cancelled
  ├── paymentStatus: unpaid | paid | refunded | partial
  ├── Stripe payment integration (not applicable for B2B WMS)
  └── Shippo shipping integration (not applicable for local WMS)
```

### Order Problems for BuildStock

- No purchase order / goods receipt model
- Deeply coupled to Stripe and Shippo
- Invoice model is one-to-one with Order (rigid)

---

## 11. Supplier Architecture

```
Supplier: id, name, status, description, notes
```

Very sparse — no contact info, no address, no tax ID, no purchase terms.
Supplier portal exists but only shows products by that supplier.

---

## 12. Customer Architecture

No separate Customer model — clients are `User` rows with `role="client"`.
Client portal: `/client/`, `/admin/client-portal/`, `/api/client-portal/`

---

## 13. Reporting / Analytics Architecture

- Business insights dashboard — `/business-insights/`
- Dashboard API — `/api/dashboard` — 31 KB aggregation
- AI insights — OpenRouter + Groq
- Forecasting — statistical demand prediction
- Export — PDF (jsPDF), Excel (ExcelJS), CSV (PapaParse)

---

## 14. Testing Architecture

- **Vitest** (^4.1.6) — unit tests only
- Test files co-located with source files
- No browser/E2E tests (no Playwright/Cypress)
- Good coverage of: stock allocation, order logic, AI, business insights, React Query
- Missing: API integration tests, email, Stripe/Shippo

---

## 15. External Integrations

| Integration | BuildStock Classification |
|---|---|
| MongoDB Atlas | CORE |
| ImageKit | CORE |
| Brevo (email) | CORE |
| Upstash Redis | CORE |
| Sentry | CORE |
| QStash | OPTIONAL |
| Google OAuth | OPTIONAL |
| Stripe | REMOVE |
| Shippo | REMOVE |
| OpenRouter + Groq | FUTURE |
| Vercel | OPTIONAL |
