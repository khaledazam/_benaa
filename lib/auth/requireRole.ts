import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { hasPermission, PermissionName, normalizeRole } from "./permissions";
import { createCorsHeaders } from "@/lib/api/cors";

export interface AuthenticatedSession {
  id: string;
  email: string;
  name: string;
  role: string;
  normalizedRole: string;
  permissions?: string[];
  permissionsRestricted?: boolean | null;
}

/**
 * Ensures user is authenticated and optionally possesses the required role/permission.
 * Returns session if authorized, or NextResponse JSON error response if unauthorized.
 */
export async function requireAuth(
  request: NextRequest,
  requiredPermission?: PermissionName
): Promise<{ session: AuthenticatedSession } | NextResponse> {
  const corsHeaders = createCorsHeaders(request);
  const rawSession = await getSessionFromRequest(request);

  if (!rawSession) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });
  }

  const role = rawSession.role || "user";
  const normalizedRole = normalizeRole(role);

  if (requiredPermission && !hasPermission(rawSession, requiredPermission)) {
    return NextResponse.json(
      { error: "Forbidden: insufficient permissions for this operation" },
      { status: 403, headers: corsHeaders }
    );
  }

  const session: AuthenticatedSession = {
    id: rawSession.id,
    email: rawSession.email,
    name: rawSession.name,
    role,
    normalizedRole,
    permissions: rawSession.permissions,
    permissionsRestricted: rawSession.permissionsRestricted,
  };

  return { session };
}

/**
 * Helper to check role authorization in API route handlers.
 * Usage:
 * const auth = await requireRole(request, ["SUPER_ADMIN", "WAREHOUSE_MANAGER"]);
 * if ("error" in auth || auth instanceof NextResponse) return auth;
 */
export async function requireRole(
  request: NextRequest,
  allowedRoles: string[]
): Promise<{ session: AuthenticatedSession } | NextResponse> {
  const rawSession = await getSessionFromRequest(request);

  if (!rawSession) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userRole = rawSession.role || "user";
  const normalizedUserRole = normalizeRole(userRole);

  const isAllowed = allowedRoles.some((role) => {
    const norm = normalizeRole(role);
    return norm === normalizedUserRole || userRole === role;
  });

  if (!isAllowed) {
    return NextResponse.json(
      { error: "Forbidden: required role not assigned" },
      { status: 403 }
    );
  }

  const session: AuthenticatedSession = {
    id: rawSession.id,
    email: rawSession.email,
    name: rawSession.name,
    role: userRole,
    normalizedRole: normalizedUserRole,
    permissions: rawSession.permissions,
    permissionsRestricted: rawSession.permissionsRestricted,
  };

  return { session };
}
