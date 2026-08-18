# BUILDSTOCK — Testing Plan

> Audit date: 2026-08-13
> Framework: Vitest ^4.1.6

---

## 1. Current Test Inventory

### 1.1 Existing Test Files (Co-located with Source)

| Test File | What It Tests | Status |
|---|---|---|
| `lib/stock-allocation/stock-allocation-enrich.test.ts` | Stock allocation enrichment logic | EXISTS |
| `lib/stock-allocation/catalog-quantity-reconcile.test.ts` | Qty reconcile planning | EXISTS |
| `lib/stock-allocation/apply-catalog-quantity-reconcile.test.ts` | Qty reconcile application | EXISTS |
| `lib/stock-allocation/validate-allocation-quantity.test.ts` | Allocation quantity validation | EXISTS |
| `lib/stock-allocation/catalog-allocation-copy.test.ts` | Allocation copy logic | EXISTS |
| `lib/stock-allocation/compute-allocate-budget.test.ts` | Budget computation | EXISTS |
| `lib/products/enrich-product-committed-quantity.test.ts` | Committed qty enrichment | EXISTS |
| `lib/products/order-stock-reservation.test.ts` | Stock reservation/release | EXISTS |
| `lib/products/plan-allocation-decrements.test.ts` | Allocation decrement planning | EXISTS |
| `lib/products/stock-allocation-order-sync.test.ts` | Order-allocation sync | EXISTS |
| `lib/products/delete-policy.test.ts` | Product delete rules | EXISTS |
| `lib/products/product-query.test.ts` | DB query builder | EXISTS |
| `lib/orders/order-line-stock-validation.test.ts` | Line-level stock check | EXISTS |
| `lib/orders/order-list-meta.test.ts` | Order metadata | EXISTS |
| `lib/orders/order-party.test.ts` | Order party validation | EXISTS |
| `lib/orders/order-sales-eligibility.test.ts` | Sales eligibility check | EXISTS |
| `lib/orders/order-ship-eligibility.test.ts` | Shipping eligibility check | EXISTS |
| `lib/orders/order-status-display-date.test.ts` | Status/date display logic | EXISTS |
| `lib/orders/transform-order-detail.test.ts` | Order detail transform | EXISTS |
| `lib/orders/map-order-items.test.ts` | Order item mapping | EXISTS |
| `lib/orders/merge-order-items-densify.test.ts` | Item merge logic | EXISTS |
| `lib/orders/enrich-order-items-catalog.test.ts` | Catalog enrichment | EXISTS |
| `lib/orders/invoice-event-date.test.ts` | Invoice date logic | EXISTS |
| `lib/orders/proportional-line-amount.test.ts` | Proportional amounts | EXISTS |
| `lib/orders/cancel-payment.test.ts` | Payment cancel logic | EXISTS |
| `lib/orders/order-destructive-copy.test.ts` | Order copy/clone | EXISTS |
| `lib/ai/create-chat-completion.test.ts` | AI completion wrapper | EXISTS |
| `lib/ai/groq.test.ts` | Groq AI client | EXISTS |
| `lib/ai/openrouter.test.ts` | OpenRouter client | EXISTS |
| `lib/insights/business-insights-warehouse-rollup.test.ts` | Warehouse rollup | EXISTS |
| `lib/insights/payment-money-stats.test.ts` | Payment stats | EXISTS |
| `lib/insights/warehouse-insights-compute.test.ts` | Warehouse KPIs | EXISTS |
| `lib/insights/warehouse-stock-aggregate.test.ts` | Stock aggregate | EXISTS |
| `lib/insights/product-insights-enrich.test.ts` | Product insights | EXISTS |
| `lib/auth/auth-welcome-toast.test.ts` | Welcome toast | EXISTS |
| `lib/auth/oauth-success-url.test.ts` | OAuth URL | EXISTS |
| `lib/auth/unique-username.test.ts` | Username uniqueness | EXISTS |
| `lib/auth/use-catalog-quantity-reconcile-preview.test.ts` | (hooks) reconcile preview | EXISTS |
| `lib/validations/auth-api.test.ts` | Auth validation schemas | EXISTS |
| `lib/validations/category-api.test.ts` | Category validation | EXISTS |
| `lib/validations/invoice.test.ts` | Invoice validation | EXISTS |
| `lib/validations/notification-api.test.ts` | Notification validation | EXISTS |
| `lib/validations/payment-api.test.ts` | Payment validation | EXISTS |
| `lib/validations/product-api.test.ts` | Product validation | EXISTS |
| `lib/validations/shipping-api.test.ts` | Shipping validation | EXISTS |
| `lib/validations/supplier-api.test.ts` | Supplier validation | EXISTS |
| `lib/validations/system-config-api.test.ts` | Config validation | EXISTS |
| `lib/validations/ai-api.test.ts` | AI validation | EXISTS |
| `lib/validations/warehouse-api.test.ts` | Warehouse validation | EXISTS |
| `lib/react-query/patch-mutation-cache.test.ts` | Mutation cache (56 KB!) | EXISTS |
| `lib/react-query/ssr-sync-policy.test.ts` | SSR sync policy | EXISTS |
| `lib/react-query/is-data-slot-loading.test.ts` | Loading state | EXISTS |
| `lib/react-query/resolve-order-committed-deltas.test.ts` | Committed deltas | EXISTS |
| `lib/react-query/portal-query-keys.test.ts` | Portal query keys | EXISTS |
| `lib/react-query/invalidate-coverage.test.ts` | Cache invalidation coverage | EXISTS |
| `lib/cache/cache-utils.test.ts` | Cache utility functions | EXISTS |
| `lib/cache/post-mutation.test.ts` | Post-mutation cache | EXISTS |
| `lib/server/catalog-entity-access.test.ts` | Entity access | EXISTS |
| `lib/server/catalog-insights.test.ts` | Catalog insights | EXISTS |
| `lib/server/catalog-list-enrich.test.ts` | List enrichment | EXISTS |
| `lib/server/category-detail-data.test.ts` | Category detail SSR | EXISTS |
| `lib/server/client-browse-data.test.ts` | Client browse SSR | EXISTS |
| `lib/server/client-catalog-data.test.ts` | Client catalog SSR | EXISTS |
| `lib/server/invoice-detail-data.test.ts` | Invoice detail SSR | EXISTS |
| `lib/server/invoices-data.test.ts` | Invoice list SSR | EXISTS |
| `lib/server/product-detail-data.test.ts` | Product detail SSR | EXISTS |
| `lib/server/product-insights.test.ts` | Product insights SSR | EXISTS |
| `lib/server/product-stock-data.test.ts` | Product stock SSR | EXISTS |
| `lib/server/support-tickets-data.test.ts` | Support tickets SSR | EXISTS |
| `lib/server/warehouse-detail-data.test.ts` | Warehouse detail SSR | EXISTS |
| `lib/server/warehouse-stock-data.test.ts` | Warehouse stock SSR | EXISTS |
| `lib/payments/order-payment-from-amounts.test.ts` | Payment amounts | EXISTS |
| `lib/payments/resolve-order-pay-amount.test.ts` | Pay amount resolver | EXISTS |
| `lib/payments/stripe-checkout-return-urls.test.ts` | Checkout return URLs | EXISTS |
| `lib/warehouses/warehouse-delete-guards.test.ts` | Delete guards | EXISTS |
| `lib/catalog/merge-catalog-mutation-densify.test.ts` | Catalog mutation | EXISTS |
| `lib/imagekit-errors.test.ts` | ImageKit errors | EXISTS |
| `lib/logger.test.ts` | Logger | EXISTS |
| `prisma/invoice-client-access.test.ts` | Invoice access | EXISTS |

