import { prisma } from "@/prisma/client";

/**
 * Format human-readable location path: "MAIN-WH / TILES / R-01 / S-02 / B-05"
 */
export async function buildLocationPath(binId: string): Promise<string> {
  const bin = await prisma.warehouseBin.findUnique({
    where: { id: binId },
    include: {
      shelf: {
        include: {
          rack: {
            include: {
              zone: true,
            },
          },
        },
      },
    },
  });

  if (!bin) throw new Error("Warehouse bin not found");

  const warehouse = await prisma.warehouse.findUnique({
    where: { id: bin.warehouseId },
  });

  const whCode = warehouse?.code || warehouse?.name || "WH";
  const zoneCode = bin.shelf.rack.zone.code;
  const rackCode = bin.shelf.rack.code;
  const shelfCode = bin.shelf.code;
  const binCode = bin.code;

  return `${whCode} / ${zoneCode} / ${rackCode} / ${shelfCode} / ${binCode}`;
}

/**
 * Validate that a Bin belongs to the given expected warehouse
 */
export async function validateBinWarehouse(binId: string, expectedWarehouseId: string) {
  const bin = await prisma.warehouseBin.findUnique({
    where: { id: binId },
  });

  if (!bin) throw new Error(`Bin not found: ${binId}`);
  if (!bin.active) throw new Error(`Bin ${bin.code} is inactive`);
  if (bin.warehouseId !== expectedWarehouseId) {
    throw new Error(`Bin ${bin.code} does not belong to warehouse ${expectedWarehouseId}`);
  }

  return bin;
}

// --- ZONES ---
export async function createZone(data: {
  warehouseId: string;
  code: string;
  name: string;
  description?: string;
}) {
  const existing = await prisma.warehouseZone.findUnique({
    where: {
      warehouseId_code: {
        warehouseId: data.warehouseId,
        code: data.code,
      },
    },
  });

  if (existing) {
    throw new Error(`Zone code "${data.code}" already exists in this warehouse.`);
  }

  return prisma.warehouseZone.create({
    data: {
      warehouseId: data.warehouseId,
      code: data.code.toUpperCase(),
      name: data.name,
      description: data.description || null,
    },
  });
}

// --- RACKS ---
export async function createRack(data: {
  zoneId: string;
  code: string;
  name: string;
  description?: string;
}) {
  const zone = await prisma.warehouseZone.findUnique({ where: { id: data.zoneId } });
  if (!zone) throw new Error("Parent zone not found");

  const existing = await prisma.warehouseRack.findUnique({
    where: {
      zoneId_code: {
        zoneId: data.zoneId,
        code: data.code,
      },
    },
  });

  if (existing) {
    throw new Error(`Rack code "${data.code}" already exists in zone ${zone.code}.`);
  }

  return prisma.warehouseRack.create({
    data: {
      zoneId: data.zoneId,
      warehouseId: zone.warehouseId,
      code: data.code.toUpperCase(),
      name: data.name,
      description: data.description || null,
    },
  });
}

// --- SHELVES ---
export async function createShelf(data: {
  rackId: string;
  code: string;
  name: string;
  level?: number;
}) {
  const rack = await prisma.warehouseRack.findUnique({ where: { id: data.rackId } });
  if (!rack) throw new Error("Parent rack not found");

  const existing = await prisma.warehouseShelf.findUnique({
    where: {
      rackId_code: {
        rackId: data.rackId,
        code: data.code,
      },
    },
  });

  if (existing) {
    throw new Error(`Shelf code "${data.code}" already exists in rack ${rack.code}.`);
  }

  return prisma.warehouseShelf.create({
    data: {
      rackId: data.rackId,
      warehouseId: rack.warehouseId,
      code: data.code.toUpperCase(),
      name: data.name,
      level: data.level || 1,
    },
  });
}

