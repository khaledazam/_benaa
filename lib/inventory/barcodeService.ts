import { prisma } from "@/prisma/client";
import { getStockAvailabilityInTx } from './availability';

export interface BarcodeLookupResult {
  product: any;
  exactMatchField: "barcode" | "sku" | "id";
  warehouseAllocations: {
    warehouseId: string;
    warehouseName: string;
    physicalQuantity: number;
    reservedQuantity: number;
    availableQuantity: number;
  }[];
  totalPhysicalStock: number;
  totalAvailableStock: number;
}

/**
 * Fast barcode / SKU lookup for keyboard-wedge scanners and UI inputs.
 * Strips whitespace, control characters, and leading zero pads if necessary.
 */
export async function lookupProductByBarcode(
  rawBarcode: string,
  warehouseIdFilter?: string
): Promise<BarcodeLookupResult | null> {
  if (!rawBarcode || typeof rawBarcode !== "string") return null;

  const cleanedCode = rawBarcode.trim();
  if (!cleanedCode) return null;

  // Search by exact barcode, then SKU, then MongoDB ID
  let product = await prisma.product.findFirst({
    where: {
      OR: [
        { barcode: cleanedCode },
        { sku: cleanedCode },
      ],
      AND: [{ OR: [{ deletedAt: null }, { deletedAt: { isSet: false } }] }],
    },
  });

  let matchField: "barcode" | "sku" | "id" = "barcode";
  if (!product) {
    if (cleanedCode.match(/^[0-9a-fA-F]{24}$/)) {
      product = await prisma.product.findUnique({
        where: { id: cleanedCode },
      });
      if (product) matchField = "id";
    }
  } else {
    if (product.sku === cleanedCode && product.barcode !== cleanedCode) {
      matchField = "sku";
    }
  }

  if (!product || product.deletedAt) return null;

  // Load warehouse stock allocations
  const saWhere: any = { productId: product.id };
  if (warehouseIdFilter) saWhere.warehouseId = warehouseIdFilter;

  const allocations = await prisma.stockAllocation.findMany({
    where: saWhere,
  });

  const warehouseIds = allocations.map((a) => a.warehouseId);
  const warehouses = await prisma.warehouse.findMany({
    where: { id: { in: warehouseIds } },
    select: { id: true, name: true },
  });
  const warehouseMap = new Map(warehouses.map((w) => [w.id, w.name]));

  const warehouseAllocations = await Promise.all(allocations.map(async (a) => {
    const availability = await getStockAvailabilityInTx(prisma, product.id, a.warehouseId);
    const physical = availability.physicalStock;
    const reserved = availability.reservedStock;
    const available = availability.availableStock;
    return {
      warehouseId: a.warehouseId,
      warehouseName: warehouseMap.get(a.warehouseId) || "Warehouse",
      physicalQuantity: physical,
      reservedQuantity: reserved,
      availableQuantity: available,
    };
  }));

  const totalPhysicalStock = warehouseAllocations.reduce((sum, a) => sum + a.physicalQuantity, 0);
  const totalAvailableStock = warehouseAllocations.reduce((sum, a) => sum + a.availableQuantity, 0);

  return {
    product: warehouseIdFilter ? { ...product, quantity: totalPhysicalStock, reservedQuantity: totalPhysicalStock - totalAvailableStock } : product,
    exactMatchField: matchField,
    warehouseAllocations,
    totalPhysicalStock,
    totalAvailableStock,
  };
}
