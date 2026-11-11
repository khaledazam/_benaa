/**
 * Authentication utilities: JWT session tokens, password hashing, and session resolution.
 * Used by API routes (getSessionFromRequest) and client (getSessionClient via /api/auth/session).
 */
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { User as PrismaUser } from "@prisma/client";
import Cookies from "js-cookie"; // Import js-cookie
import { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@/prisma/client";
import { sessionTokenDigest, recordSessionRevocation } from '@/lib/auth/sessionRevocation';

/** Secret for signing/verifying JWT; must match across server and be set in production. */
function signingSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.trim().length < 32) throw new Error("JWT_SECRET must contain at least 32 characters");
  return secret;
}
export function isAccountAccessAllowed(user: { status?: boolean | null; subscriptionStartDate?: Date | null; subscriptionEndDate?: Date | null }, now = new Date()): boolean {
  return user.status !== false && (!user.subscriptionStartDate || user.subscriptionStartDate <= now) && (!user.subscriptionEndDate || user.subscriptionEndDate > now);
}

/** Session lifetime — password login + Google OAuth share the same JWT + cookie TTL (REQ-0134). */
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24; // 1 day
export const SESSION_JWT_EXPIRES = "1d" as const;

type User = PrismaUser;

// Check if we're on the server side
const isServer = typeof window === "undefined";

/**
 * Cookie options for `session_id` — keep maxAge in sync with SESSION_JWT_EXPIRES.
 * REQ-0134: keep JWT expiresIn and cookie maxAge identical (was 1h JWT vs longer cookie).
 */
export function sessionCookieOptions(isSecure: boolean): {
  httpOnly: boolean;
  secure: boolean;
  sameSite: "lax";
  maxAge: number;
  path: string;
} {
  return {
    httpOnly: true,
    secure: isSecure,
    sameSite: "lax",
    maxAge: SESSION_MAX_AGE_SECONDS,
    path: "/",
  };
}

/** Creates a signed JWT containing userId; used after login to set session cookie. */
export const generateToken = (userId: string, sessionVersion = 0,
  mobile?: { sessionId: string }): string => {
  const token = jwt.sign({ userId, sv: sessionVersion, jti: crypto.randomUUID(),
    ...(mobile ? { msid: mobile.sessionId } : {}) }, signingSecret(), {
    algorithm: "HS256",
    expiresIn: mobile ? 15 * 60 : SESSION_JWT_EXPIRES,
  });
  return token;
};

async function mobileGrantIsCurrent(token: string, userId: string): Promise<boolean> {
  const claims = jwt.decode(token) as { msid?: unknown } | null;
  if (claims?.msid === undefined) return true; // existing web session policy
  if (typeof claims.msid !== 'string' || !/^[a-f0-9]{24}$/i.test(claims.msid)) return false;
  const grant = await prisma.mobileSession.findUnique({ where: { id: claims.msid } });
  return !!grant && grant.userId === userId && !grant.revokedAt && grant.expiresAt > new Date();
}

/** Verifies JWT and returns decoded payload (userId); returns null if invalid or on client. */
export const verifyToken = (token: string): { userId: string } | null => {
  if (!token || token === "null" || token === "undefined") {
    return null;
  }

  // Only verify tokens on the server side
  if (!isServer) {
    // On client side, we'll just return null to avoid JWT library issues
    return null;
  }

  try {
    // Check if jwt is properly imported
    if (typeof jwt === "undefined" || !jwt.verify) {
      return null;
    }

    const decoded = jwt.verify(token, signingSecret(), { algorithms: ["HS256"] });
    if (typeof decoded === "string" || typeof decoded.userId !== "string" || !/^[a-f0-9]{24}$/i.test(decoded.userId) || typeof decoded.exp !== "number") return null;
    return { userId: decoded.userId };
  } catch (error) {
    return null;
  }
};

/**
 * Get session from Pages API request
 * @deprecated Use getSessionFromRequest for App Router compatibility
 */
export const getSessionServer = async (
  req: NextApiRequest,
  res: NextApiResponse
): Promise<User | null> => {
  const token = req.cookies["session_id"];
  if (!token) {
    return null;
  }

  const decoded = verifyToken(token);
  if (!decoded) {
    return null;
  }

  const user = await prisma.user.findUnique({ where: { id: decoded.userId } });
  if (await prisma.revokedSession.findUnique({ where: { tokenDigest: await sessionTokenDigest(token) } })) return null;
  const claims = jwt.decode(token) as { sv?: number } | null;
  return user && (user.sessionVersion ?? 0) === (claims?.sv ?? 0) && isAccountAccessAllowed(user) && await mobileGrantIsCurrent(token, user.id) ? user : null;
};

/**
 * Get session from App Router NextRequest
 * Works with App Router route handlers
 */
export const getSessionFromRequest = async (request: {
  cookies?: { get: (name: string) => { value: string } | undefined };
  headers?: { get: (name: string) => string | null };
}): Promise<User | null> => {
  let token = request.cookies?.get("session_id")?.value;

  if (!token && request.headers) {
    const authHeader =
      request.headers.get("authorization") ||
      request.headers.get("Authorization");
    if (authHeader && authHeader.startsWith("Bearer ")) {
      token = authHeader.substring(7).trim();
    }
  }

  if (!token) {
    return null;
  }

  const decoded = verifyToken(token);
  if (!decoded) {
    return null;
  }

  const user = await prisma.user.findUnique({ where: { id: decoded.userId } });
  if (await prisma.revokedSession.findUnique({ where: { tokenDigest: await sessionTokenDigest(token) } })) return null;
  const claims = jwt.decode(token) as { sv?: number } | null;
  return user && (user.sessionVersion ?? 0) === (claims?.sv ?? 0) && isAccountAccessAllowed(user) && await mobileGrantIsCurrent(token, user.id) ? user : null;
};

/** Idempotent logout of one verified token, without invalidating other devices. */
export async function revokePresentedSession(request: {
  cookies?: { get: (name: string) => { value: string } | undefined };
  headers?: { get: (name: string) => string | null };
}): Promise<void> {
  const token = request.cookies?.get('session_id')?.value || request.headers?.get('authorization')?.replace(/^Bearer /, '').trim();
  if (!token) return;
  const verified = verifyToken(token);
  if (!verified) return;
  const claims = jwt.decode(token) as { exp: number; msid?: string };
  await recordSessionRevocation(prisma, token, verified.userId, new Date(claims.exp * 1000), claims.msid);
}

/** Client-side: fetches /api/auth/session with cookies to get current user (avoids using JWT on client). */
export const getSessionClient = async (): Promise<User | null> => {
  try {
    const token = Cookies.get("session_id");
    if (!token) {
      return null;
    }

    // On client side, we'll make an API call to verify the token
    // This avoids using the JWT library on the client side
    const response = await fetch("/api/auth/session", {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
      credentials: "include", // Include cookies
    });

    if (response.ok) {
      const user = await response.json();
      return user;
    }

    return null;
  } catch (error) {
    return null;
  }
};

/** Hashes a plain password with bcrypt for safe storage (used on registration). */
export const hashPassword = async (password: string): Promise<string> => {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(password, salt);
};

/** Compares plain password with stored hash (used on login). */
export const comparePassword = async (
  password: string,
  hashedPassword: string
): Promise<boolean> => {
  return bcrypt.compare(password, hashedPassword);
};
