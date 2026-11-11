import { withWarehouseScope } from "@/lib/auth/warehouse-route-scope";
/**
 * Warehouses API Route Handler
 * App Router route handler for warehouse CRUD operations
 */

import { NextRequest, NextResponse } from "next/server";
import { getWarehouseDeleteBlockers } from "@/lib/warehouses/warehouse-delete-guards";
import { getSessionFromRequest } from "@/utils/auth";
import { logger } from "@/lib/logger";
import { prisma } from "@/prisma/client";
import { createAuditLog } from "@/prisma/audit-log";
import {
  createWarehouseBodySchema,
  updateWarehouseBodySchema,
} from "@/lib/validations/warehouse";

import { createCorsHeaders, handleCorsPreflight } from "@/lib/api/cors";
import { scheduleInvalidateWarehouseCaches } from "@/lib/cache";

/**
 * GET /api/warehouses
 * Fetch all warehouses for the authenticated user
 */
async function scopedGET(request: NextRequest) {
  try {
    const responseHeaders = createCorsHeaders(request);

    const session = await getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: responseHeaders });
    }

    const userId = session.id;
    const isAdminRole =
      session.role === "SUPER_ADMIN" ||
      session.role === "ADMIN" ||
      session.role === "WAREHOUSE_MANAGER" ||
      session.role === "STOREKEEPER" ||
      session.role === "INVENTORY_OFFICER" ||
      session.role === "PURCHASING_OFFICER" ||
      session.role === "VIEWER";

    const warehouses = await prisma.warehouse.findMany({
      where: isAdminRole ? {} : { userId },
    });

    return NextResponse.json(warehouses, { headers: responseHeaders });
  } catch (error) {
    logger.error("Error fetching warehouses:", error);
    return NextResponse.json(
      { error: "Failed to fetch warehouses" },
      { status: 500 },
    );
  }
}

/**
 * POST /api/warehouses
 * Create a new warehouse
 */
async function scopedPOST(request: NextRequest) {
  try {
    const session = await getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = session.id;
    const body = await request.json();

    const validationResult = createWarehouseBodySchema.safeParse(body);
    if (!validationResult.success) {
      logger.warn("Invalid warehouse creation data", {
        errors: validationResult.error.issues,
      });
      return NextResponse.json(
        {
          error: "Invalid request body",
          details: validationResult.error.issues,
        },
        { status: 400 },
      );
    }

    const { name, address, type, status } = validationResult.data;

    const warehouse = await prisma.warehouse.create({
      data: {
        name,
        userId,
        address:
          address && typeof address === "string"
            ? address.trim() || null
            : null,
        type: type && typeof type === "string" ? type.trim() || null : null,
        status: status ?? true,
        createdBy: userId,
        createdAt: new Date(),
        updatedAt: null,
      },
    });

    createAuditLog({
      userId,
      action: "create",
      entityType: "warehouse",
      entityId: warehouse.id,
      details: { name: warehouse.name },
    }).catch(() => {});
    await scheduleInvalidateWarehouseCaches();
    return NextResponse.json(warehouse, { status: 201 });
  } catch (error) {
    logger.error("Error creating warehouse:", error);
    return NextResponse.json(
      { error: "Failed to create warehouse" },
      { status: 500 },
    );
  }
}

/**
 * PUT /api/warehouses
 * Update an existing warehouse
 */
async function scopedPUT(request: NextRequest) {
  try {
    const session = await getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = session.id;
    const body = await request.json();

    const validationResult = updateWarehouseBodySchema.safeParse(body);
    if (!validationResult.success) {
      logger.warn("Invalid warehouse update data", {
        errors: validationResult.error.issues,
      });
      return NextResponse.json(
        {
          error: "Invalid request body",
          details: validationResult.error.issues,
        },
        { status: 400 },
      );
    }

    const { id, name, address, type, status } = validationResult.data;

    const existing = await prisma.warehouse.findFirst({
      where: { id, userId },
    });

    if (!existing) {
      return NextResponse.json(
        { error: "Warehouse not found or unauthorized" },
        { status: 404 },
      );
    }

    const updateData: {
      name: string;
      updatedBy: string;
      updatedAt: Date;
      address?: string | null;
      type?: string | null;
      status?: boolean;
    } = {
      name,
      updatedBy: userId,
      updatedAt: new Date(),
    };
    if (address !== undefined) {
      updateData.address =
        address && typeof address === "string" ? address.trim() || null : null;
    }
    if (type !== undefined) {
      updateData.type =
        type && typeof type === "string" ? type.trim() || null : null;
    }
    if (status !== undefined) {
      updateData.status = Boolean(status);
    }

    const warehouse = await prisma.warehouse.update({
      where: { id },
      data: updateData,
    });

    createAuditLog({
      userId,
      action: "update",
      entityType: "warehouse",
      entityId: id,
      details: { name: warehouse.name },
    }).catch(() => {});
    await scheduleInvalidateWarehouseCaches();
    return NextResponse.json(warehouse);
  } catch (error) {
    logger.error("Error updating warehouse:", error);
    return NextResponse.json(
      { error: "Failed to update warehouse" },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/warehouses
 * Delete a warehouse
 */
async function scopedDELETE(request: NextRequest) {
  try {
    const session = await getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = session.id;
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json(
        { error: "Warehouse ID is required" },
        { status: 400 },
      );
    }

    const existing = await prisma.warehouse.findFirst({
      where: { id, userId },
    });

    if (!existing) {
      return NextResponse.json(
        { error: "Warehouse not found or unauthorized" },
        { status: 404 },
      );
    }

    const blockers = await getWarehouseDeleteBlockers(id);
    if (blockers.blocked) {
      return NextResponse.json(
        {
          error: "Cannot delete warehouse while stock commitments exist.",
          reasons: blockers.reasons,
        },
        { status: 409 },
      );
    }

    await prisma.stockAllocation.deleteMany({
      where: { warehouseId: id },
    });

    await prisma.warehouse.delete({
      where: { id },
    });

    createAuditLog({
      userId,
      action: "delete",
      entityType: "warehouse",
      entityId: id,
      details: { name: existing.name },
    }).catch(() => {});
    await scheduleInvalidateWarehouseCaches();
    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error("Error deleting warehouse:", error);
    return NextResponse.json(
      { error: "Failed to delete warehouse" },
      { status: 500 },
    );
  }
}

export async function OPTIONS(request: NextRequest) {
  return handleCorsPreflight(request);
}

export const GET = withWarehouseScope(scopedGET);
export const POST = withWarehouseScope(scopedPOST);
export const PUT = withWarehouseScope(scopedPUT);
export const DELETE = withWarehouseScope(scopedDELETE);
