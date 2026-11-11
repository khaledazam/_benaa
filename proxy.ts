import { NextRequest, NextResponse } from "next/server";
import { createCorsHeaders, isAllowedOrigin } from "@/lib/api/cors";
import { MAX_PRODUCT_IMPORT_REQUEST_BYTES } from "@/lib/import/limits";

/**
 * Protected path prefixes requiring authentication.
 */
const PROTECTED_PATHS = [
  "/admin",
  "/dashboard",
  "/products",
  "/categories",
  "/warehouses",
  "/inventory",
  "/suppliers",
  "/purchasing",
  "/reports",
  "/orders",
  "/invoices",
  "/settings",
  "/business-insights",
  "/support-tickets",
  "/client",
  "/supplier",
];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname.startsWith("/api/")) {
    const origin = request.headers.get("origin");
    const headers = createCorsHeaders(request);
    const requestId = crypto.randomUUID();
    headers.set('X-Benaa-Request-Id', requestId);
    if (origin && origin !== request.nextUrl.origin && !isAllowedOrigin(origin)) {
      return NextResponse.json({ error: "Web origin is not authorized" }, { status: 403, headers });
    }
    if (request.method === "OPTIONS") return new NextResponse(null, { status: 204, headers });
    if (pathname === '/api/products/import') {
      const length = request.headers.get('content-length');
      if (length && (!/^\d+$/.test(length) || Number(length) > MAX_PRODUCT_IMPORT_REQUEST_BYTES)) {
        return NextResponse.json({ error: 'Import request exceeds the bounded upload limit' }, { status: 413, headers });
      }
    }
    // Operator-controlled emergency containment. Authentication/logout remain
    // available; business mutations and payment webhooks receive a retryable 503.
    if (process.env.BENAA_WRITE_DISABLED === "true" &&
        !["GET", "HEAD"].includes(request.method) &&
        !["/api/auth/login", "/api/auth/logout", "/api/auth/refresh"].includes(pathname)) {
      headers.set("Retry-After", "60");
      headers.set("Cache-Control", "no-store");
      return NextResponse.json({ error: "Business writes are temporarily disabled", code: "WRITES_DISABLED" }, { status: 503, headers });
    }
    const forwarded = new Headers(request.headers);
    forwarded.set('X-Benaa-Request-Id', requestId);
    const response = NextResponse.next({ request: { headers: forwarded } });
    headers.forEach((value, name) => response.headers.set(name, value));
    return response;
  }


  const isProtectedPath = PROTECTED_PATHS.some(
    (prefix) =>
      pathname === prefix || pathname.startsWith(`${prefix}/`)
  );

  // Public route
  if (!isProtectedPath) {
    return NextResponse.next();
  }

  // Check session cookie
  const sessionToken = request.cookies.get("session_id")?.value;

  if (
    !sessionToken ||
    sessionToken === "null" ||
    sessionToken === "undefined"
  ) {
    const loginUrl = new URL("/login", request.url);

    loginUrl.searchParams.set(
      "callbackUrl",
      pathname
    );

    return NextResponse.redirect(loginUrl);
  }

  // Security headers
  const response = NextResponse.next();

  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set(
    "Referrer-Policy",
    "strict-origin-when-cross-origin"
  );

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.ico|images).*)",
  ],
};
