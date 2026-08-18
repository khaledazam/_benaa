import { NextResponse } from "next/server";
import { prisma } from "@/prisma/client";
import bcrypt from "bcryptjs";

export async function GET() {
  return handleSeed();
}

export async function POST() {
  return handleSeed();
}

async function handleSeed() {
  try {
    const now = new Date();
    const defaultPasswordHash = await bcrypt.hash("BuildStock@2026", 10);
    const khaledPasswordHash = await bcrypt.hash("102003000@", 10);

    // 1. Seed Operational Users
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

    // 2. Seed Warehouses
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

    // 3. Seed Categories
    const categoriesData = [
      { name: "Porcelain & Ceramic Tiles", description: "High-grade floor and wall tiles" },
      { name: "Decorative Paints & Finishes", description: "Interior & exterior washable paint" },
      { name: "Sanitary Ware & Faucets", description: "Premium bathroom fixtures and mixers" },
      { name: "Marble & Natural Stone", description: "Imported and local marble slabs" },
      { name: "Architectural Lighting", description: "LED linear lights and recessed spots" },
    ];

    const categories: Record<string, any> = {};
    for (const c of categoriesData) {
      let cat = await prisma.category.findFirst({ where: { name: c.name } });
      if (!cat) {
        cat = await prisma.category.create({
          data: {
            name: c.name,
            description: c.description,
            userId: adminUser.id,
            createdBy: adminUser.id,
            createdAt: now,
          },
        });
      }
      categories[c.name] = cat;
    }

    // 4. Seed Suppliers
    const suppliersData = [
      { name: "Al-Gawhara Porcelain Co.", contactPerson: "Eng. Hassan Al-Gawhara", email: "sales@gawhara-tile.com", phone: "+20 100 111 2233" },
      { name: "Jotun Paints Egypt", contactPerson: "Nader El-Sayed", email: "orders@jotun.com.eg", phone: "+20 111 444 5566" },
      { name: "Ideal Standard Egypt", contactPerson: "Tarek Fathy", email: "b2b@idealstandard.eg", phone: "+20 122 777 8899" },
      { name: "Cleopatra Group Ceramics", contactPerson: "Ahmed Cleopatra", email: "export@cleopatra.eg", phone: "+20 100 999 0000" },
      { name: "Marble Art Egypt", contactPerson: "Mustafa Marble", email: "info@marbleart-eg.com", phone: "+20 155 333 1122" },
    ];

    const suppliers: Record<string, any> = {};
    for (const s of suppliersData) {
      let sup = await prisma.supplier.findFirst({ where: { name: s.name } });
      if (!sup) {
        sup = await prisma.supplier.create({
          data: {
            name: s.name,
            contactName: s.contactPerson,
            email: s.email,
            phone: s.phone,
            status: true,
            userId: adminUser.id,
            createdBy: adminUser.id,
            createdAt: now,
          },
        });
      }
      suppliers[s.name] = sup;
    }

    // 5. Seed Products with Realistic Stock & Pricing
    const productsData = [
      { sku: "PORC-60120-SPANISH", name: "Spanish Calacatta Porcelain Tile 60x120cm", price: 850, purchasePrice: 520, quantity: 1500, minimumStock: 200, category: "Porcelain & Ceramic Tiles", supplier: "Al-Gawhara Porcelain Co." },
      { sku: "JOTUN-FENO-WHITE", name: "Jotun Fenomastic Pure Matt Paint 18L", price: 2450, purchasePrice: 1800, quantity: 450, minimumStock: 50, category: "Decorative Paints & Finishes", supplier: "Jotun Paints Egypt" },
      { sku: "IDEAL-MIX-CHROME", name: "Ideal Standard Cerafine Brass Mixer Chrome", price: 3200, purchasePrice: 2100, quantity: 180, minimumStock: 30, category: "Sanitary Ware & Faucets", supplier: "Ideal Standard Egypt" },
      { sku: "MARBLE-CARRARA-SLAB", name: "Italian Carrara White Marble Slab 2cm", price: 4200, purchasePrice: 2900, quantity: 85, minimumStock: 15, category: "Marble & Natural Stone", supplier: "Marble Art Egypt" },
      { sku: "LED-LINEAR-30W", name: "Recessed Architectural LED Linear Light 30W 4000K", price: 980, purchasePrice: 620, quantity: 600, minimumStock: 100, category: "Architectural Lighting", supplier: "Al-Gawhara Porcelain Co." },
      { sku: "PORC-6060-GREY", name: "Cleopatra High-Gloss Grey Tile 60x60cm", price: 420, purchasePrice: 280, quantity: 2800, minimumStock: 300, category: "Porcelain & Ceramic Tiles", supplier: "Cleopatra Group Ceramics" },
      { sku: "JOTUN-JOTASHIELD", name: "Jotun Jotashield Extreme Exterior Paint 18L", price: 3100, purchasePrice: 2300, quantity: 220, minimumStock: 40, category: "Decorative Paints & Finishes", supplier: "Jotun Paints Egypt" },
      { sku: "ROCA-WALL-HUNG", name: "Roca Debba Wall-Hung Toilet with Soft-Close Seat", price: 5800, purchasePrice: 3900, quantity: 95, minimumStock: 20, category: "Sanitary Ware & Faucets", supplier: "Ideal Standard Egypt" },
    ];

    const seededProducts: any[] = [];
    for (const p of productsData) {
      const cat = categories[p.category];
      const sup = suppliers[p.supplier];

      let prod = await prisma.product.findUnique({ where: { sku: p.sku } });
      if (!prod) {
        prod = await prisma.product.create({
          data: {
            sku: p.sku,
            name: p.name,
            price: p.price,
            purchasePrice: p.purchasePrice,
            quantity: p.quantity,
            reservedQuantity: 30,
            minimumStock: p.minimumStock,
            categoryId: cat?.id || adminUser.id,
            supplierId: sup?.id || adminUser.id,
            userId: adminUser.id,
            createdBy: adminUser.id,
            status: "active",
            isActive: true,
            createdAt: now,
          },
        });
      } else {
        prod = await prisma.product.update({
          where: { id: prod.id },
          data: {
            quantity: p.quantity,
            reservedQuantity: 30,
            minimumStock: p.minimumStock,
            price: p.price,
            purchasePrice: p.purchasePrice,
          },
        });
      }
      seededProducts.push(prod);
    }

    return NextResponse.json({
      success: true,
      message: "BuildStock realistic production data seeded successfully!",
      stats: {
        users: Object.keys(seededUsers).length,
        warehouses: Object.keys(warehouses).length,
        categories: Object.keys(categories).length,
        suppliers: Object.keys(suppliers).length,
        products: seededProducts.length,
      },
    });
  } catch (error: any) {
    console.error("Seed API Error:", error);
    return NextResponse.json(
      { success: false, error: error.message || String(error) },
      { status: 500 }
    );
  }
}
