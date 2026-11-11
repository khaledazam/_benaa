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
}, db: any = prisma): Promise<number> {
  const { quantity, fromUnitId, toUnitId, productId } = params;
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("Quantity must be positive and finite");
  // Historical unitless products remain unitless; never infer a missing conversion.
  if (!fromUnitId && !toUnitId) return quantity;
  if (!fromUnitId || !toUnitId) throw new Error("Source and destination units are required for conversion");
  const fromUnit = await db.unit.findUnique({ where: { id: fromUnitId } });
  const toUnit = fromUnitId === toUnitId ? fromUnit : await db.unit.findUnique({ where: { id: toUnitId } });
  if (!fromUnit || !toUnit || !fromUnit.active || !toUnit.active) throw new Error("Conversion requires existing active units");
  if (fromUnit.type !== toUnit.type) throw new Error("Cannot convert units of different dimensions");
  if (fromUnitId === toUnitId) return quantity;
  for (const owner of productId ? [productId, null] : [null]) {
    for (const inverse of [false, true]) {
      const conversions = await db.unitConversion.findMany({ where: {
        productId: owner, fromUnitId: inverse ? toUnitId : fromUnitId, toUnitId: inverse ? fromUnitId : toUnitId,
      } });
      if (!conversions.length) continue;
      if (conversions.some((c: any) => !Number.isFinite(c.factor) || c.factor <= 0)) throw new Error("Conversion factor must be positive and finite");
      if (conversions.some((c: any) => c.factor !== conversions[0].factor)) throw new Error("Ambiguous unit conversion factors");
      const result = inverse ? quantity / conversions[0].factor : quantity * conversions[0].factor;
      if (!Number.isFinite(result) || result <= 0) throw new Error("Converted quantity must be positive and finite");
      return result;
    }
  }
  throw new Error("No registered unit conversion exists");
}
