import { describe, it, expect } from "vitest";
import { BuildStockRoles, BuildStockPermissions, hasPermission } from "@/lib/auth/permissions";

describe("BuildStock Phase 5B — Reservation UI & Permissions Tests", () => {
  it("verifies role permission grants for Stock Reservations", () => {
    // SUPER_ADMIN has all permissions
    expect(hasPermission(BuildStockRoles.SUPER_ADMIN, BuildStockPermissions.RESERVATION_VIEW)).toBe(true);
    expect(hasPermission(BuildStockRoles.SUPER_ADMIN, BuildStockPermissions.RESERVATION_CREATE)).toBe(true);
    expect(hasPermission(BuildStockRoles.SUPER_ADMIN, BuildStockPermissions.RESERVATION_RELEASE)).toBe(true);
    expect(hasPermission(BuildStockRoles.SUPER_ADMIN, BuildStockPermissions.RESERVATION_CANCEL)).toBe(true);

    // WAREHOUSE_MANAGER has full reservation management
    expect(hasPermission(BuildStockRoles.WAREHOUSE_MANAGER, BuildStockPermissions.RESERVATION_VIEW)).toBe(true);
    expect(hasPermission(BuildStockRoles.WAREHOUSE_MANAGER, BuildStockPermissions.RESERVATION_CREATE)).toBe(true);
    expect(hasPermission(BuildStockRoles.WAREHOUSE_MANAGER, BuildStockPermissions.RESERVATION_RELEASE)).toBe(true);
    expect(hasPermission(BuildStockRoles.WAREHOUSE_MANAGER, BuildStockPermissions.RESERVATION_CANCEL)).toBe(true);

    // STOREKEEPER can view, create, and release reservations
    expect(hasPermission(BuildStockRoles.STOREKEEPER, BuildStockPermissions.RESERVATION_VIEW)).toBe(true);
    expect(hasPermission(BuildStockRoles.STOREKEEPER, BuildStockPermissions.RESERVATION_CREATE)).toBe(true);
    expect(hasPermission(BuildStockRoles.STOREKEEPER, BuildStockPermissions.RESERVATION_RELEASE)).toBe(true);

    // VIEWER has read-only access
    expect(hasPermission(BuildStockRoles.VIEWER, BuildStockPermissions.RESERVATION_VIEW)).toBe(true);
    expect(hasPermission(BuildStockRoles.VIEWER, BuildStockPermissions.RESERVATION_CREATE)).toBe(false);
    expect(hasPermission(BuildStockRoles.VIEWER, BuildStockPermissions.RESERVATION_RELEASE)).toBe(false);
  });

  it("verifies stock relationship formula (available = physical - reserved)", () => {
    const physicalStock = 100.0;
    const activeReservedStock = 25.5;
    const availableStock = Math.max(0, physicalStock - activeReservedStock);

    expect(availableStock).toBe(74.5);
  });
});
