/**
 * BUILDSTOCK — PERSISTENT IN-MEMORY MONGODB SERVER FOR DEV & LOCAL RUN
 * Runs a local MongoDB ReplicaSet on port 27017, pushes schema, seeds data, and keeps running for dev mode.
 */

import { MongoMemoryServer } from "mongodb-memory-server";
import { execSync } from "child_process";

async function run() {
  console.log("\n⚡ Starting Local MongoDB Server...\n");
  
  let mongod: MongoMemoryServer | null = null;
  try {
    mongod = await MongoMemoryServer.create({
      instance: { port: 27017 },
    });

    const baseUri = mongod.getUri();
    const uri = `${baseUri}buildstock_db?directConnection=true`;

    // Persist active DATABASE_URL to .env file for Next.js dev server
    const fs = await import("fs");
    const path = await import("path");
    const envPath = path.join(process.cwd(), ".env");
    let envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf-8") : "";
    if (envContent.includes("DATABASE_URL=")) {
      envContent = envContent.replace(/DATABASE_URL=.*(\r?\n|$)/, `DATABASE_URL="${uri}"\n`);
    } else {
      envContent = `DATABASE_URL="${uri}"\n` + envContent;
    }
    fs.writeFileSync(envPath, envContent, "utf-8");

    process.env.DATABASE_URL = uri;
    process.env.SEED_MODE = "realistic";
    process.env.ALLOW_REALISTIC_SEED = "true";

    console.log(`✅ Local MongoDB Server is ONLINE at: ${uri}`);
    console.log("   (Connected to MongoDB replica set on port 27017)\n");

    console.log("🔄 Synchronizing Prisma Database Schema...");
    execSync("npx prisma db push --skip-generate", { stdio: "inherit", env: process.env });

    console.log("\n🌱 Seeding Production-Like Data & Users...");
    execSync("npx tsx scripts/seed-realistic-data.ts", { stdio: "inherit", env: process.env });

    console.log("\n🔍 Validating Seed Integrity...");
    execSync("npx tsx scripts/validate-realistic-seed.ts", { stdio: "inherit", env: process.env });

    console.log("\n🚀 MongoDB is READY and RUNNING! Leave this running for your app dev server.");
    console.log("   Login Credentials:");
    console.log("   - Email:    khaled@admin.com");
    console.log("   - Password: 102003000@\n");

    // Keep process alive so MongoDB server stays running for dev server
    await new Promise(() => {});

  } catch (err: any) {
    console.error("❌ Local MongoDB Server Error:", err.message || err);
    if (mongod) await mongod.stop();
    process.exit(1);
  }
}

run();
