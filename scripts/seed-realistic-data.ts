/**
 * BUILDSTOCK — REALISTIC PRODUCTION-LIKE DATA SEED ENGINE
 * Construction Materials & Modern Decoration Warehouse (Egypt)
 *
 * Enforces SEED_MODE='realistic' or ALLOW_REALISTIC_SEED='true'
 */

import "dotenv/config";
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
import bcrypt from "bcryptjs";
import { createGoodsReceiptDraft, postGoodsReceipt } from "../lib/procurement/procurementService";
import { createStockReservation } from "../lib/reservations/reservationService";
import { createPickList, startPickList, setPickAllocations, completePickList, getStrategyPickingSuggestions } from "../lib/picking/pickingService";
import { createDispatch, postDispatch, updateDeliveryStatus } from "../lib/dispatch/dispatchService";
import { createInventoryCount, startInventoryCount, recordCountItems, submitInventoryCount, approveInventoryCount, postInventoryCount } from "../lib/inventory/countingService";
import { createAdjustment, submitAdjustment, approveAdjustment, postAdjustment } from "../lib/inventory/adjustmentService";
import { reserveBatchQuantityInTx } from "../lib/inventory/batchService";
import { getInventoryHealthReport } from "../lib/inventory/healthService";

async function main() {
  console.log("\n==================================================");
  console.log("  BUILDSTOCK — REALISTIC PRODUCTION DATA SEED  ");
  console.log("==================================================\n");

  // 1. Safety Guard Check
  const seedMode = process.env.SEED_MODE;
  const allowSeed = process.env.ALLOW_REALISTIC_SEED;

  if (seedMode !== "realistic" && allowSeed !== "true") {
    console.error("[SAFETY GUARD] Execution rejected!");
    console.error("Neither SEED_MODE='realistic' nor ALLOW_REALISTIC_SEED='true' is set.");
    console.error("Refusing to run seed against database without explicit environment authorization.");
    process.exit(1);
  }

  console.log("✔ Safety guard passed (SEED_MODE=realistic / ALLOW_REALISTIC_SEED=true).");

  // 2. Hash default operational password
  const defaultPasswordHash = await bcrypt.hash("BuildStock@2026", 10);
  const khaledPasswordHash = await bcrypt.hash("102003000@", 10);
  const now = new Date();

  // 3. Seed Users across all 6 RBAC roles
  console.log("\n[1/12] Seeding Operational Users...");
  const usersData = [
    { email: "khaled@admin.com", username: "khaled_admin", name: "Khaled Admin", role: "SUPER_ADMIN", password: khaledPasswordHash },
    { email: "tarek.admin@buildstock-eg.com", username: "admin_tarek", name: "Eng. Tarek El-Mansoury", role: "SUPER_ADMIN", password: defaultPasswordHash },
    { email: "mahmoud.wh@buildstock-eg.com", username: "wh_mahmoud", name: "Mahmoud Abdel-Aziz", role: "WAREHOUSE_MANAGER", password: defaultPasswordHash },
    { email: "ahmed.store@buildstock-eg.com", username: "store_ahmed", name: "Ahmed Hassan", role: "STOREKEEPER", password: defaultPasswordHash },
    { email: "mohamed.inv@buildstock-eg.com", username: "inv_mohamed", name: "Mohamed Ali", role: "INVENTORY_OFFICER", password: defaultPasswordHash },
    { email: "omar.purch@buildstock-eg.com", username: "purch_omar", name: "Omar Mahmoud", role: "PURCHASING_OFFICER", password: defaultPasswordHash },
    { email: "youssef.view@buildstock-eg.com", username: "view_youssef", name: "Youssef Ibrahim", role: "VIEWER", password: defaultPasswordHash },
  ];

  const seededUsers: Record<string, any> = {};
  for (const u of usersData) {
    let user = await prisma.user.findUnique({ where: { email: u.email } });
    if (!user) {
      user = await prisma.user.create({
        data: {
          email: u.email,
          username: u.username,
          name: u.name,
          role: u.role,
          password: u.password,
          createdAt: now,
          status: true,
        },
      });
    } else {
      user = await prisma.user.update({
        where: { id: user.id },
        data: { name: u.name, username: u.username, role: u.role, password: u.password, updatedAt: now },
      });
    }
    seededUsers[u.role] = user;
  }

  const adminUser = seededUsers["SUPER_ADMIN"];
  const mgrUser = seededUsers["WAREHOUSE_MANAGER"];
  const storeUser = seededUsers["STOREKEEPER"];

  // 4. Seed Warehouse Network
  console.log("[2/12] Seeding Warehouse Network...");
  const warehousesData = [
    { code: "MAIN-WH", name: "Central Construction Yard", address: "Plot 42, Industrial Zone 3, 6th of October City, Giza" },
    { code: "DECOR-WH", name: "Modern Decoration Warehouse", address: "Sector 5, Katameya Ring Road, Cairo" },
    { code: "BACKUP-WH", name: "Secondary Storage Warehouse", address: "Free Zone Gate 2, El-Dekheila, Alexandria" },
  ];

  const warehouses: Record<string, any> = {};
  for (const w of warehousesData) {
    let wh = await prisma.warehouse.findFirst({ where: { name: w.name } });
    if (!wh) {
      wh = await prisma.warehouse.create({
        data: {
          code: w.code,
          name: w.name,
          address: w.address,
          status: true,
          userId: adminUser.id,
          createdBy: adminUser.id,
          createdAt: now,
        },
      });
    }
    warehouses[w.code] = wh;
  }

  // 5. Seed Location Hierarchy (Zones -> Racks -> Shelves -> Bins)
  console.log("[3/12] Seeding Location Hierarchy (Zones, Racks, Shelves, Bins)...");
  const zonesConfig = [
    { code: "TILES", name: "Ceramic & Porcelain Tiles", whCode: "MAIN-WH" },
    { code: "CEMENT", name: "Cement & Aggregates", whCode: "MAIN-WH" },
    { code: "STEEL", name: "Rebar & Structural Steel", whCode: "MAIN-WH" },
    { code: "PLUMBING", name: "Pipes & Plumbing Fittings", whCode: "MAIN-WH" },
    { code: "PAINT", name: "Paints & Wall Coatings", whCode: "MAIN-WH" },
    { code: "SANITARY", name: "Sanitary Ware & Fixtures", whCode: "MAIN-WH" },
    { code: "MARBLE", name: "Natural Marble & Granite", whCode: "DECOR-WH" },
    { code: "WALL-PANELS", name: "WPC & Decorative Panels", whCode: "DECOR-WH" },
  ];

  const allCreatedBins: any[] = [];

  for (const zCfg of zonesConfig) {
    const wh = warehouses[zCfg.whCode];
    let zone = await prisma.warehouseZone.findUnique({
      where: { warehouseId_code: { warehouseId: wh.id, code: zCfg.code } },
    });
    if (!zone) {
      zone = await prisma.warehouseZone.create({
        data: { warehouseId: wh.id, code: zCfg.code, name: zCfg.name, active: true },
      });
    }

    for (let r = 1; r <= 3; r++) {
      const rackCode = `R-${String(r).padStart(2, "0")}`;
      let rack = await prisma.warehouseRack.findUnique({
        where: { zoneId_code: { zoneId: zone.id, code: rackCode } },
      });
      if (!rack) {
        rack = await prisma.warehouseRack.create({
          data: { zoneId: zone.id, warehouseId: wh.id, code: rackCode, name: `Rack ${r}`, active: true },
        });
      }

      for (let s = 1; s <= 2; s++) {
        const shelfCode = `S-${String(s).padStart(2, "0")}`;
        let shelf = await prisma.warehouseShelf.findUnique({
          where: { rackId_code: { rackId: rack.id, code: shelfCode } },
        });
        if (!shelf) {
          shelf = await prisma.warehouseShelf.create({
            data: { rackId: rack.id, warehouseId: wh.id, code: shelfCode, name: `Shelf ${s}`, active: true },
          });
        }

        for (let b = 1; b <= 3; b++) {
          const binCode = `B-${String(b).padStart(2, "0")}`;
          const locPath = `${wh.code} / ${zone.code} / ${rackCode} / ${shelfCode} / ${binCode}`;
          let bin = await prisma.warehouseBin.findUnique({
            where: { shelfId_code: { shelfId: shelf.id, code: binCode } },
          });
          if (!bin) {
            bin = await prisma.warehouseBin.create({
              data: {
                shelfId: shelf.id,
                warehouseId: wh.id,
                code: binCode,
                name: `Bin ${b}`,
                locationPath: locPath,
                active: true,
              },
            });
          }
          allCreatedBins.push(bin);
        }
      }
    }
  }

  // 6. Seed Units & Conversions
  console.log("[4/12] Seeding Units of Measure & Conversions...");
  const unitsData = [
    { code: "PCS", name: "Pieces", symbol: "pcs", type: "COUNT" },
    { code: "BOX", name: "Box", symbol: "box", type: "COUNT" },
    { code: "M2", name: "Square Meter", symbol: "m²", type: "AREA" },
    { code: "M3", name: "Cubic Meter", symbol: "m³", type: "VOLUME" },
    { code: "KG", name: "Kilogram", symbol: "kg", type: "WEIGHT" },
    { code: "TON", name: "Metric Ton", symbol: "ton", type: "WEIGHT" },
    { code: "LITER", name: "Liter", symbol: "L", type: "VOLUME" },
    { code: "METER", name: "Meter", symbol: "m", type: "LENGTH" },
    { code: "ROLL", name: "Roll", symbol: "roll", type: "COUNT" },
    { code: "BAG", name: "Bag", symbol: "bag", type: "COUNT" },
  ];

  const units: Record<string, any> = {};
  for (const u of unitsData) {
    let unit = await prisma.unit.findUnique({ where: { code: u.code } });
    if (!unit) {
      unit = await prisma.unit.create({ data: u });
    }
    units[u.code] = unit;
  }

  // Unit Conversions
  const conversions = [
    { from: "BOX", to: "M2", factor: 1.44 },
    { from: "TON", to: "KG", factor: 1000.0 },
    { from: "BAG", to: "KG", factor: 50.0 },
    { from: "M3", to: "LITER", factor: 1000.0 },
    { from: "ROLL", to: "METER", factor: 50.0 },
  ];

  for (const c of conversions) {
    const fromU = units[c.from];
    const toU = units[c.to];
    let conv = await prisma.unitConversion.findFirst({
      where: { fromUnitId: fromU.id, toUnitId: toU.id },
    });
    if (!conv) {
      await prisma.unitConversion.create({
        data: { fromUnitId: fromU.id, toUnitId: toU.id, factor: c.factor },
      });
    }
  }

  // 7. Seed Categories & Brands
  console.log("[5/12] Seeding Categories & Brands...");
  const categoriesData = [
    { name: "Ceramic Tiles" },
    { name: "Porcelain Tiles" },
    { name: "Marble & Granite" },
    { name: "Portland Cement" },
    { name: "Rebar Steel" },
    { name: "Sand & Aggregates" },
    { name: "PPR & PVC Plumbing" },
    { name: "Electrical Cables & Wires" },
    { name: "Emulsion Paints" },
    { name: "Tile Adhesives & Grout" },
    { name: "Waterproofing Membranes" },
    { name: "Sanitary Fixtures" },
    { name: "Bathroom Accessories" },
    { name: "WPC Wall Panels" },
    { name: "Decorative Moldings" },
    { name: "Gypsum Boards" },
  ];

  const categories: Record<string, any> = {};
  for (const c of categoriesData) {
    let cat = await prisma.category.findFirst({ where: { name: c.name } });
    if (!cat) {
      cat = await prisma.category.create({
        data: {
          name: c.name,
          userId: adminUser.id,
          createdBy: adminUser.id,
          status: true,
        },
      });
    }
    categories[c.name] = cat;
  }

  const brandsData = [
    "Ceramica Cleopatra", "Ceramica Alfa", "Saveto Egypt", "Suez Cement",
    "Ezz Steel", "Jotun Egypt", "GLC Paints", "Ideal Standard",
    "Duravit Egypt", "Grohe", "Sika Egypt", "Knauf Egypt"
  ];

  const brands: Record<string, any> = {};
  for (const bName of brandsData) {
    let brand = await prisma.brand.findUnique({ where: { name: bName } });
    if (!brand) {
      brand = await prisma.brand.create({ data: { name: bName, active: true } });
    }
    brands[bName] = brand;
  }

  // 8. Seed Suppliers (20 Egyptian Suppliers)
  console.log("[6/12] Seeding Suppliers (20 Synthetic Suppliers)...");
  const suppliersData = [
    { name: "Egyptian Ceramic & Porcelain Factory", phone: "+20-2-27940001", email: "sales@egyptianceramics.com", address: "Industrial Zone 1, 10th of Ramadan City, Egypt" },
    { name: "Nile Cement & Building Supplies Co.", phone: "+20-2-27940002", email: "contact@nilecement.eg", address: "Helwan Industrial Sector, Cairo, Egypt" },
    { name: "Cairo Steel & Rebar Trading Ltd.", phone: "+20-2-27940003", email: "info@cairosteel.eg", address: "Sadat City Industrial Zone, Menofia, Egypt" },
    { name: "Jotun Paints Middle East Egypt", phone: "+20-2-27940004", email: "orders@jotun.eg", address: "Plot 12, 5th Settlement, New Cairo, Egypt" },
    { name: "Modern Marble & Granite Quarries", phone: "+20-2-27940005", email: "sales@modernmarble.eg", address: "Shak El-Thoban Marble City, Cairo, Egypt" },
    { name: "Delta Building Mortar & Adhesives", phone: "+20-2-27940006", email: "supply@deltamortar.com", address: "Borg El-Arab Industrial Zone 2, Alexandria" },
    { name: "Alexandria Sanitary & Faucet Supply", phone: "+20-2-27940007", email: "info@alexsanitary.eg", address: "Smouha Business Hub, Alexandria, Egypt" },
    { name: "Red Sea Waterproofing Materials", phone: "+20-2-27940008", email: "orders@redseawaterproofing.com", address: "Ain Sokhna Industrial Complex, Suez" },
    { name: "Pyramids Gypsum & Drywall Co.", phone: "+20-2-27940009", email: "sales@pyramidsgypsum.eg", address: "Giza Industrial Park, Giza, Egypt" },
    { name: "El-Sewedy Cable & Electrical Supply", phone: "+20-2-27940010", email: "info@elsewedy-supply.com", address: "Industrial Zone 3, 5th Settlement, New Cairo" },
  ];

  for (let s = 11; s <= 20; s++) {
    suppliersData.push({
      name: `Egyptian Building Supply Co. #${s}`,
      phone: `+20-2-279400${s}`,
      email: `contact@supplier${s}.eg`,
      address: `Industrial Sector ${s}, Cairo, Egypt`,
    });
  }

  const seededSuppliers: any[] = [];
  for (const s of suppliersData) {
    let supp = await prisma.supplier.findFirst({ where: { name: s.name } });
    if (!supp) {
      supp = await prisma.supplier.create({
        data: {
          name: s.name,
          phone: s.phone,
          email: s.email,
          address: s.address,
          userId: adminUser.id,
          createdBy: adminUser.id,
          status: true,
        },
      });
    }
    seededSuppliers.push(supp);
  }

  // 9. Seed Customers (40 Egyptian Customers)
  console.log("[7/12] Seeding Customers (40 Synthetic Contractors & Companies)...");
  const customersData = [
    { code: "CUST-001", name: "Orascom Construction Egypt", phone: "+20-2-33001001", email: "procurement@orascom.eg", address: "Nile City Towers, Corniche El-Nil, Cairo" },
    { code: "CUST-002", name: "Hassan Allam Construction", phone: "+20-2-33001002", email: "projects@hassanallam.com", address: "Heliopolis, Cairo, Egypt" },
    { code: "CUST-003", name: "Talaat Moustafa Group (TMG)", phone: "+20-2-33001003", email: "materials@tmg.eg", address: "Madinaty Sales Center, New Cairo" },
    { code: "CUST-004", name: "Palm Hills Developments", phone: "+20-2-33001004", email: "supply@palmhills.eg", address: "Palm Hills Complex, 6th of October City" },
    { code: "CUST-005", name: "El-Gharabawy Decor & Design Studio", phone: "+20-2-33001005", email: "info@elgharabawy-decor.eg", address: "Zamalek, Cairo, Egypt" },
  ];

  for (let c = 6; c <= 40; c++) {
    customersData.push({
      code: `CUST-00${c}`,
      name: `Contracting & Decor Firm #${c}`,
      phone: `+20-2-330010${c.toString().padStart(2, "0")}`,
      email: `info@customer${c}.eg`,
      address: `District ${c}, New Cairo, Egypt`,
    });
  }

  const seededCustomers: any[] = [];
  for (const c of customersData) {
    let cust = await prisma.customer.findUnique({ where: { customerCode: c.code } });
    if (!cust) {
      cust = await prisma.customer.create({
        data: {
          customerCode: c.code,
          name: c.name,
          phone: c.phone,
          email: c.email,
          address: c.address,
          createdBy: adminUser.id,
          active: true,
        },
      });
    }
    seededCustomers.push(cust);
  }

  // 10. Seed Products (120 products with barcodes, SKUs, Arabic/English names)
  console.log("[8/12] Seeding Product Catalog (120 products)...");
  const seededProducts: any[] = [];
  const defaultSupplier = seededSuppliers[0];

  const rawProducts = [
    { name: "بورسلين أرضيات 60x60 - Spanish Glazed Porcelain", sku: "PORC-ESP-6060", barcode: "622100010001", cat: "Porcelain Tiles", brand: "Ceramica Cleopatra", unit: "M2", price: 420.0, mode: "BATCH", min: 100, max: 2000 },
    { name: "سيراميك حوائط 30x60 - Premium Wall Tile White", sku: "CER-WHT-3060", barcode: "622100010002", cat: "Ceramic Tiles", brand: "Ceramica Alfa", unit: "M2", price: 185.0, mode: "BATCH", min: 150, max: 2500 },
    { name: "رخام كرارا إيطالي 30x60 - Italian Carrara Marble", sku: "MRB-CAR-3060", barcode: "622100010003", cat: "Marble & Granite", brand: "Ceramica Cleopatra", unit: "M2", price: 1850.0, mode: "LOT", min: 20, max: 500 },
    { name: "جرانيت أسود أسواني 60x60 - Aswan Black Granite", sku: "GRN-BLK-6060", barcode: "622100010004", cat: "Marble & Granite", brand: "Ceramica Cleopatra", unit: "M2", price: 950.0, mode: "LOT", min: 30, max: 600 },
    { name: "أسمنت بورتلاندي عالي الجودة 50 كجم - Suez Portland Cement", sku: "CEM-PORT-50KG", barcode: "622100010005", cat: "Portland Cement", brand: "Suez Cement", unit: "BAG", price: 165.0, mode: "BATCH", min: 500, max: 10000 },
    { name: "حديد تسليح 12 مم - Ezz Steel High Grade Rebar", sku: "STL-REBAR-12MM", barcode: "622100010006", cat: "Rebar Steel", brand: "Ezz Steel", unit: "TON", price: 41500.0, mode: "HEAT", min: 10, max: 200 },
    { name: "حديد تسليح 16 مم - Ezz Steel Heavy Construction Rebar", sku: "STL-REBAR-16MM", barcode: "622100010007", cat: "Rebar Steel", brand: "Ezz Steel", unit: "TON", price: 41500.0, mode: "HEAT", min: 10, max: 200 },
    { name: "دهان بلاستيك داخلي أبيض 18 لتر - Jotun Fenomastic White", sku: "PNT-JOT-FEN18L", barcode: "622100010008", cat: "Emulsion Paints", brand: "Jotun Egypt", unit: "LITER", price: 1250.0, mode: "BATCH", min: 40, max: 800 },
    { name: "مادة لاصقة للسيراميك 20 كجم - Saveto Tile Adhesive Standard", sku: "ADH-SAV-20KG", barcode: "622100010009", cat: "Tile Adhesives & Grout", brand: "Saveto Egypt", unit: "BAG", price: 140.0, mode: "LOT", min: 200, max: 3000 },
    { name: "عازل رطوبة سيروبلاست 20 لتر - Sika Waterproof Membrane", sku: "WTP-SIK-20L", barcode: "622100010010", cat: "Waterproofing Membranes", brand: "Sika Egypt", unit: "LITER", price: 980.0, mode: "BATCH", min: 20, max: 400 },
    { name: "مرحاض معلق إيديال ستاندرد - Ideal Standard Wall-Hung Toilet", sku: "SAN-IDL-TOILET", barcode: "622100010011", cat: "Sanitary Fixtures", brand: "Ideal Standard", unit: "PCS", price: 4850.0, mode: "NONE", min: 10, max: 150 },
    { name: "خلاط دوش كروم جروهي - Grohe Chrome Shower Mixer", sku: "MIX-GRO-SHOWER", barcode: "622100010012", cat: "Bathroom Accessories", brand: "Grohe", unit: "PCS", price: 3450.0, mode: "NONE", min: 15, max: 200 },
    { name: "ألواح خشب بلاستيكي WPC ديكور - WPC Wall Fluted Panel 2.9m", sku: "PNL-WPC-29M", barcode: "622100010013", cat: "WPC Wall Panels", brand: "Knauf Egypt", unit: "PCS", price: 380.0, mode: "NONE", min: 50, max: 800 },
    { name: "ألواح جبس مبطن 12.5 مم - Knauf Standard Gypsum Board 2.4m", sku: "GYP-KNF-12MM", barcode: "622100010014", cat: "Gypsum Boards", brand: "Knauf Egypt", unit: "PCS", price: 195.0, mode: "NONE", min: 100, max: 2000 },
  ];

  for (let i = 15; i <= 120; i++) {
    const seq = String(i).padStart(4, "0");
    const barcode = `62210001${seq}`;
    const sku = `MAT-PROD-${seq}`;
    const catKeys = Object.keys(categories);
    const catName = catKeys[(i - 1) % catKeys.length] || "Ceramic Tiles";
    const brandKeys = Object.keys(brands);
    const brandName = brandKeys[(i - 1) % brandKeys.length] || "Ceramica Cleopatra";
    const trackingModes = ["NONE", "BATCH", "LOT", "HEAT"];
    const mode = trackingModes[(i - 1) % trackingModes.length] || "NONE";

    rawProducts.push({
      name: `مواد بناء ديكور متخصصة رقم ${i} - Specialized Material Item #${i}`,
      sku,
      barcode,
      cat: catName,
      brand: brandName,
      unit: (i % 3 === 0) ? "BOX" : (i % 4 === 0) ? "PCS" : "M2",
      price: 150.0 + (i * 12.5),
      mode,
      min: 20,
      max: 500,
    });
  }

  for (const p of rawProducts) {
    const cat = categories[p.cat] || categories["Ceramic Tiles"];
    const brand = brands[p.brand];
    const unit = units[p.unit] || units["PCS"];

    let prod = await prisma.product.findUnique({ where: { sku: p.sku } });
    if (!prod) {
      prod = await prisma.product.create({
        data: {
          name: p.name,
          sku: p.sku,
          barcode: p.barcode,
          categoryId: cat.id,
          brandId: brand ? brand.id : null,
          unitId: unit.id,
          price: p.price,
          trackingMode: p.mode,
          minimumStock: p.min,
          maximumStock: p.max,
          quantity: 0,
          status: "ACTIVE",
          supplierId: defaultSupplier.id,
          userId: adminUser.id,
          createdBy: adminUser.id,
        },
      });
    }
    seededProducts.push(prod);
  }

  // 11. Seed Procurement & Goods Receipts (POs & Posted GRNs)
  console.log("[9/12] Seeding Purchase Orders & Goods Receipts (Stock Receiving via GRN)...");
  const mainWh = warehouses["MAIN-WH"];
  const decorWh = warehouses["DECOR-WH"];

  const poRecordsConfig = [
    { supplierIdx: 0, wh: mainWh, prodIdx: 0, qty: 500, price: 420.0, batchNum: "BAT-PORC-2026-A1", expDays: 730 },
    { supplierIdx: 1, wh: mainWh, prodIdx: 1, qty: 800, price: 185.0, batchNum: "BAT-CER-2026-B2", expDays: 730 },
    { supplierIdx: 2, wh: mainWh, prodIdx: 4, qty: 1000, price: 165.0, batchNum: "BAT-CEM-2026-C1", expDays: 180 },
    { supplierIdx: 3, wh: mainWh, prodIdx: 5, qty: 50, price: 41500.0, batchNum: "HEAT-STL-2026-S1", expDays: 1095 },
    { supplierIdx: 4, wh: mainWh, prodIdx: 7, qty: 300, price: 1250.0, batchNum: "BAT-JOT-2026-P1", expDays: 365 },
    { supplierIdx: 5, wh: mainWh, prodIdx: 8, qty: 500, price: 140.0, batchNum: "LOT-SAV-2026-L1", expDays: 365 },
    { supplierIdx: 6, wh: decorWh, prodIdx: 2, qty: 100, price: 1850.0, batchNum: "LOT-MRB-2026-M1", expDays: 1825 },
    { supplierIdx: 7, wh: mainWh, prodIdx: 10, qty: 500, price: 4850.0, batchNum: "NONE-1", expDays: 1095 },
    { supplierIdx: 8, wh: mainWh, prodIdx: 11, qty: 500, price: 3450.0, batchNum: "NONE-2", expDays: 1095 },
    { supplierIdx: 7, wh: mainWh, prodIdx: 12, qty: 500, price: 380.0, batchNum: "NONE-3", expDays: 1095 },
    { supplierIdx: 9, wh: mainWh, prodIdx: 13, qty: 500, price: 195.0, batchNum: "NONE-4", expDays: 1095 },
  ];

  for (let i = 0; i < poRecordsConfig.length; i++) {
    const cfg = poRecordsConfig[i];
    if (!cfg) continue;
    const supplier = seededSuppliers[cfg.supplierIdx];
    const product = seededProducts[cfg.prodIdx];
    const targetBin = allCreatedBins.find((b) => b.warehouseId === cfg.wh.id) || allCreatedBins[0];

    const poNum = `PO-2026-SEED-${cfg.prodIdx}-${i + 1}`;
    let po = await prisma.purchaseOrder.findUnique({ where: { purchaseOrderNumber: poNum } });

    if (!po) {
      po = await prisma.purchaseOrder.create({
        data: {
          purchaseOrderNumber: poNum,
          supplierId: supplier.id,
          warehouseId: cfg.wh.id,
          status: "APPROVED",
          createdBy: mgrUser.id,
          subtotal: cfg.qty * cfg.price,
          total: cfg.qty * cfg.price,
          items: {
            create: [
              {
                productId: product.id,
                productName: product.name,
                productSku: product.sku,
                unitId: product.unitId,
                orderedQuantity: cfg.qty,
                receivedQuantity: 0,
                remainingQuantity: cfg.qty,
                unitPrice: cfg.price,
                lineTotal: cfg.qty * cfg.price,
              },
            ],
          },
        },
      });

      const poItems = await prisma.purchaseOrderItem.findMany({ where: { purchaseOrderId: po.id } });

      if (poItems.length > 0 && poItems[0]) {
        // Create & Post Goods Receipt using service workflow to increment stock & batches
        const grnDraft = await createGoodsReceiptDraft({
          purchaseOrderId: po.id,
          notes: "Automated realistic seed receipt",
          userId: storeUser.id,
          items: [
            {
              purchaseOrderItemId: poItems[0].id,
              productId: product.id,
              receivedQuantity: cfg.qty,
              destinationBinId: targetBin.id,
            },
          ],
        });

        await postGoodsReceipt(grnDraft.id, storeUser.id);
      }
    }
  }

  // 12. Seed Sales Orders & Stock Reservations
  console.log("[10/12] Seeding Sales Orders & Stock Reservations...");
  const sampleProductsToSell = [seededProducts[10], seededProducts[11], seededProducts[12], seededProducts[13]];

  for (let s = 1; s <= 10; s++) {
    const cust = seededCustomers[(s - 1) % seededCustomers.length];
    const prod = sampleProductsToSell[(s - 1) % sampleProductsToSell.length];
    if (!cust || !prod) continue;

    const soNum = `SO-2026-${String(s).padStart(6, "0")}`;
    let so = await prisma.salesOrder.findUnique({ where: { salesOrderNumber: soNum } });

    if (!so) {
      so = await prisma.salesOrder.create({
        data: {
          salesOrderNumber: soNum,
          customerId: cust.id,
          warehouseId: mainWh.id,
          status: "APPROVED",
          createdBy: mgrUser.id,
          customerNameSnapshot: cust.name,
          subtotal: 50 * prod.price,
          total: 50 * prod.price,
          items: {
            create: [
              {
                productId: prod.id,
                productName: prod.name,
                productSku: prod.sku,
                unitId: prod.unitId,
                unitSymbol: "unit",
                orderedQuantity: 50,
                unitPrice: prod.price,
                lineTotal: 50 * prod.price,
              },
            ],
          },
        },
      });

      // Create reservation
      const res = await createStockReservation(so.id, mgrUser.id);

      // Sync batch reservation if batch exists
      const batch = await prisma.inventoryBatch.findFirst({
        where: { productId: prod.id, warehouseId: mainWh.id, status: "ACTIVE" },
      });
      if (batch && res.items[0]) {
        await prisma.stockReservationItem.update({
          where: { id: res.items[0].id },
          data: { batchId: batch.id, batchNumber: batch.batchNumber },
        });
        await reserveBatchQuantityInTx(prisma as any, batch.id, 50);
      }

      // If sales order index <= 5, create pick list & dispatch
      if (s <= 5) {
        const pickList = await createPickList({ reservationId: res.id, userId: storeUser.id });
        await startPickList(pickList.id, storeUser.id);

        const suggestions = await getStrategyPickingSuggestions({ pickListId: pickList.id });
        if (suggestions.length > 0 && suggestions[0] && pickList.items[0]) {
          const sug = suggestions[0];
          await setPickAllocations(
            pickList.id,
            [
              {
                pickListItemId: pickList.items[0].id,
                binId: sug.binId,
                requestedQuantity: sug.suggestedQuantity,
                pickedQuantity: sug.suggestedQuantity,
              },
            ],
            storeUser.id
          );
        }
        await completePickList(pickList.id, storeUser.id);

        // Create & Post Dispatch
        const dsp = await createDispatch(pickList.id, storeUser.id, "Automated realistic seed dispatch");
        await postDispatch(dsp.id, storeUser.id);
        await updateDeliveryStatus(
          dsp.id,
          "DELIVERED",
          {
            driverName: "Hassan El-Sayed",
            driverPhone: "+20-100-1234567",
            vehicleNumber: "أ ج ط 4567",
            deliveryAddress: cust.address || "Cairo, Egypt",
          },
          storeUser.id
        );
      }
    }
  }

  // 13. Seed Cycle Counts & Adjustments
  console.log("[11/12] Seeding Cycle Counts & Stock Adjustments...");
  const targetBinForCount = allCreatedBins.find((b) => b.warehouseId === mainWh.id);
  if (targetBinForCount) {
    const countSession = await createInventoryCount(
      {
        warehouseId: mainWh.id,
        scopeType: "BIN",
        scopeId: targetBinForCount.id,
        countMode: "BLIND_COUNT",
        notes: "Quarterly blind count audit",
      },
      mgrUser.id
    );

    await startInventoryCount(countSession.id, storeUser.id);
    const countWithItems = await prisma.inventoryCount.findUnique({
      where: { id: countSession.id },
      include: { items: true },
    });

    if (countWithItems && countWithItems.items.length > 0) {
      await recordCountItems(
        countSession.id,
        {
          items: countWithItems.items.map((it) => ({
            productId: it.productId,
            binId: it.binId,
            countedQuantity: Math.max(0, it.systemQuantity),
          })),
        },
        storeUser.id
      );
      await submitInventoryCount(countSession.id, storeUser.id);
      await approveInventoryCount(countSession.id, mgrUser.id);
      await postInventoryCount(countSession.id, mgrUser.id);
    }
  }

  // Stock Adjustment (Damage adjustment)
  const adjProd = seededProducts[0];
  const adjBin = allCreatedBins.find((b) => b.warehouseId === mainWh.id);
  if (adjProd && adjBin) {
    const currentLocAlloc = await prisma.stockLocationAllocation.findUnique({
      where: { productId_binId: { productId: adjProd.id, binId: adjBin.id } },
    });

    const sysQty = currentLocAlloc ? currentLocAlloc.quantity : 0;
    if (sysQty >= 2) {
      const adj = await createAdjustment(
        {
          warehouseId: mainWh.id,
          reason: "Handling damage during pallet movement",
          adjustmentType: "DAMAGE",
          items: [
            {
              productId: adjProd.id,
              binId: adjBin.id,
              systemQuantity: sysQty,
              adjustmentQuantity: -2,
              resultingQuantity: sysQty - 2,
              notes: "Broken porcelain tile box",
            },
          ],
        },
        storeUser.id
      );
      await submitAdjustment(adj.id, storeUser.id);
      await approveAdjustment(adj.id, mgrUser.id);
      await postAdjustment(adj.id, mgrUser.id);
    }
  }

  // 14. Run Reconciliation & Verify Inventory Health Report
  console.log("\n[12/12] Running Final WMS Health Report & Verification...");
  const healthReport = await getInventoryHealthReport();

  console.log("\n==================================================");
  console.log("  SEED EXECUTION COMPLETED SUCCESSFULLY           ");
  console.log("==================================================");
  console.log(`  Health Score:      ${healthReport.healthScore}%`);
  console.log(`  Overall Status:    ${healthReport.status}`);
  console.log(`  Critical Issues:   ${healthReport.summary.criticalIssuesCount}`);
  console.log(`  Warning Issues:    ${healthReport.summary.warningIssuesCount}`);
  console.log("==================================================\n");

  if (healthReport.summary.criticalIssuesCount > 0) {
    console.error("❌ Critical inventory health issues detected! Seed verification failed.");
    process.exit(1);
  }
}

main()
  .catch((err) => {
    console.error("❌ Seed Script Error:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
