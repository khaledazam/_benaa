/**
 * Next.js instrumentation: Sentry (node + edge) and app services (Redis, QStash).
 */

import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    if(process.env.BENAA_TEST_RUN_ID && process.env.NEXT_PHASE !== 'phase-production-build') {
      const uri=new URL(process.env.DATABASE_URL || '');
      if(process.env.BENAA_TEST_EXISTING_DATABASE_APPROVED!=='true' || uri.hostname!=='cluster0.kp7wfjx.mongodb.net' || uri.pathname!=='/buildstock_db') {
        throw new Error('Authorized Atlas test target declaration required');
      }
      const [{PrismaClient,Prisma},{authorizedAtlasFence}]=await Promise.all([
        import('@prisma/client'),import('./lib/testing/authorized-atlas-fence')]);
      globalThis.prisma=authorizedAtlasFence(new PrismaClient(),Prisma.dmmf.datamodel.models,
        process.env.BENAA_TEST_REGISTRY || '',process.env.BENAA_TEST_RUN_ID);
    }
    if (process.env.NODE_ENV === 'production' && process.env.NEXT_PHASE !== 'phase-production-build') {
      try {
        const { validateRuntimeConfiguration } = await import('./lib/runtime/config');
        validateRuntimeConfiguration();
      } catch (error) {
        // Log configuration advisory without terminating the serverless worker
        console.warn(`${error instanceof Error ? error.message : 'Unsafe runtime configuration'}`);
      }
    }
    try {
      await import("./sentry.server.config");
    } catch {
      // Sentry optional when DSN missing
    }

    try {
      const { initializeRedis } = await import("@/lib/cache/redis");
      initializeRedis();

      const { getRedis, isRedisConfigured } = await import("@/lib/cache/redis");
      if (isRedisConfigured()) {
        const redis = getRedis();
        if (redis) {
          redis
            .exists("app:start_time")
            .then((exists) => {
              if (!exists) {
                redis
                  .set("app:start_time", new Date().toISOString())
                  .catch(() => {});
              }
            })
            .catch(() => {});
        }
      }
    } catch {
      // Redis optional
    }

    try {
      const { initializeQStash } = await import("@/lib/queue/qstash");
      initializeQStash();
    } catch {
      // QStash optional
    }
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    try {
      await import("./sentry.edge.config");
    } catch {
      // Sentry optional when DSN missing
    }
  }
}

/** App Router: report unhandled request errors to Sentry */
export const onRequestError = Sentry.captureRequestError;
