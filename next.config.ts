import { withSentryConfig } from "@sentry/nextjs/config";
import type { NextConfig } from "next";
import { SENTRY_TUNNEL_PATH } from "./lib/monitoring/sentry-config";
import { buildNextProductionHeaderRules } from "./lib/vercel/production-headers";
import { MAX_PRODUCT_IMPORT_REQUEST_BYTES } from "./lib/import/limits";

const auditDirectory = process.env.BENAA_LOCAL_AUDIT_DIST_DIR;
if (auditDirectory && !/^\.next-codex-[a-z0-9-]+$/.test(auditDirectory)) {
  throw new Error("Invalid local audit build directory");
}

const nextConfig: NextConfig = {
  output: 'standalone',
  // A sibling audit snapshot must not trace files from the outer workspace.
  outputFileTracingRoot: auditDirectory ? process.cwd() : undefined,
  webpack(config, {dev}) {
    // Disposable audit builds need no persistent compilation cache. This avoids
    // duplicating gigabytes of cache beside the preserved release artifacts.
    if (auditDirectory && !dev) config.cache = false;
    return config;
  },
  distDir: auditDirectory || ".next",
  reactStrictMode: true,

  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "robohash.org",
      },
      {
        protocol: "https",
        hostname: "ik.imagekit.io",
      },
      {
        protocol: "https",
        hostname: "**.googleusercontent.com",
        pathname: "/**",
      },
    ],
    formats: ["image/avif", "image/webp"],
  },

  compiler: {
    removeConsole: process.env.NODE_ENV === "production",
  },

  poweredByHeader: false,

  experimental: {
    proxyClientMaxBodySize: MAX_PRODUCT_IMPORT_REQUEST_BYTES,
    optimizePackageImports: ["@/components", "@/lib"],
  },

  // Security + /_next/static immutable cache — see lib/vercel/production-headers.ts
  async headers() {
    return buildNextProductionHeaderRules();
  },
};

export default withSentryConfig(nextConfig, {
  telemetry: false,
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT ?? "buildstock",
  silent: !process.env.CI,
  widenClientFileUpload: true,
  // First-party tunnel — must match `tunnel` in instrumentation-client.ts (SENTRY_TUNNEL_PATH)
  tunnelRoute: SENTRY_TUNNEL_PATH,
  webpack: {
    automaticVercelMonitors: true,
    treeshake: {
      removeDebugLogging: true,
    },
  },
});
