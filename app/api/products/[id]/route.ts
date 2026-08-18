/**
 * Product Detail API Route Handler
 * App Router route handler for individual product operations (GET)
 */

import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
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

    const { id } = await params;
    const transformedProduct = await getProductDetailForPage(
      { id: session.id, role: session.role },
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
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const corsHeaders = createCorsHeaders(request);
  try {
    const session = await getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });
    }

    // Anti-Theft Control: Only Authorized Managers can adjust stock directly
    const role = session.role?.toUpperCase() || "";
    const isAuthorized =
      role === "SUPER_ADMIN" ||
      role === "SUPERADMIN" ||
      role === "ADMIN" ||
      role === "WAREHOUSE_MANAGER" ||
      role === "INVENTORY_OFFICER";

    if (!isAuthorized) {
      return NextResponse.json(
        {
          error:
            "محظور: يتطلب تعديل المخزون الميداني صلاحية مدير المستودع لمنع الاختلاس والتلاعب.",
        },
        { status: 403, headers: corsHeaders },
      );
    }

    const { id } = await params;
    const body = await request.json();
    const { quantity, reason } = body;

    if (typeof quantity !== "number" || quantity < 0) {
      return NextResponse.json(
        { error: "Invalid quantity provided" },
        { status: 400, headers: corsHeaders },
      );
    }

    // Fetch existing product for audit diff
    const existing = await prisma.product.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json(
        { error: "Product not found" },
        { status: 404, headers: corsHeaders },
      );
    }

    const updated = await prisma.product.update({
      where: { id },
      data: { quantity, updatedAt: new Date() },
    });

    // Immutable Audit Trail Logging
    await createAuditLog({
      userId: session.id,
      action: "update",
      entityType: "product",
      entityId: id,
      details: {
        type: "field_stock_adjustment",
        productName: existing.name,
        sku: existing.sku,
        oldQuantity: existing.quantity,
        newQuantity: quantity,
        difference: quantity - existing.quantity,
        reason: reason || "Field Inventory Audit",
        performedByRole: session.role,
      },
    }).catch(() => {});

    await invalidateOnProductChange();

    return NextResponse.json(updated, { headers: corsHeaders });
  } catch (error: any) {
    logger.error("Error updating product quantity:", error);
    return NextResponse.json(
      { error: error.message || "Failed to update product quantity" },
      { status: 500, headers: corsHeaders },
    );
  }
}

export async function OPTIONS(request: NextRequest) {
  return handleCorsPreflight(request);
}
