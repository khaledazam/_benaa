/**
 * Product Detail API Route Handler
 * App Router route handler for individual product operations (GET)
 */

import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { hasPermission } from '@/lib/auth/permissions';
import { logger } from "@/lib/logger";
import { withRateLimit, defaultRateLimits } from "@/lib/api/rate-limit";
import { getProductDetailForPage } from "@/lib/server/product-detail-data";

import { createCorsHeaders, handleCorsPreflight } from "@/lib/api/cors";
import { prisma } from "@/prisma/client";
import { invalidateOnProductChange } from "@/lib/cache";

/**
 * GET /api/products/:id
 * Get product details by ID with all related data
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const corsHeaders = createCorsHeaders(request);
  try {
    // Rate limiting check
    const rateLimitResponse = await withRateLimit(
      request,
      defaultRateLimits.standard,
    );
    if (rateLimitResponse) {
      return rateLimitResponse;
    }

    const session = await getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });
    }

    if (!hasPermission(session, 'PRODUCT_VIEW')) return NextResponse.json({ error: 'Forbidden product access' }, { status: 403, headers: corsHeaders });
    const { id } = await params;
    const transformedProduct = await getProductDetailForPage(
      session,
      id,
    );

    if (!transformedProduct) {
      return NextResponse.json({ error: "Product not found" }, { status: 404, headers: corsHeaders });
    }

    return NextResponse.json(transformedProduct, { headers: corsHeaders });
  } catch (error) {
    logger.error("Error fetching product:", error);
    return NextResponse.json(
      { error: "Failed to fetch product" },
      { status: 500, headers: corsHeaders },
    );
  }
}

import { createAuditLog } from "@/prisma/audit-log";

/**
 * PATCH /api/products/:id
 * Quick quantity update for field stock adjustment with anti-theft controls
 */
export async function PATCH(request: NextRequest, _context: { params: Promise<{ id: string }> }) {
 const session = await getSessionFromRequest(request);
 if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
 return NextResponse.json({ error: "Direct stock replacement is disabled; post an approved warehouse inventory adjustment" }, { status: 409 });
}

export async function OPTIONS(request: NextRequest) {
  return handleCorsPreflight(request);
}
