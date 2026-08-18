/**
 * BUILDSTOCK — IN-MEMORY DATABASE RUNNER FOR SEEDING & VALIDATION
 * Uses mongodb-memory-server (ReplicaSet) to start a local MongoDB instance on port 27017
 * if a standalone MongoDB instance is not already running.
 */

import { MongoMemoryReplSet } from "mongodb-memory-server";
import { execSync } from "child_process";

async function run() {
  console.log("\n⚡ Initializing Local MongoDB ReplicaSet Engine for Seeding...\n");
  
  let replSet: MongoMemoryReplSet | null = null;
  try {
    replSet = await MongoMemoryReplSet.create({
      instanceOpts: [{ storageEngine: "wiredTiger" }],
      replSet: { name: "rs0", dbName: "buildstock_db" },
    });

    let uri = replSet.getUri();
    if (!uri.includes("/buildstock_db")) {
      uri = uri.replace("/?", "/buildstock_db?");
    }
    process.env.DATABASE_URL = uri;
    process.env.SEED_MODE = "realistic";
    process.env.ALLOW_REALISTIC_SEED = "true";

    console.log(`✅ In-Memory MongoDB Server online at: ${uri}\n`);

    console.log("🔄 Executing Prisma DB Push...");
    execSync("npx prisma db push --skip-generate", { stdio: "inherit", env: process.env });

    console.log("\n🌱 Executing Realistic Seed Engine...");
    execSync("npx tsx scripts/seed-realistic-data.ts", { stdio: "inherit", env: process.env });

    console.log("\n🔍 Executing Seed Validation Audit...");
    execSync("npx tsx scripts/validate-realistic-seed.ts", { stdio: "inherit", env: process.env });

  } catch (err: any) {
    console.error("❌ Memory DB Runner Error:", err.message || err);
    process.exit(1);
  } finally {
    if (replSet) {
      console.log("\n🧹 Stopping In-Memory MongoDB ReplicaSet Engine...");
      await replSet.stop();
      console.log("✔ Cleanup complete.");
    }
  }
}

run();
