import { PrismaClient } from "@prisma/client";

/**
 * Prisma Client Singleton
 * Prevents connection exhaustion by reusing the same instance
 * Connection pooling is configured in the connection string
 * Example: DATABASE_URL="mongodb://...?maxPoolSize=10"
 */

// PrismaClient is attached to the `global` object in development
// to prevent exhausting database connections during hot reloads
declare global {
  var prisma: PrismaClient | undefined;
}

// Only initialize Prisma on server-side
const isServer = typeof window === "undefined";

let defaultPrisma: PrismaClient | undefined;
function currentClient(): PrismaClient {
  if(process.env.BENAA_TEST_RUN_ID && (globalThis.prisma as any)?.__benaaTestFenceRunId !== process.env.BENAA_TEST_RUN_ID) {
    throw new Error('BENAA authorized test fence is not initialized');
  }
  // Importing a service must not open the .env database before an isolated
  // runner has selected its explicit datasource. Connection is demand-driven.
  if (globalThis.prisma) return globalThis.prisma;
  defaultPrisma ??= new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
  if (process.env.NODE_ENV !== "production") globalThis.prisma = defaultPrisma;
  return defaultPrisma;
}

export const prisma = isServer
  ? new Proxy({} as PrismaClient, {
      get(_target, prop) {
        const client = currentClient();
        const val = (client as any)[prop];
        return typeof val === "function" ? val.bind(client) : val;
      },
    })
  : ({} as PrismaClient);

export default prisma;
