import type { NextRequest } from "next/server";

/** Exact operator-configured web origins; native clients still require authentication. */
export function isAllowedOrigin(origin: string | null): boolean {
 if (!origin) return false;
 let parsed: URL;
 try { parsed = new URL(origin); } catch { return false; }
 if (parsed.origin !== origin || !['http:', 'https:'].includes(parsed.protocol)) return false;
 const configured = (process.env.BENAA_ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean);
 if (configured.includes(origin)) return true;
 return process.env.NODE_ENV === 'development' && ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname);
}
export function getAllowedOrigin(origin: string | null): string {
 return origin && isAllowedOrigin(origin) ? origin : '';
}
export function createCorsHeaders(request: NextRequest): Headers {
 const origin = request.headers.get('origin');
 const headers = new Headers({Vary: 'Origin'});
 if (origin && (origin === request.nextUrl.origin || isAllowedOrigin(origin))) {
  headers.set('Access-Control-Allow-Origin', origin);
  headers.set('Access-Control-Allow-Credentials', 'true');
  headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, Idempotency-Key, X-Benaa-Client');
  headers.set('Access-Control-Expose-Headers', 'X-Benaa-Request-Id, Retry-After, X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset');
 }
 return headers;
}
export function handleCorsPreflight(request: NextRequest): Response {
 const origin = request.headers.get('origin');
 const denied = origin && origin !== request.nextUrl.origin && !isAllowedOrigin(origin);
 return new Response(null, {status: denied ? 403 : 204, headers: createCorsHeaders(request)});
}
