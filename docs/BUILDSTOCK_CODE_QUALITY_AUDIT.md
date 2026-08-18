# BUILDSTOCK — Code Quality Audit

> Audit date: 2026-08-13
> Severity: CRITICAL / HIGH / MEDIUM / LOW

---

## CRITICAL Issues

### CQ-001 — Dead Middleware File (Security Risk)
**File:** `middleware/authMiddleware.ts`
**Severity:** CRITICAL
**Problem:** Uses `NextApiRequest`/`NextApiResponse` from Pages Router. This file is completely dead in the App Router. It creates confusion and the illusion of protection that does not exist.
**Action:** DELETE the file. Implement a proper Next.js root `middleware.ts` for route protection.

---

### CQ-002 — No Root middleware.ts for Route Protection
**File:** Missing
**Severity:** CRITICAL
**Problem:** There is no `middleware.ts` at the root level. This means unauthenticated users can attempt to access any page at the routing level — protection is only in API handlers.
**Action:** Create `middleware.ts` using Next.js Middleware with JWT verification to protect admin routes.

---

### CQ-003 — `next-auth` Beta Dependency Loaded But Unused
**File:** `package.json`, `lib/auth/`
**Severity:** CRITICAL
**Problem:** `next-auth` ^5.0.0-beta.30 is listed as a dependency and imports may be in the bundle, but the system uses custom JWT entirely. This creates security confusion.
**Action:** Remove `next-auth` from dependencies if it is confirmed unused. Verify no import exists.

---

### CQ-004 — BigInt Precision Risk in Stock Quantities
**File:** `prisma/schema.prisma`, multiple files
**Severity:** CRITICAL
**Problem:** `Product.quantity` and `StockAllocation.quantity` are `BigInt` in Prisma. JavaScript `BigInt` cannot be serialized to JSON natively. Many places convert `BigInt` to `number` (`Number(quantity)`) which loses precision for quantities > 2^53.
**Action:** Decide: change to `Float` (for decimal UOM support) or handle BigInt serialization properly everywhere. Construction materials need decimal quantities (e.g., 2.5 m2).

---

### CQ-005 — Hardcoded Low Stock Threshold
**File:** `lib/validations/product.ts` line 137-141
**Severity:** CRITICAL (business logic)
**Problem:** `calculateProductStatus()` hardcodes threshold of 20 units. This is completely wrong for construction materials (20 kg of cement vs 20 pallets of tiles are entirely different).
**Action:** Move `minStock` to Product model as a configurable field per product.

---

## HIGH Issues

### CQ-006 — Authorization Not Centralized
**File:** Every API route handler
**Severity:** HIGH
**Problem:** Role checks like `if (session.role !== "admin") return 401` are scattered across 30+ route handlers. Any missed check is a security hole.
**Action:** Create a `requireRole(...roles)` utility and apply it consistently. Optionally create a `withAuth(handler, options)` wrapper.

---

### CQ-007 — `app/api/products/route.ts` Is 918 Lines
**File:** `app/api/products/route.ts`
**Severity:** HIGH
**Problem:** A single file handles GET (list), POST (create), PATCH (update), DELETE (soft-delete), with complex inline logic for cache invalidation, QR code generation, supplier validation, stock allocation reconcile, and audit logging. This is a God File.
**Action:** Split into separate service functions in `lib/products/` — one function per operation.

---

### CQ-008 — No Stock Movement Ledger
**File:** Missing
**Severity:** HIGH (business critical)
**Problem:** There is no `StockMovement` model. All stock changes happen silently on `Product.quantity` and `StockAllocation.quantity`. It is impossible to trace how stock reached its current level.
**Action:** Add `StockMovement` model and ensure all stock-changing operations create a movement record.

---

### CQ-009 — Supplier Model Lacks Contact Information
**File:** `prisma/schema.prisma` (Supplier model)
**Severity:** HIGH (business critical)
**Problem:** `Supplier` only has `name`, `status`, `description`, `notes`. No phone, email, address, or tax ID. This makes the supplier module nearly useless for business operations.
**Action:** Add contact fields to Supplier model.

---

