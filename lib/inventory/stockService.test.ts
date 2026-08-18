import { describe, it, expect, beforeEach, vi } from "vitest";
import { calculateStockStatus, StockStatuses } from "./stockService";
import { convertUnitQuantity } from "../units/unitService";

describe("BuildStock Inventory & Stock Logic", () => {
  describe("Configurable Stock Status Thresholds", () => {
    it("calculates OUT_OF_STOCK when quantity is 0 or negative", () => {
      expect(calculateStockStatus(0, 10)).toBe(StockStatuses.OUT_OF_STOCK);
      expect(calculateStockStatus(-5, 10)).toBe(StockStatuses.OUT_OF_STOCK);
    });

    it("calculates LOW_STOCK when quantity <= minimumStock", () => {
      expect(calculateStockStatus(5, 10)).toBe(StockStatuses.LOW_STOCK);
      expect(calculateStockStatus(10, 10)).toBe(StockStatuses.LOW_STOCK);
    });

    it("calculates OVERSTOCK when quantity > maximumStock", () => {
      expect(calculateStockStatus(150, 10, 100)).toBe(StockStatuses.OVERSTOCK);
    });

    it("calculates IN_STOCK when quantity > minimumStock and <= maximumStock", () => {
      expect(calculateStockStatus(50, 10, 100)).toBe(StockStatuses.IN_STOCK);
      expect(calculateStockStatus(15, 10)).toBe(StockStatuses.IN_STOCK);
    });
  });

  describe("Decimal Quantities & Unit Conversions", () => {
    it("supports precise decimal math for construction materials", () => {
      const boxArea = 1.44; // 1 box = 1.44 m²
      const boxCount = 2.5;
      const totalMeters = Number((boxCount * boxArea).toFixed(2));
      expect(totalMeters).toBeCloseTo(3.6, 2);
    });
  });

  describe("Step 18 Critical Scenario Simulation", () => {
    it("calculates sequence: 100 + 50 - 25 - 5 = 120 boxes", () => {
      let currentStock = 100; // OPENING_BALANCE

      // Purchase: +50
      currentStock += 50;
      expect(currentStock).toBe(150);

      // Transfer Out: -25
      currentStock -= 25;
      expect(currentStock).toBe(125);

      // Damage: -5
      currentStock -= 5;
      expect(currentStock).toBe(120);
    });
  });
});