**Total existing test files: ~75**

---

## 2. What Is Currently Tested

**Well tested:**
- Stock allocation logic (6+ files — good coverage)
- Order domain logic (10+ files — good coverage)
- Business insights computation
- React Query cache management
- Validation schemas
- AI module
- Auth helpers

**Partially tested:**
- Server data loading (SSR)
- Warehouse logic
- Cache utilities

**Not tested at all:**
- API route handlers (no integration tests)
- Prisma operations against real database
- Email sending (Brevo)
- End-to-end user flows
- UI components
- Stripe/Shippo (irrelevant for BuildStock)

---

## 3. Critical Missing Tests for BuildStock

### 3.1 Stock Movement Tests (CRITICAL)
The `StockMovement` model does not exist yet, but when it is added:
- All movement types generate correct records
- PURCHASE increases stock
- SALE decreases stock
- TRANSFER_IN/OUT updates correct warehouses
- ADJUSTMENT_IN/OUT records approver
- OPENING_BALANCE cannot be created twice
- Stock totals match sum of movements

### 3.2 Inventory Integrity Tests (CRITICAL)
- `Product.quantity` always equals sum of `StockAllocation.quantity`
- Stock never goes negative
- Reserved stock never exceeds available stock
- Unit conversions produce correct quantities

### 3.3 Product Domain Tests (HIGH)
- New minStock threshold per product
- BigInt/Float quantity handling with decimals
- Brand, barcode, unit fields validation
- Product status calculation with configurable threshold

