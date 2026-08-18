import { NextRequest, NextResponse } from "next/server";

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
    "/((?!_next/static|_next/image|favicon\\.ico|images|api/auth).*)",
  ],
};