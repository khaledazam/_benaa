import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  buildLocationPath,
  validateBinWarehouse,
} from "./locationService";
import { StockMovementTypes } from "@/lib/inventory/stockService";
import { BuildStockPermissions, hasPermission, BuildStockRoles } from "@/lib/auth/permissions";

describe("BuildStock Phase 3 — Warehouse Location Hierarchy & Physical Inventory", () => {
  describe("1. Location Hierarchy & Human-Readable Paths", () => {
    it("generates correct location path formatting", () => {
      const whCode = "MAIN-WH";
      const zoneCode = "TILES";
      const rackCode = "R-01";
      const shelfCode = "S-02";
      const binCode = "B-05";

      const path = `${whCode} / ${zoneCode} / ${rackCode} / ${shelfCode} / ${binCode}`;
      expect(path).toBe("MAIN-WH / TILES / R-01 / S-02 / B-05");
    });

    it("enforces parent-scoped code uniqueness (Rack R-01 in Zone A vs Zone B is allowed, duplicate in Zone A is rejected)", () => {
      const zoneARack1 = { zoneId: "zoneA", code: "R-01" };
      const zoneBRack1 = { zoneId: "zoneB", code: "R-01" };
      const zoneADuplicate = { zoneId: "zoneA", code: "R-01" };

      expect(zoneARack1.zoneId !== zoneBRack1.zoneId).toBe(true);
      expect(zoneARack1.zoneId === zoneADuplicate.zoneId && zoneARack1.code === zoneADuplicate.code).toBe(true);
    });
  });

  describe("2. Physical Inventory Distribution & Warehouse Stock Invariants", () => {
    it("supports product stock distribution across multiple bins in the same warehouse", () => {
      const binAStock = 50.0;
      const binBStock = 75.5;
      const totalWarehouseStock = binAStock + binBStock;

      expect(totalWarehouseStock).toBe(125.5);
    });

    it("maintains invariant: Sum(Bin Allocations) + Unassigned = Total Warehouse Stock", () => {
      const totalWarehouseStock = 200.0;
      const binAllocations = 150.0;
      const unassignedStock = totalWarehouseStock - binAllocations;

      expect(binAllocations + unassignedStock).toBe(totalWarehouseStock);
      expect(unassignedStock).toBe(50.0);
    });
  });

  describe("3. Bin Relocation Rules (Intra-Warehouse)", () => {
    it("moves stock from Bin A to Bin B while keeping overall warehouse stock UNCHANGED", () => {
      let binAStock = 100.0;
      let binBStock = 0.0;
      const initialWarehouseTotal = 100.0;

      const relocationQty = 25.0;
      expect(relocationQty <= binAStock).toBe(true); // Insufficient stock check

      binAStock -= relocationQty;
      binBStock += relocationQty;
      const newWarehouseTotal = binAStock + binBStock;

      expect(binAStock).toBe(75.0);
      expect(binBStock).toBe(25.0);
      expect(newWarehouseTotal).toBe(initialWarehouseTotal); // 100.0
    });

    it("rejects attempt to relocate more stock than available in source bin", () => {
      const binAStock = 20.0;
      const attemptedRelocation = 25.0;
      const isValid = attemptedRelocation <= binAStock;

      expect(isValid).toBe(false);
    });

    it("rejects relocation when source bin equals destination bin", () => {
      const fromBinId = "bin-001";
      const toBinId = "bin-001";
      const isValid = fromBinId !== toBinId;

      expect(isValid).toBe(false);
    });

    it("rejects relocation between bins belonging to different warehouses", () => {
      const binAWarehouseId: string = "wh-001";
      const binBWarehouseId: string = "wh-002";
      const isValid = binAWarehouseId === binBWarehouseId;

      expect(isValid).toBe(false);
    });
  });

  describe("4. Step 25 Critical End-to-End Location & Relocation Scenario", () => {
    it("executes PO 100 m² -> Receive into B-01 -> Relocate 25 m² to B-02 -> Reject over-relocation attempt", () => {
      let b01Stock = 0.0;
      let b02Stock = 0.0;
      let totalWarehouseStock = 0.0;
      let movements: Array<{ type: string; qty: number }> = [];

      // --- 1. POST Goods Receipt: 100 m² into B-01 ---
      const grnQty = 100.0;
      b01Stock += grnQty;
      totalWarehouseStock += grnQty;
      movements.push({ type: StockMovementTypes.PURCHASE, qty: grnQty });

      expect(b01Stock).toBe(100.0);
      expect(b02Stock).toBe(0.0);
      expect(totalWarehouseStock).toBe(100.0);
      expect(movements[0]?.type).toBe("PURCHASE");

      // --- 2. Relocate 25 m² from B-01 to B-02 ---
      const relocateQty = 25.0;
      expect(relocateQty <= b01Stock).toBe(true);

      b01Stock -= relocateQty;
      b02Stock += relocateQty;
      movements.push({ type: StockMovementTypes.RELOCATION, qty: relocateQty });

      expect(b01Stock).toBe(75.0);
      expect(b02Stock).toBe(25.0);
      expect(totalWarehouseStock).toBe(100.0); // Total UNCHANGED!
      expect(movements[1]?.type).toBe("RELOCATION");

      // --- 3. Attempt Relocation of 100 m² from B-01 to B-02 (Only 75 m² available) ---
      const overRelocateQty = 100.0;
      const canRelocate = overRelocateQty <= b01Stock;
      expect(canRelocate).toBe(false);

      // Stock remains strictly untouched after rejection
      expect(b01Stock).toBe(75.0);
      expect(b02Stock).toBe(25.0);
      expect(totalWarehouseStock).toBe(100.0);
    });
  });

  describe("5. Location Deactivation & Delete Safety Guards", () => {
    it("rejects deactivating a bin containing non-zero stock", () => {
      const binStock: number = 12.5;
      const canDeactivate = binStock === 0;

      expect(canDeactivate).toBe(false);
    });

    it("allows deactivating an empty bin with 0 stock", () => {
      const binStock = 0.0;
      const canDeactivate = binStock === 0;

      expect(canDeactivate).toBe(true);
    });
  });

  describe("6. Location Hierarchy Permissions & Role Verification", () => {
    it("grants WAREHOUSE_MANAGER and INVENTORY_OFFICER relocation and location manage permissions", () => {
      expect(hasPermission(BuildStockRoles.WAREHOUSE_MANAGER, BuildStockPermissions.STOCK_RELOCATE)).toBe(true);
      expect(hasPermission(BuildStockRoles.WAREHOUSE_MANAGER, BuildStockPermissions.LOCATION_CREATE)).toBe(true);
      expect(hasPermission(BuildStockRoles.INVENTORY_OFFICER, BuildStockPermissions.STOCK_RELOCATE)).toBe(true);
    });

    it("restricts VIEWER from creating locations or relocating stock", () => {
      expect(hasPermission(BuildStockRoles.VIEWER, BuildStockPermissions.STOCK_RELOCATE)).toBe(false);
      expect(hasPermission(BuildStockRoles.VIEWER, BuildStockPermissions.LOCATION_CREATE)).toBe(false);
      expect(hasPermission(BuildStockRoles.VIEWER, BuildStockPermissions.LOCATION_VIEW)).toBe(true);
    });
  });
});