// --- BINS ---
export async function createBin(data: {
  shelfId: string;
  code: string;
  name: string;
  capacityWeight?: number;
  capacityVolume?: number;
}) {
  const shelf = await prisma.warehouseShelf.findUnique({
    where: { id: data.shelfId },
    include: {
      rack: {
        include: {
          zone: true,
        },
      },
    },
  });
  if (!shelf) throw new Error("Parent shelf not found");

  const existing = await prisma.warehouseBin.findUnique({
    where: {
      shelfId_code: {
        shelfId: data.shelfId,
        code: data.code,
      },
    },
  });

  if (existing) {
    throw new Error(`Bin code "${data.code}" already exists on shelf ${shelf.code}.`);
  }

  const warehouse = await prisma.warehouse.findUnique({ where: { id: shelf.warehouseId } });
  const whCode = warehouse?.code || warehouse?.name || "WH";
  const path = `${whCode} / ${shelf.rack.zone.code} / ${shelf.rack.code} / ${shelf.code} / ${data.code.toUpperCase()}`;

  return prisma.warehouseBin.create({
    data: {
      shelfId: data.shelfId,
      warehouseId: shelf.warehouseId,
      code: data.code.toUpperCase(),
      name: data.name,
      locationPath: path,
      capacityWeight: data.capacityWeight || null,
      capacityVolume: data.capacityVolume || null,
    },
  });
}

/**
 * Prevent deactivating or deleting a Bin containing non-zero stock
 */
export async function deactivateBin(binId: string) {
  const activeStock = await prisma.stockLocationAllocation.findMany({
    where: {
      binId,
      quantity: { gt: 0 },
    },
  });

  if (activeStock.length > 0) {
    throw new Error("Cannot deactivate bin containing active product stock.");
  }

  return prisma.warehouseBin.update({
    where: { id: binId },
    data: { active: false, updatedAt: new Date() },
  });
}

/**
 * Retrieve Full Warehouse Location Hierarchy Tree
 */
export async function getWarehouseLocationTree(warehouseId: string) {
  const warehouse = await prisma.warehouse.findUnique({
    where: { id: warehouseId },
  });
  if (!warehouse) throw new Error("Warehouse not found");

  const zones = await prisma.warehouseZone.findMany({
    where: { warehouseId, active: true },
    orderBy: { code: "asc" },
    include: {
      racks: {
        where: { active: true },
        orderBy: { code: "asc" },
        include: {
          shelves: {
            where: { active: true },
            orderBy: { code: "asc" },
            include: {
              bins: {
                where: { active: true },
                orderBy: { code: "asc" },
              },
            },
          },
        },
      },
    },
  });

  return {
    warehouseId: warehouse.id,
    warehouseName: warehouse.name,
    zones,
  };
}

/**
 * Query Inventory by Location (warehouse, zone, rack, shelf, bin, product)
 */
export async function getLocationInventory(filters: {
  warehouseId?: string;
  zoneId?: string;
  rackId?: string;
  shelfId?: string;
  binId?: string;
  productId?: string;
}) {
  const where: any = {};

  if (filters.productId) where.productId = filters.productId;
  if (filters.warehouseId) where.warehouseId = filters.warehouseId;
  if (filters.binId) where.binId = filters.binId;

  let binIds: string[] | null = null;

  if (filters.shelfId) {
    const bins = await prisma.warehouseBin.findMany({ where: { shelfId: filters.shelfId }, select: { id: true } });
    binIds = bins.map((b) => b.id);
  } else if (filters.rackId) {
    const shelves = await prisma.warehouseShelf.findMany({ where: { rackId: filters.rackId }, select: { id: true } });
    const shelfIds = shelves.map((s) => s.id);
    const bins = await prisma.warehouseBin.findMany({ where: { shelfId: { in: shelfIds } }, select: { id: true } });
    binIds = bins.map((b) => b.id);
  } else if (filters.zoneId) {
    const racks = await prisma.warehouseRack.findMany({ where: { zoneId: filters.zoneId }, select: { id: true } });
    const rackIds = racks.map((r) => r.id);
    const shelves = await prisma.warehouseShelf.findMany({ where: { rackId: { in: rackIds } }, select: { id: true } });
    const shelfIds = shelves.map((s) => s.id);
    const bins = await prisma.warehouseBin.findMany({ where: { shelfId: { in: shelfIds } }, select: { id: true } });
    binIds = bins.map((b) => b.id);
  }

  if (binIds !== null) {
    where.binId = { in: binIds };
  }

  return prisma.stockLocationAllocation.findMany({
    where,
    include: {
      bin: true,
      product: {
        select: {
          id: true,
          name: true,
          sku: true,
          unitId: true,
        },
      },
    },
  });
}
