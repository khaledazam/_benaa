import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
vi.mock("@/lib/auth-server", () => ({ getSession: vi.fn(async () => null) }));
vi.mock("@/prisma/client", () => ({ prisma: {} }));
vi.mock("@/lib/reservations/reservationService", () => ({ getReservations: vi.fn(), createStockReservation: vi.fn() }));
vi.mock("@/lib/dispatch/dispatchService", () => ({}));
const walk = (p: string): string[] => fs.readdirSync(p, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(p, e.name)) : [path.join(p, e.name)]);
describe("legacy API session boundary", () => {
  it("every getSession API handler checks missing session before role fallback", () => {
    const files = walk(path.resolve("app/api")).filter(p => p.endsWith("route.ts"));
    let handlers = 0;
    for (const file of files) {
      const source = fs.readFileSync(file, "utf8");
      for (const match of source.matchAll(/const session = await getSession\(\);/g)) {
        handlers++;
        const following = source.slice(match.index! + match[0].length).trimStart();
        expect(following.startsWith('if (!session)'), file).toBe(true);
        expect(following.slice(0, 140), file).toContain('401');
      }
    }
    expect(handlers).toBeGreaterThan(50);
  });
  for (const routeModule of ["@/app/api/reservations/route", "@/app/api/customers/route", "@/app/api/inventory/counts/route"]) {
    it(`${routeModule} GET returns 401 without reading business data`, async () => {
      const route = await import(routeModule);
      const response = await route.GET(new NextRequest("http://localhost/api/audit"));
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "Unauthorized" });
    });
  }
});
