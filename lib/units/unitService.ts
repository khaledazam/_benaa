import { prisma } from "@/prisma/client";

export const DEFAULT_UNITS = [
  { name: "Piece", code: "PIECE", symbol: "pcs", type: "count", isBaseUnit: true },
  { name: "Box", code: "BOX", symbol: "box", type: "count", isBaseUnit: false },
  { name: "Meter", code: "METER", symbol: "m", type: "length", isBaseUnit: true },
  { name: "Square Meter", code: "SQUARE_METER", symbol: "m²", type: "area", isBaseUnit: true },
  { name: "Cubic Meter", code: "CUBIC_METER", symbol: "m³", type: "volume", isBaseUnit: true },
  { name: "Kilogram", code: "KILOGRAM", symbol: "kg", type: "weight", isBaseUnit: true },
  { name: "Ton", code: "TON", symbol: "T", type: "weight", isBaseUnit: false },
  { name: "Liter", code: "LITER", symbol: "L", type: "volume", isBaseUnit: false },
  { name: "Gallon", code: "GALLON", symbol: "gal", type: "volume", isBaseUnit: false },
  { name: "Roll", code: "ROLL", symbol: "roll", type: "area", isBaseUnit: false },
  { name: "Bundle", code: "BUNDLE", symbol: "bnd", type: "count", isBaseUnit: false },
  { name: "Package", code: "PACKAGE", symbol: "pkg", type: "count", isBaseUnit: false },
];

/**
 * Ensures default units exist in the database
 */
export async function seedDefaultUnits() {
  for (const u of DEFAULT_UNITS) {
    const existing = await prisma.unit.findUnique({ where: { code: u.code } });
    if (!existing) {
      await prisma.unit.create({
        data: {
          name: u.name,
          code: u.code,
          symbol: u.symbol,
          type: u.type,
          isBaseUnit: u.isBaseUnit,
          active: true,
        },
      });
    }
  }
}

/**
 * Convert quantity from source unit to target base unit.
 * Supports product-specific conversion factor when provided.
 */
export async function convertUnitQuantity(params: {
  quantity: number;
  fromUnitId?: string | null;
  toUnitId?: string | null;
  productId?: string | null;
}): Promise<number> {
  const { quantity, fromUnitId, toUnitId, productId } = params;

  if (!fromUnitId || !toUnitId || fromUnitId === toUnitId || quantity === 0) {
    return quantity;
  }

  // 1. Check for product-specific conversion first
  if (productId) {
    const productConversion = await prisma.unitConversion.findFirst({
      where: {
        productId,
        fromUnitId,
        toUnitId,
      },
    });

    if (productConversion) {
      return quantity * productConversion.factor;
    }

    // Check inverse product conversion
    const inverseProductConversion = await prisma.unitConversion.findFirst({
      where: {
        productId,
        fromUnitId: toUnitId,
        toUnitId: fromUnitId,
      },
    });

    if (inverseProductConversion && inverseProductConversion.factor > 0) {
      return quantity / inverseProductConversion.factor;
    }
  }

  // 2. Check for global unit conversion
  const globalConversion = await prisma.unitConversion.findFirst({
    where: {
      productId: null,
      fromUnitId,
      toUnitId,
    },
  });

  if (globalConversion) {
    return quantity * globalConversion.factor;
  }

  const inverseGlobalConversion = await prisma.unitConversion.findFirst({
    where: {
      productId: null,
      fromUnitId: toUnitId,
      toUnitId: fromUnitId,
    },
  });

  if (inverseGlobalConversion && inverseGlobalConversion.factor > 0) {
    return quantity / inverseGlobalConversion.factor;
  }

  // Default fallback: return quantity unchanged if no conversion registered
  return quantity;
}
