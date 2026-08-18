import { describe, it, expect, vi } from "vitest";
import { BuildStockPermissions, hasPermission, BuildStockRoles } from "@/lib/auth/permissions";

describe("Phase 6.5 — Security & Authorization Boundary Testing", () => {
  it("Enforces server-side permission checks across sensitive roles", () => {
    // VIEWER role checks
    expect(hasPermission(BuildStockRoles.VIEWER, BuildStockPermissions.STOCK_VIEW)).toBe(true);
    expect(hasPermission(BuildStockRoles.VIEWER, BuildStockPermissions.INVENTORY_ADJUSTMENT_POST)).toBe(false);
    expect(hasPermission(BuildStockRoles.VIEWER, BuildStockPermissions.INVENTORY_COUNT_POST)).toBe(false);

    // STOREKEEPER role checks
    expect(hasPermission(BuildStockRoles.STOREKEEPER, BuildStockPermissions.INVENTORY_ADJUSTMENT_CREATE)).toBe(true);
    expect(hasPermission(BuildStockRoles.STOREKEEPER, BuildStockPermissions.INVENTORY_ADJUSTMENT_POST)).toBe(false);
    expect(hasPermission(BuildStockRoles.STOREKEEPER, BuildStockPermissions.INVENTORY_COUNT_POST)).toBe(false);

    // WAREHOUSE MANAGER role checks
    expect(hasPermission(BuildStockRoles.WAREHOUSE_MANAGER, BuildStockPermissions.INVENTORY_ADJUSTMENT_POST)).toBe(true);
    expect(hasPermission(BuildStockRoles.WAREHOUSE_MANAGER, BuildStockPermissions.INVENTORY_COUNT_POST)).toBe(true);

    // SUPER ADMIN role checks
    expect(hasPermission(BuildStockRoles.SUPER_ADMIN, BuildStockPermissions.INVENTORY_ADJUSTMENT_POST)).toBe(true);
    expect(hasPermission(BuildStockRoles.SUPER_ADMIN, BuildStockPermissions.INVENTORY_COUNT_POST)).toBe(true);

    // Phase 8 Dispatch Delivery & Health Permission checks
    expect(hasPermission(BuildStockRoles.VIEWER, BuildStockPermissions.DISPATCH_POST)).toBe(false);
    expect(hasPermission(BuildStockRoles.WAREHOUSE_MANAGER, BuildStockPermissions.DISPATCH_POST)).toBe(true);
    expect(hasPermission(BuildStockRoles.STOREKEEPER, BuildStockPermissions.DISPATCH_POST)).toBe(true);
  });

  it("Rejects unknown role access safely", () => {
    expect(hasPermission("UNKNOWN_ROLE", BuildStockPermissions.INVENTORY_ADJUSTMENT_POST)).toBe(false);
    expect(hasPermission("HACKER", BuildStockPermissions.STOCK_TRANSFER)).toBe(false);
  });
});
