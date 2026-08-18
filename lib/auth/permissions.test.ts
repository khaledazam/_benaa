import { describe, it, expect } from "vitest";
import {
  BuildStockRoles,
  BuildStockPermissions,
  hasPermission,
  normalizeRole,
} from "./permissions";

describe("BuildStock Permissions & Role Authorization", () => {
  it("normalizes roles correctly", () => {
    expect(normalizeRole("admin")).toBe(BuildStockRoles.SUPER_ADMIN);
    expect(normalizeRole("SUPER_ADMIN")).toBe(BuildStockRoles.SUPER_ADMIN);
    expect(normalizeRole("WAREHOUSE_MANAGER")).toBe(BuildStockRoles.WAREHOUSE_MANAGER);
    expect(normalizeRole("STOREKEEPER")).toBe(BuildStockRoles.STOREKEEPER);
    expect(normalizeRole("PURCHASING_OFFICER")).toBe(BuildStockRoles.PURCHASING_OFFICER);
    expect(normalizeRole("supplier")).toBe(BuildStockRoles.PURCHASING_OFFICER);
    expect(normalizeRole("INVENTORY_OFFICER")).toBe(BuildStockRoles.INVENTORY_OFFICER);
    expect(normalizeRole("user")).toBe(BuildStockRoles.VIEWER);
    expect(normalizeRole(null)).toBe(BuildStockRoles.VIEWER);
  });

  it("grants SUPER_ADMIN all permissions", () => {
    expect(hasPermission(BuildStockRoles.SUPER_ADMIN, BuildStockPermissions.PRODUCT_DELETE)).toBe(true);
    expect(hasPermission(BuildStockRoles.SUPER_ADMIN, BuildStockPermissions.USER_MANAGE)).toBe(true);
    expect(hasPermission(BuildStockRoles.SUPER_ADMIN, BuildStockPermissions.SYSTEM_CONFIG)).toBe(true);
  });

  it("enforces WAREHOUSE_MANAGER permissions", () => {
    expect(hasPermission(BuildStockRoles.WAREHOUSE_MANAGER, BuildStockPermissions.STOCK_TRANSFER)).toBe(true);
    expect(hasPermission(BuildStockRoles.WAREHOUSE_MANAGER, BuildStockPermissions.STOCK_ADJUST)).toBe(true);
    expect(hasPermission(BuildStockRoles.WAREHOUSE_MANAGER, BuildStockPermissions.USER_MANAGE)).toBe(false);
  });

  it("enforces STOREKEEPER permissions", () => {
    expect(hasPermission(BuildStockRoles.STOREKEEPER, BuildStockPermissions.STOCK_IN)).toBe(true);
    expect(hasPermission(BuildStockRoles.STOREKEEPER, BuildStockPermissions.STOCK_TRANSFER)).toBe(true);
    expect(hasPermission(BuildStockRoles.STOREKEEPER, BuildStockPermissions.PRODUCT_DELETE)).toBe(false);
    expect(hasPermission(BuildStockRoles.STOREKEEPER, BuildStockPermissions.USER_MANAGE)).toBe(false);
  });

  it("enforces VIEWER read-only permissions", () => {
    expect(hasPermission(BuildStockRoles.VIEWER, BuildStockPermissions.PRODUCT_VIEW)).toBe(true);
    expect(hasPermission(BuildStockRoles.VIEWER, BuildStockPermissions.STOCK_VIEW)).toBe(true);
    expect(hasPermission(BuildStockRoles.VIEWER, BuildStockPermissions.PRODUCT_CREATE)).toBe(false);
    expect(hasPermission(BuildStockRoles.VIEWER, BuildStockPermissions.STOCK_IN)).toBe(false);
  });
});
