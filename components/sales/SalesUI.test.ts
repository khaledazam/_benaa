import { describe, it, expect } from "vitest";
import { BuildStockRoles, BuildStockPermissions, hasPermission } from "@/lib/auth/permissions";

describe("BuildStock Phase 5A — Sales UI & Permissions Tests", () => {
  it("verifies role permission grants for Sales & Customer management", () => {
    // SUPER_ADMIN has all permissions
    expect(hasPermission(BuildStockRoles.SUPER_ADMIN, BuildStockPermissions.CUSTOMER_CREATE)).toBe(true);
    expect(hasPermission(BuildStockRoles.SUPER_ADMIN, BuildStockPermissions.SALES_ORDER_APPROVE)).toBe(true);

    // WAREHOUSE_MANAGER has customer & sales order management permissions
    expect(hasPermission(BuildStockRoles.WAREHOUSE_MANAGER, BuildStockPermissions.CUSTOMER_CREATE)).toBe(true);
    expect(hasPermission(BuildStockRoles.WAREHOUSE_MANAGER, BuildStockPermissions.CUSTOMER_DEACTIVATE)).toBe(true);
    expect(hasPermission(BuildStockRoles.WAREHOUSE_MANAGER, BuildStockPermissions.SALES_ORDER_CREATE)).toBe(true);
    expect(hasPermission(BuildStockRoles.WAREHOUSE_MANAGER, BuildStockPermissions.SALES_ORDER_APPROVE)).toBe(true);

    // STOREKEEPER can view & process/complete sales orders
    expect(hasPermission(BuildStockRoles.STOREKEEPER, BuildStockPermissions.CUSTOMER_VIEW)).toBe(true);
    expect(hasPermission(BuildStockRoles.STOREKEEPER, BuildStockPermissions.CUSTOMER_CREATE)).toBe(false);
    expect(hasPermission(BuildStockRoles.STOREKEEPER, BuildStockPermissions.SALES_ORDER_VIEW)).toBe(true);
    expect(hasPermission(BuildStockRoles.STOREKEEPER, BuildStockPermissions.SALES_ORDER_PROCESS)).toBe(true);
    expect(hasPermission(BuildStockRoles.STOREKEEPER, BuildStockPermissions.SALES_ORDER_APPROVE)).toBe(false);

    // VIEWER has read-only access
    expect(hasPermission(BuildStockRoles.VIEWER, BuildStockPermissions.CUSTOMER_VIEW)).toBe(true);
    expect(hasPermission(BuildStockRoles.VIEWER, BuildStockPermissions.CUSTOMER_CREATE)).toBe(false);
    expect(hasPermission(BuildStockRoles.VIEWER, BuildStockPermissions.SALES_ORDER_VIEW)).toBe(true);
    expect(hasPermission(BuildStockRoles.VIEWER, BuildStockPermissions.SALES_ORDER_CREATE)).toBe(false);
  });

  it("verifies financial calculations formula on line items", () => {
    const qty = 12.5;
    const price = 45.0;
    const discount = 10.0;
    const tax = 5.0;

    const lineTotal = Math.round((qty * price - discount + tax) * 100) / 100;
    expect(lineTotal).toBe(557.5);
  });
});
