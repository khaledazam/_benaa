/** Operator-run initialization of a NEW empty database. No drop/delete/reset. */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";

async function main() {
  if (process.env.BENAA_INITIALIZE_EMPTY_DATABASE !== "ACKNOWLEDGED") throw new Error("Initialization is opt-in and requires operator approval");
  const url = process.env.BENAA_INIT_DATABASE_URL;
  const email = process.env.BENAA_INIT_OWNER_EMAIL;
  const password = process.env.BENAA_INIT_OWNER_PASSWORD;
  if (!url || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !password || password.length < 12) throw new Error("Explicit target, owner email and strong password are required; no defaults");
  const warehouses = JSON.parse(process.env.BENAA_INIT_WAREHOUSES_JSON || "[]");
  if (!Array.isArray(warehouses) || warehouses.some((w: any) => !w.name || typeof w.name !== "string" || !w.code || typeof w.code !== "string") || new Set(warehouses.map((w: any) => w.code)).size !== warehouses.length) throw new Error("Warehouse definitions must have unique explicit codes and names");
  const db = new PrismaClient({ datasources: { db: { url } } });
  try {
    const inventory: any = await db.$runCommandRaw({ listCollections: 1, nameOnly: true });
    for (const collection of inventory.cursor.firstBatch) {
      const count: any = await db.$runCommandRaw({ count: collection.name, query: {} });
      if (count.n !== 0) throw new Error("Initialization refuses a database containing any records");
    }
    // An operator must provision the reviewed Prisma indexes on the NEW empty
    // target first. Initialization never substitutes for schema/index validation.
    for (const [collection, field] of [["User", "email"], ["Product", "sku"], ["InventoryOperation", "operationKey"]]) {
      const indexes: any = await db.$runCommandRaw({ listIndexes: collection });
      if (!indexes.cursor.firstBatch.some((index: any) => index.unique === true && index.key[field!] === 1 && Object.keys(index.key).length === 1)) throw new Error("Required schema uniqueness index is missing");
    }
    const hash = await bcrypt.hash(password, 12);
    await db.$transaction(async tx => {
      const owner = await tx.user.create({ data: { email, username: email.split("@")[0], name: process.env.BENAA_INIT_OWNER_NAME || "BENAA Owner", password: hash, role: "SUPER_ADMIN", status: true, createdAt: new Date() } });
      for (const warehouse of warehouses) await tx.warehouse.create({ data: { name: warehouse.name, code: warehouse.code, address: warehouse.address || null, userId: owner.id, createdBy: owner.id, status: true } });
      await tx.auditLog.create({ data: { userId: owner.id, action: "database_initialized", entityType: "System", details: { runId: randomUUID(), warehouseCount: warehouses.length } } });
    });
    console.log("Empty database initialized; owner and configured warehouses created. No stock, money, invoices or demo customers seeded.");
  } finally { await db.$disconnect(); }
}
main().catch(() => { console.error("Initialization refused or failed; inspect target state with the authorized operator before retrying. No credentials are logged."); process.exitCode = 1; });
