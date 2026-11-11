import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";

afterEach(() => vi.unstubAllEnvs());
describe("operator emergency business write containment", () => {
  it("bounds multipart transport above the 10 MiB file limit without truncation", () => {
    vi.stubEnv('BENAA_WRITE_DISABLED', 'false');
    const request=(size:number)=>new NextRequest('http://localhost/api/products/import',{method:'POST',headers:{'Content-Length':String(size)}});
    expect(proxy(request(10*1024*1024+1024)).status).toBe(200);
    expect(proxy(request(12*1024*1024+1)).status).toBe(413);
  });
  it("blocks every business mutation verb with a retryable uncached response", () => {
    vi.stubEnv("BENAA_WRITE_DISABLED", "true");
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const response = proxy(new NextRequest("http://localhost/api/orders", { method }));
      expect(response.status).toBe(503);
      expect(response.headers.get("Retry-After")).toBe("60");
      expect(response.headers.get("Cache-Control")).toBe("no-store");
    }
  });
  it("preserves reads, preflight, login and logout during containment", () => {
    vi.stubEnv("BENAA_WRITE_DISABLED", "true");
    for (const [path, method] of [["orders", "GET"], ["orders", "HEAD"], ["auth/login", "POST"], ["auth/logout", "POST"]]) {
      expect(proxy(new NextRequest(`http://localhost/api/${path}`, { method })).status).toBe(200);
    }
    expect(proxy(new NextRequest("http://localhost/api/orders", { method: "OPTIONS" })).status).toBe(204);
  });
  it("leaves normal authenticated route handling enabled when the operator flag is absent", () => {
    vi.stubEnv("BENAA_WRITE_DISABLED", "");
    expect(proxy(new NextRequest("http://localhost/api/orders", { method: "POST" })).status).toBe(200);
  });
  it("contains payment webhook writes so providers can retry after recovery", () => {
    vi.stubEnv("BENAA_WRITE_DISABLED", "true");
    expect(proxy(new NextRequest("http://localhost/api/webhooks/stripe", { method: "POST" })).status).toBe(503);
  });
});