### 3.4 Warehouse Tests (HIGH)
- Delete guard prevents deletion when stock exists
- Transfer moves stock correctly between warehouses
- Warehouse-specific quantity isolation

### 3.5 API Route Integration Tests (HIGH)
- POST /api/products — creates product with all BuildStock fields
- PATCH /api/products/:id — updates without corrupting stock
- POST /api/stock-allocations — validates against product total
- POST /api/stock-transfers — moves stock correctly
- Role-based access — admin vs storekeeper vs viewer

### 3.6 Authentication Tests (HIGH)
- Login with correct credentials succeeds
- Login with wrong credentials fails with 401
- Session cookie is set with correct properties
- Protected routes reject unauthenticated requests
- Role-based routes reject wrong roles

### 3.7 Purchase Order Tests (HIGH, Phase 1)
- PO creation validates product and supplier exist
- PO status workflow is enforced
- Goods receipt increases stock and creates StockMovement
- Partial receipt updates PO status correctly

### 3.8 Audit Log Tests (MEDIUM)
- Product create generates audit log
- Stock movement generates audit log
- User management generates audit log
- Audit log includes before/after snapshots

---

## 4. Testing Architecture Recommendations

### 4.1 Current Architecture — Good
- Vitest is well-suited for unit and integration tests
- Co-located test files are easy to maintain
- Mocked Prisma client pattern is established

### 4.2 Recommended Additions

**Unit Tests (continue current pattern):**
- Test all new domain logic functions
- Test all new validation schemas
- Test StockMovement creation logic

**Integration Tests (new):**
- Use `vitest` with a test MongoDB instance
- Test complete flows: create product → allocate → order → fulfill → check movement ledger
- Use `prisma.$transaction` rollback for test isolation

**API Tests (new):**
- Use `next/server` testing utilities or `supertest` via a test server
- Test each API route handler with mock sessions

**E2E Tests (future):**
- Playwright for critical user flows
- Login → Create product → Allocate to warehouse → Create purchase order

---

## 5. Test Coverage Goals for BuildStock

| Area | Current | Target (Phase 1) |
|---|---|---|
| Stock allocation logic | ~90% | 95% |
| Stock movement (new) | 0% | 90% |
| Product domain | ~60% | 85% |
| Warehouse domain | ~50% | 80% |
| Purchase order (new) | 0% | 80% |
| API route integration | 0% | 70% |
| Auth/RBAC | ~40% | 85% |
| Audit log | ~20% | 80% |

---

## 6. Test Data / Fixtures Plan

Create `tests/fixtures/` directory with:

- `products.fixture.ts` — BuildStock product data (tiles, paint, cement, etc.)
- `warehouses.fixture.ts` — sample warehouse configurations
- `suppliers.fixture.ts` — construction material suppliers
- `orders.fixture.ts` — sample sales orders
- `users.fixture.ts` — test users for each role

Update demo seed script `scripts/seed-demo-catalog.ts` to use BuildStock-specific data.

---

## 7. Recommended Test Scripts

Add to `package.json`:

```json
{
  "test": "vitest run",
  "test:watch": "vitest",
  "test:coverage": "vitest run --coverage",
  "test:integration": "vitest run tests/integration",
  "test:unit": "vitest run --exclude tests/integration"
}
```
