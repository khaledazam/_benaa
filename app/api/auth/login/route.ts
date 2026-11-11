/**
 * Login API Route Handler
 * POST /api/auth/login: validates email/password with Zod, checks user in DB, compares password
 * with bcrypt, then issues a JWT and sets it in a cookie (session_id) for subsequent requests.
 */

import { NextRequest, NextResponse } from "next/server";
import { effectivePermissions } from '@/lib/auth/permissions';
import bcrypt from "bcryptjs";
import { withRateLimit, defaultRateLimits } from "@/lib/api/rate-limit";
import { generateToken, sessionCookieOptions, isAccountAccessAllowed } from "@/utils/auth";
import { loginBodySchema } from "@/lib/validations";
import { normalizeIdentity } from '@/lib/auth/identity';
import { createCorsHeaders, handleCorsPreflight } from "@/lib/api/cors";
import { logger } from "@/lib/logger";
import { prisma } from "@/prisma/client";
import { issueMobileSession } from '@/lib/auth/mobileSessions';

/**
 * POST /api/auth/login
 * Authenticate user and create session
 */
export async function POST(request: NextRequest) {
  try {
    // Consume the stream once. Some instrumented Request implementations share
    // the body stream with clones; admission and validation use the same value.
    const body = await request.json();
    const limited = await withRateLimit(request, defaultRateLimits.auth, undefined, body);
    if (limited) return limited;

    // Handle CORS
    const responseHeaders = createCorsHeaders(request);

    // Parse and validate request body

    if (!body || typeof body !== "object") {
      return NextResponse.json(
        { error: "Invalid request body" },
        { status: 400, headers: responseHeaders },
      );
    }

    const validationResult = loginBodySchema.safeParse(body);
    if (!validationResult.success) {
      logger.warn("Invalid login data", {
        errors: validationResult.error.issues,
      });
      return NextResponse.json(
        {
          error: "Invalid request body",
          details: validationResult.error.issues,
        },
        { status: 400, headers: responseHeaders },
      );
    }

    const { email, password } = validationResult.data;

    // Find user by email or username
    const identity = normalizeIdentity(email);
    const candidates = await prisma.user.findMany({
      where: {
        OR: [
          { email: { equals: identity, mode: 'insensitive' } },
          { username: { equals: identity, mode: 'insensitive' } },
        ],
      },
      take: 2,
    });
    // Historical case/cross-field collisions must be resolved explicitly.
    const user = candidates.length === 1 ? candidates[0] : null;

    if (!user) {
      return NextResponse.json(
        { error: "البريد الإلكتروني أو كلمة المرور غير صحيحة" },
        { status: 401, headers: responseHeaders },
      );
    }

    if (!user.password) {
      return NextResponse.json(
        { error: "User data corrupted: password missing" },
        { status: 500, headers: responseHeaders },
      );
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      return NextResponse.json(
        { error: "البريد الإلكتروني أو كلمة المرور غير صحيحة" },
        { status: 401, headers: responseHeaders },
      );
    }

    // Check account active status
    if (user.status === false) {
      return NextResponse.json(
        { error: "تم تعطيل هذا الحساب من قِبل المدير العام. يرجى مراجعة الإدارة" },
        { status: 403, headers: responseHeaders },
      );
    }

    // Check subscription dates (Tamper prevention)
    const now = new Date();
    if (user.subscriptionEndDate && new Date(user.subscriptionEndDate) < now) {
      return NextResponse.json(
        { error: "انتهت فترة اشتراك هذا الحساب. يرجى تجديد الاشتراك للاستمرار" },
        { status: 403, headers: responseHeaders },
      );
    }

    if (!isAccountAccessAllowed(user)) return NextResponse.json({ error: "Account access is not active" }, { status: 403, headers: responseHeaders });

    if (!user.id) {
      return NextResponse.json(
        { error: "User data corrupted: id missing" },
        { status: 500, headers: responseHeaders },
      );
    }

    // Generate token
    const mobile = request.headers.get('x-benaa-client') === 'android'
      ? await issueMobileSession(prisma, user) : null;
    const token = mobile?.sessionId ?? generateToken(user.id, user.sessionVersion ?? 0);

    if (!token) {
      return NextResponse.json(
        { error: "Failed to generate session token" },
        { status: 500, headers: responseHeaders },
      );
    }

    // Determine if connection is secure
    const isSecure =
      request.headers.get("x-forwarded-proto") === "https" ||
      process.env.NODE_ENV !== "development";

    // Role for access control; existing users without role default to "user"
    const userRole = user.role ?? "user";

    // Create response
    const response = NextResponse.json(
      {
        userId: user.id,
        userName: user.name,
        userEmail: user.email,
        username: user.username,
        userRole,
        sessionId: token,
        ...(mobile ? { refreshToken: mobile.refreshToken, expiresIn: mobile.expiresIn } : {}),
        status: user.status,
        isSubscriptionActive: !user.subscriptionEndDate || new Date(user.subscriptionEndDate) >= now,
        subscriptionStartDate: user.subscriptionStartDate,
        subscriptionEndDate: user.subscriptionEndDate,
        primaryWarehouseId: user.primaryWarehouseId,
        warehouseIds: user.warehouseIds,
        permissions: user.permissions,
        permissionsRestricted: user.permissionsRestricted,
        effectivePermissions: effectivePermissions(user),
      },
      { status: 200, headers: responseHeaders },
    );

    // REQ-0134: JWT + cookie both 1d via sessionCookieOptions (was 1h — idle logout)
    if (!mobile) response.cookies.set("session_id", token, sessionCookieOptions(isSecure));
    response.headers.set('Cache-Control', 'no-store');

    return response;
  } catch (error) {
    logger.error("Login error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

/**
 * OPTIONS /api/auth/login
 * Handle CORS preflight requests
 */
/**
 * OPTIONS /api/auth/login
 * Handle CORS preflight requests
 */
export async function OPTIONS(request: NextRequest) {
  return handleCorsPreflight(request);
}