### CQ-010 — `lib/react-query/patch-mutation-cache.ts` Is 56 KB
**File:** `lib/react-query/patch-mutation-cache.ts`
**Severity:** HIGH
**Problem:** A single 56 KB file contains all optimistic UI cache patching logic. This is extremely difficult to maintain and test.
**Action:** Refactor into domain-specific cache patch files (e.g., `products-cache-patch.ts`, `orders-cache-patch.ts`).

---

### CQ-011 — Permission Model Is Unused Stub
**File:** `prisma/schema.prisma` (Permission model), `app/api/` handlers
**Severity:** HIGH
**Problem:** Permission model has `userId` and `resource` fields as `Json?` with `@unique` constraint, but is completely unused. Authorization is via inline role checks only.
**Action:** Redesign and implement Permission model properly in Phase 2.

---

### CQ-012 — Console.log in Middleware (Prod Leak)
**File:** `middleware/authMiddleware.ts` line 10
**Severity:** HIGH
**Problem:** `console.log("User from middleware:", user)` — this is dead code but if ever activated in production, it would log user session data.
**Action:** Delete the file entirely.

---

### CQ-013 — Sentry Org/Project Hardcoded in Config
**File:** `next.config.ts`
**Severity:** HIGH
**Problem:** `org: process.env.SENTRY_ORG ?? "arnob-mahmuds-org"` — falls back to the original developer's Sentry org. Any deployment without SENTRY_ORG set will try to report to wrong org.
**Action:** Remove hardcoded fallback values. Require SENTRY_ORG and SENTRY_PROJECT in env or disable Sentry when unset.

---

### CQ-014 — Metadata Hardcoded with Original Author
**File:** `app/layout.tsx`
**Severity:** HIGH (branding)
**Problem:** Metadata includes `creator: "Arnob Mahmud"`, `publisher: "Arnob Mahmud"`, personal email, personal website URL, `applicationName: "Stockly"`, and `siteName: "Stockly"`.
**Action:** Update all metadata for BuildStock. Remove personal author attribution.

---

## MEDIUM Issues

### CQ-015 — `lib/server/dashboard-data.ts` Is 31 KB
**File:** `lib/server/dashboard-data.ts`
**Severity:** MEDIUM
**Problem:** Single large aggregation file — complex but functional.
**Action:** Monitor for performance issues; refactor if dashboard load time exceeds 2s.

---

### CQ-016 — No Indexes on Product.categoryId / Product.supplierId
**File:** `prisma/schema.prisma`
**Severity:** MEDIUM
**Problem:** Products are frequently filtered by category and supplier, but no MongoDB indexes exist on these fields.
**Action:** Add `@@index([categoryId])` and `@@index([supplierId])` to Product model.

---

### CQ-017 — Empty Stub Models in Schema
**File:** `prisma/schema.prisma`
**Severity:** MEDIUM
**Problem:** `Department`, `UserAction`, `StockAlert`, `Session`, `VerificationToken` are empty or nearly empty models with no business purpose.
**Action:** Remove in a safe cleanup migration in Phase 1.

---

### CQ-018 — Inconsistent Date Handling (updatedAt)
**File:** Multiple Prisma models
**Severity:** MEDIUM
**Problem:** `updatedAt` is `DateTime?` and described as "Manually managed — null on create, set on update" across all models. Prisma can handle this with `@updatedAt` but the schema uses manual management instead.
**Action:** Consider using `@updatedAt` directive for consistency; or document the manual pattern clearly.

---

### CQ-019 — Unused `utils/auth.client.ts`
**File:** `utils/auth.client.ts`
**Severity:** MEDIUM
**Problem:** May be a leftover or partially used file. Needs audit of actual imports.
**Action:** Verify usage; consolidate or remove if redundant.

---

### CQ-020 — `app/api/products/route.ts` Mixes Multiple HTTP Methods
**File:** `app/api/products/route.ts`
**Severity:** MEDIUM
**Problem:** GET, POST, PATCH, DELETE are all in one file with shared helper functions interspersed.
**Action:** Split into separate files or at minimum extract shared helpers to `lib/products/`.

