import { afterEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";
import { createCorsHeaders, isAllowedOrigin } from "./cors";
afterEach(() => vi.unstubAllEnvs());
it("permits only exact configured web origins in production, never the unrelated legacy host", () => {
  vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("BENAA_ALLOWED_ORIGINS", "https://benaa.example");
  expect(isAllowedOrigin("https://benaa.example")).toBe(true);
  for (const origin of ["https://benaa.example.attacker.invalid", "https://benaa.example/path", "https://stockly-inventory.vercel.app", "http://localhost:3218", "null"]) expect(isAllowedOrigin(origin)).toBe(false);
});
it("serves authorized bearer/idempotency preflight for new project and sync APIs", () => {
  vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("BENAA_ALLOWED_ORIGINS", "https://benaa.example");
  for (const path of ["/api/projects/material-issues", "/api/mobile-sync", "/api/auth/login"]) {
    const response = proxy(new NextRequest("https://api.example" + path, { method: "OPTIONS", headers: { origin: "https://benaa.example" } }));
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("https://benaa.example");
    expect(response.headers.get("access-control-allow-headers")).toContain("Idempotency-Key");
  }
});
it("rejects unauthorized browser origins before invoking any route handler", () => {
  vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("BENAA_ALLOWED_ORIGINS", "https://benaa.example");
  expect(proxy(new NextRequest("https://api.example/api/projects", { method: "POST", headers: { origin: "https://foreign.invalid" } })).status).toBe(403);
  expect(createCorsHeaders(new NextRequest("https://api.example/api/projects", { headers: { origin: "https://foreign.invalid" } })).has("access-control-allow-origin")).toBe(false);
});
