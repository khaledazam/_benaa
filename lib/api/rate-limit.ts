/**
 * API Rate Limiting Helper
 * Utilities for rate limiting in API route handlers
 */

import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, type RateLimitResult } from "@/lib/cache";
import { verifyToken } from "@/utils/auth";
import { createHash } from "node:crypto";
import { logger } from "@/lib/logger";

/**
 * Rate limit configuration for API routes
 */
export interface ApiRateLimitConfig {
  /**
   * Maximum number of requests allowed per window
   */
  limit: number;
  /**
   * Time window in seconds
   */
  window: number;
  /**
   * Get identifier from request (e.g., user ID, IP address)
   */
  getIdentifier: (request: NextRequest) => string | Promise<string>;
}

export function loginRateLimitIdentifier(body: unknown): string {
  const value=body && typeof body==='object' ? body as Record<string,unknown> : {};
  const identity=String(value.email || value.username || '').normalize('NFKC').trim().toLowerCase();
  return 'login:' + createHash('sha256').update(identity).digest('hex');
}

/**
 * Default rate limit configurations
 */
function signedIdentity(request: NextRequest): string {
  const token = request.cookies.get('session_id')?.value || request.headers.get('authorization')?.replace(/^Bearer /, '');
  const decoded = token ? verifyToken(token) : null;
  // Never trust x-user-id or caller-controlled IP headers. Unauthenticated work
  // has a shared coarse bucket; login additionally has a per-identity bucket.
  return decoded ? 'user:' + decoded.userId : 'public:' + request.nextUrl.pathname;
}

export const defaultRateLimits = {
  /**
   * Standard API rate limit (600 requests per minute per user/IP).
   * Each page navigation fires ~4-5 API calls; fast clicking 10+ pages should never 429.
   */
  standard: { limit: 600, window: 60, getIdentifier: signedIdentity },
  strict: { limit: 10, window: 60, getIdentifier: signedIdentity },
  auth: {
    limit: 5, window: 60,
    getIdentifier: async (request: NextRequest) => {
      try { return loginRateLimitIdentifier(await request.clone().json()); } catch { return loginRateLimitIdentifier(null); }
    },
  },
} as const;

/**
 * Rate limit middleware for API routes
 * Returns NextResponse with rate limit headers if exceeded
 *
 * @param request - Next.js request object
 * @param config - Rate limit configuration
 * @param overrideIdentifier - Optional: use this instead of getIdentifier (e.g. session user id) for per-user limits
 * @returns Promise<NextResponse | null> - Error response if rate limited, null if allowed
 */
export async function withRateLimit(
  request: NextRequest,
  config: ApiRateLimitConfig,
  overrideIdentifier?: string,
  parsedLoginBody?: unknown
): Promise<NextResponse | null> {
  try {
    const identifier =
      overrideIdentifier != null
        ? `user:${overrideIdentifier}`
        : config === defaultRateLimits.auth && parsedLoginBody !== undefined
          ? loginRateLimitIdentifier(parsedLoginBody) : await config.getIdentifier(request);
    if (config === defaultRateLimits.auth) {
      const coarse = await checkRateLimit({ limit: 100, window: 60, identifier: 'public:login-admission' });
      if (!coarse.allowed) return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429, headers: { 'Retry-After': String(coarse.reset) } });
    }
    const result = await checkRateLimit({
      limit: config.limit,
      window: config.window,
      identifier,
    });

    // Add rate limit headers to response
    const headers = new Headers();
    headers.set("X-RateLimit-Limit", config.limit.toString());
    headers.set("X-RateLimit-Remaining", Math.max(0, config.limit - result.current).toString());
    headers.set("X-RateLimit-Reset", (Date.now() / 1000 + result.reset).toString());

    if (!result.allowed) {
      logger.warn(`Rate limit exceeded for ${identifier}: ${result.current}/${config.limit}`);
      return NextResponse.json(
        {
          success: false,
          error: "Rate limit exceeded",
          message: `Too many requests. Please try again in ${result.reset} seconds.`,
          retryAfter: result.reset,
        },
        {
          status: 429,
          headers,
        }
      );
    }

    // Return null to indicate request is allowed
    // The actual response should include the rate limit headers
    return null;
  } catch (error) {
    logger.error("Rate limit check failed:", error);
    if (process.env.NODE_ENV === 'production') return NextResponse.json(
      { error: 'Request protection temporarily unavailable' },
      { status: 503, headers: { 'Retry-After': '30', 'Cache-Control': 'no-store' } });
    return null;
  }
}

/**
 * Add rate limit headers to response
 *
 * @param response - Next.js response object
 * @param result - Rate limit result
 * @param limit - Rate limit configuration
 */
export function addRateLimitHeaders(
  response: NextResponse,
  result: RateLimitResult,
  limit: number
): void {
  response.headers.set("X-RateLimit-Limit", limit.toString());
  response.headers.set("X-RateLimit-Remaining", Math.max(0, limit - result.current).toString());
  response.headers.set("X-RateLimit-Reset", (Date.now() / 1000 + result.reset).toString());
}