---

### CQ-021 — Stripe and Shippo Code Will Be Dead Weight
**File:** `lib/payments/`, `lib/shippo/`, `components/payments/`, `components/shipping/`
**Severity:** MEDIUM
**Problem:** BuildStock does not use Stripe or Shippo, but the code remains in the codebase — adding bundle size and maintenance burden.
**Action:** Remove in Phase 1 cleanup after confirming no remaining references.

---

### CQ-022 — Product Reviews Code Will Be Dead Weight
**File:** `lib/product-reviews/`, `components/product-reviews/`, `app/api/product-reviews/`, `prisma/product-review.ts`
**Severity:** MEDIUM
**Problem:** B2B WMS does not use consumer product reviews.
**Action:** Remove in Phase 1 cleanup.

---

### CQ-023 — `lib/auth/auth-panel-copy.ts` — Suspicious Filename
**File:** `lib/auth/auth-panel-copy.ts`
**Severity:** MEDIUM
**Problem:** Filename contains "copy" suggesting it is a temporary duplicate.
**Action:** Review and delete or rename.

---

### CQ-024 — 30 npm Vulnerabilities in package.json
**File:** `package.json`
**Severity:** MEDIUM
**Problem:** `npm audit` reports 30 vulnerabilities (2 low, 12 moderate, 14 high, 2 critical).
**Action:** Run `npm audit fix` for safe fixes. Review breaking changes before `npm audit fix --force`.

---

### CQ-025 — Deprecated Packages
**File:** `package.json`
**Severity:** MEDIUM
**Problem:** `lodash.isequal@4.5.0` (deprecated), `fstream@1.0.12` (no longer supported) are in the dependency tree.
**Action:** These are likely transitive dependencies. Investigate root packages that bring them in.

---

## LOW Issues

### CQ-026 — TODO Comment in products API Route
**File:** `app/api/products/route.ts` line 52-53
**Severity:** LOW
**Problem:** `// TODO (Future): Wrap with withPerformanceTracking()` — acknowledged tech debt.
**Action:** Implement when feature set stabilizes.

---

### CQ-027 — `launch.json` in Repository Root
**File:** `launch.json`
**Severity:** LOW
**Problem:** VS Code debug config in repo root rather than `.vscode/launch.json`. Not harmful but pollutes root.
**Action:** Move to `.vscode/launch.json`.

---

### CQ-028 — `proxy.ts` in Repository Root
**File:** `proxy.ts`
**Severity:** LOW
**Problem:** A `proxy.ts` file at root level. Purpose unclear from context.
**Action:** Investigate purpose; document or remove.

---

### CQ-029 — Fonts Committed to Repo
**File:** `app/fonts/GeistVF.woff`, `app/fonts/GeistMonoVF.woff`
**Severity:** LOW
**Problem:** Font files committed to git. Increases repo size.
**Action:** Consider loading Geist from CDN or package instead. Poppins already loads from Google Fonts.

---

### CQ-030 — No `.env` Validation at Startup
**File:** `lib/env.ts`
**Severity:** LOW
**Problem:** `validateEnv()` exists but it is unclear if it is called at application startup.
**Action:** Verify `validateEnv()` is called in `instrumentation.ts` or `layout.tsx` for early failure.

---

## Summary

| Severity | Count |
|---|---|
| CRITICAL | 5 |
| HIGH | 9 |
| MEDIUM | 11 |
| LOW | 5 |
| **Total** | **30** |

---

## Priority Action List for Phase 1

1. Delete `middleware/authMiddleware.ts` (CQ-001)
2. Create root `middleware.ts` for route protection (CQ-002)
3. Remove or resolve `next-auth` dependency (CQ-003)
4. Fix BigInt → Float for decimal quantities (CQ-004)
5. Move low stock threshold to Product.minStock (CQ-005)
6. Centralize authorization with `requireRole()` (CQ-006)
7. Add missing indexes to Product model (CQ-016)
8. Remove empty stub models from schema (CQ-017)
9. Update branding in `app/layout.tsx` (CQ-014)
10. Fix Sentry hardcoded org fallback (CQ-013)
