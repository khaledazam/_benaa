import { archiveEmptyProduct } from "@/lib/inventory/archiveProduct";
import { ManualMovementError } from "@/lib/inventory/manualMovement";
import { hasPermission } from "@/lib/auth/permissions";
/**
 * Products API Route Handler
 * GET: list products (admin by userId, supplier by supplierId); uses Redis cache; supplier response includes productOwnerName.
 * POST: create product (with optional QR/image); PATCH/DELETE in [id] route.
 */

import { NextRequest, NextResponse } from "next/server";
import { createCorsHeaders, handleCorsPreflight } from "@/lib/api/cors";
import { getSessionFromRequest } from "@/utils/auth";
import { logger } from "@/lib/logger";
import {
  generateAndUploadQRCode,
  deleteQRCodeFromImageKit,
  deleteProductImageFromImageKit,
  cleanupProductMediaFromImageKit,
} from "@/lib/imagekit";
import { isImageKitNotFoundError } from "@/lib/imagekit-errors";
import { isPrismaRelationViolation } from "@/lib/api/prisma-errors";
import {
  getDeleteStrategy,
  isActiveOrderStatus,
} from "@/lib/products/delete-policy";
import { mergeProductListWhere } from "@/lib/products/product-query";
import { prisma } from "@/prisma/client";
import { getSupplierByUserId } from "@/prisma/supplier";
import { checkAndSendStockAlerts } from "@/lib/email/notifications";
import {
  getCache,
  setCache,
  cacheKeys,
  invalidateOnProductChange,
  scheduleAfterResponse,
  scheduleInvalidateStockAllocationCaches,
} from "@/lib/cache";
import { getStockAllocationsByProduct } from "@/prisma/stock-allocation";
import { planCatalogQuantityReconcile } from "@/lib/stock-allocation/catalog-quantity-reconcile";
import { applyCatalogQuantityReconcile } from "@/lib/stock-allocation/apply-catalog-quantity-reconcile";
import { enrichProductsWithCommittedQuantity } from "@/lib/products/enrich-product-committed-quantity";
import { withRateLimit, defaultRateLimits } from "@/lib/api/rate-limit";
import { createAuditLog } from "@/prisma/audit-log";
import {
  createProductBodySchema,
  updateProductBodySchema,
} from "@/lib/validations/product";
// NOTE: Performance tracking wrapper is available but deferred until after all features are implemented
// import { withPerformanceTracking } from "@/lib/api/performance-wrapper";

/**
 * GET /api/products
 * Fetch all products for the authenticated user
 * Uses Redis caching for improved performance
 *
 * TODO (Future): Wrap with withPerformanceTracking() after all features are implemented
 * Example: export const GET = withPerformanceTracking(async (request) => { ... })
 */
export async function GET(request: NextRequest) {
  try {
    const responseHeaders = createCorsHeaders(request);

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
      return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: responseHeaders });
    }

    if (!hasPermission(session, 'PRODUCT_VIEW')) return NextResponse.json({ error: 'Forbidden product access' }, { status: 403, headers: responseHeaders });
    const isSupplier = session.role === "supplier";
    let cacheKey: string;
    let productWhere: { userId: string } | { supplierId: string };

    const isAdminRole =
      session.role === "SUPER_ADMIN" ||
      session.role === "ADMIN" ||
      session.role === "WAREHOUSE_MANAGER" ||
      session.role === "STOREKEEPER" ||
      session.role === "INVENTORY_OFFICER" ||
      session.role === "PURCHASING_OFFICER" ||
      session.role === "VIEWER";

    if (isSupplier) {
      const supplier = await getSupplierByUserId(session.id);
      if (!supplier) {
        return NextResponse.json([]);
      }
      // Include withOwnerNames so cached response includes productOwnerName (avoids stale cache without it)
      cacheKey = cacheKeys.products.list({
        supplierId: supplier.id,
        withOwnerNames: true,
      });
      productWhere = { supplierId: supplier.id };
    } else if (isAdminRole) {
      cacheKey = cacheKeys.products.list({ userId: "all_admin" });
      productWhere = {} as any;
    } else {
      cacheKey = cacheKeys.products.list({ userId: session.id });
      productWhere = { userId: session.id };
    }

    // Try to get from cache first
    const cacheReadStartedAt = Date.now();
    const cachedProducts = await getCache<
      Array<{ committedQuantity?: number }>
    >(cacheKey);
    // REQ-0179 — require party avatar + owner email fields (list densify)
    if (
      cachedProducts &&
      cachedProducts.every(
        (p) =>
          typeof p.committedQuantity === "number" &&
          "productOwnerImage" in p &&
          "productOwnerEmail" in p &&
          "supplierImage" in p,
      )
    ) {
      logger.info(`✅ Cache hit for products: ${cacheKey}`);
      return NextResponse.json(cachedProducts, { headers: responseHeaders });
    }

    // Cache miss: fetch from database
    logger.info(
      `❌ Cache miss for products: ${cacheKey} - fetching from database`,
    );

    // Fetch products (by userId for admin, by supplierId for supplier)
    const products = await prisma.product.findMany({
      where: mergeProductListWhere(productWhere),
      orderBy: { createdAt: "desc" },
    });

    // REQ-0179 — category + owner/supplier avatars for dialog densify
    const {
      loadProductListPartyMaps,
      productListPartyFields,
    } = await import("@/lib/server/product-list-party");
    const partyMaps = await loadProductListPartyMaps(products);

    const transformedProducts = await enrichProductsWithCommittedQuantity(
      products.map((product) => {
        const party = productListPartyFields(product, partyMaps);
        return {
          id: product.id,
          name: product.name,
          sku: product.sku,
          price: Number(product.price),
          quantity: Number(product.quantity),
          reservedQuantity: Number(product.reservedQuantity ?? 0),
          status: product.status,
          categoryId: product.categoryId,
          supplierId: product.supplierId,
          category: party.category,
          supplier: party.supplier,
          userId: product.userId,
          createdBy: product.createdBy,
          updatedBy: product.updatedBy || null,
          createdAt: product.createdAt.toISOString(),
          updatedAt: product.updatedAt?.toISOString() || null,
          qrCodeUrl: product.qrCodeUrl || null,
          imageUrl: product.imageUrl || null,
          imageFileId: product.imageFileId || null,
          expirationDate: product.expirationDate?.toISOString() || null,
          productOwnerName: party.productOwnerName,
          productOwnerImage: party.productOwnerImage,
          productOwnerEmail: party.productOwnerEmail,
          supplierImage: party.supplierImage,
        };
      }),
    );

    // Cache the result for 5 minutes
    await setCache(cacheKey, transformedProducts, 300, { fetchedAt: cacheReadStartedAt });

    return NextResponse.json(transformedProducts, { headers: responseHeaders });
  } catch (error) {
    logger.error("Error fetching products:", error);
    return NextResponse.json(
      { error: "Failed to fetch products" },
      { status: 500 },
    );
  }
}

/**
 * POST /api/products
 * Create a new product
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!hasPermission(session, "PRODUCT_CREATE")) return NextResponse.json({ error: "Forbidden product operation" }, { status: 403 });
    if (session.role === "supplier") {
      return NextResponse.json(
        { error: "Suppliers cannot create products; only admins can." },
        { status: 403 },
      );
    }

    const userId = session.id;
    const body = await request.json();

    const validationResult = createProductBodySchema.safeParse(body);
    if (!validationResult.success) {
      logger.warn("Invalid product creation data", {
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

    const {
      name,
      sku,
      price,
      quantity,
      status,
      categoryId,
      supplierId,
      unitId,
      imageUrl,
      imageFileId,
      expirationDate,
    } = validationResult.data;

    if (quantity !== 0) return NextResponse.json({ error: "Create catalog metadata with zero stock; post opening stock through the inventory movement engine" }, { status: 409 });

    if (unitId) {
      const unit = await prisma.unit.findUnique({ where: { id: unitId } });
      if (!unit?.active) return NextResponse.json({ error: "Registered active base unit is required" }, { status: 400 });
    }
    // Check if SKU already exists
    const existingProduct = await prisma.product.findUnique({
      where: { sku },
    });

    if (existingProduct) {
      return NextResponse.json(
        { error: "SKU must be unique" },
        { status: 400 },
      );
    }

    // Create product with audit fields
    const product = await prisma.product.create({
      data: {
        name,
        sku,
        price,
        quantity: quantity,
        status: status || "Available",
        userId,
        createdBy: userId, // Set createdBy same as userId
        categoryId,
        supplierId,
        unitId: unitId || null,
        imageUrl: imageUrl || null,
        imageFileId: imageFileId || null,
        expirationDate: expirationDate ? new Date(expirationDate) : null,
        createdAt: new Date(),
        updatedAt: null, // Set to null on creation - will be set when updated
      },
    });

    createAuditLog({
      userId,
      action: "create",
      entityType: "product",
      entityId: product.id,
      details: { productName: product.name, sku: product.sku },
    }).catch(() => {});

    // Fetch category and supplier data for the response
    const category = await prisma.category.findUnique({
      where: { id: categoryId },
    });
    const supplier = await prisma.supplier.findUnique({
      where: { id: supplierId },
    });

    // Generate QR code and upload to ImageKit (async, don't block response)
    generateAndUploadQRCode(
      JSON.stringify({
        productId: product.id,
        sku: product.sku,
        name: product.name,
      }),
      `product-${product.sku}`,
      200,
      "/stock-inventory/qr-codes/",
    )
      .then(async (qrCodeData) => {
        // Update product with QR code URL and fileId
        await prisma.product.update({
          where: { id: product.id },
          data: {
            qrCodeUrl: qrCodeData.url,
            qrCodeFileId: qrCodeData.fileId,
          },
        });
        // REQ-0134: second wipe — first invalidation ran before QR existed in DB
        await invalidateOnProductChange();
      })
      .catch((error) => {
        // Log error but don't fail the request
        logger.error("Failed to generate QR code for new product:", error);
      });

    // Check stock level and send email alerts if needed (async, don't block response)
    // Fetch user email for notifications
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, name: true },
    });

    checkAndSendStockAlerts(
      {
        name: product.name,
        quantity: Number(product.quantity),
        sku: product.sku,
        category: category?.name,
      },
      undefined, // No previous quantity for new products
      user?.email || undefined,
      user?.name || undefined,
      userId, // Pass userId to check email preferences
    ).catch((error) => {
      // Log error but don't fail the request
      logger.error(
        "Failed to check and send stock alerts for new product:",
        error,
      );
    });

    // Global invalidation: products affect categories, suppliers, dashboard
    await invalidateOnProductChange();
    // Transform product to match expected format
    const transformedProduct = {
      id: product.id,
      name: product.name,
      sku: product.sku,
      unitId: product.unitId,
      price: Number(product.price),
      quantity: Number(product.quantity),
      status: product.status,
      categoryId: product.categoryId,
      supplierId: product.supplierId,
      category: category?.name || "Unknown",
      supplier: supplier?.name || "Unknown",
      userId: product.userId,
      createdBy: product.createdBy,
      updatedBy: product.updatedBy || null,
      createdAt: product.createdAt.toISOString(),
      updatedAt: product.updatedAt?.toISOString() || null,
      qrCodeUrl: product.qrCodeUrl || null,
    };

    return NextResponse.json(transformedProduct, { status: 201 });
  } catch (error) {
    logger.error("Error creating product:", error);
    return NextResponse.json(
      { error: "Failed to create product" },
      { status: 500 },
    );
  }
}

/**
 * PUT /api/products
 * Update an existing product
 */
export async function PUT(request: NextRequest) {
  try {
    const session = await getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!hasPermission(session, "PRODUCT_UPDATE")) return NextResponse.json({ error: "Forbidden product operation" }, { status: 403 });
    if (session.role === "supplier") {
      return NextResponse.json(
        { error: "Suppliers cannot update products; only admins can." },
        { status: 403 },
      );
    }

    const userId = session.id;
    const body = await request.json();

    const validationResult = updateProductBodySchema.safeParse(body);
    if (!validationResult.success) {
      logger.warn("Invalid product update data", {
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

    const {
      id,
      name,
      sku,
      price,
      quantity,
      status,
      categoryId,
      supplierId,
      imageUrl,
      imageFileId,
      expirationDate,
    } = validationResult.data;

    // Verify product belongs to user
    const existingProduct = await prisma.product.findFirst({
      where: mergeProductListWhere({ id, userId }),
    });

    if (!existingProduct) {
      return NextResponse.json(
        { error: "Product not found or unauthorized" },
        { status: 404 },
      );
    }

    // Check if SKU is being changed and if new SKU already exists
    if (sku && sku !== existingProduct.sku) {
      const skuExists = await prisma.product.findUnique({
        where: { sku },
      });

      if (skuExists) {
        return NextResponse.json(
          { error: "SKU must be unique" },
          { status: 400 },
        );
      }
    }

    // Handle image deletion if imageUrl is being cleared
    const oldImageFileId = existingProduct.imageFileId;
    if (imageUrl === "" && oldImageFileId) {
      // Delete old image from ImageKit (async, don't block)
      deleteProductImageFromImageKit(oldImageFileId).catch((error) => {
        if (!isImageKitNotFoundError(error)) {
          logger.warn("Failed to delete old product image:", error);
        }
      });
    }

    const productUpdateData = {
      ...(name && { name }),
      ...(sku && { sku }),
      ...(price !== undefined && { price }),
      ...(status && { status }),
      ...(categoryId && { categoryId }),
      ...(supplierId && { supplierId }),
      ...(imageUrl !== undefined && {
        imageUrl: imageUrl === "" ? null : imageUrl,
      }),
      ...(imageFileId !== undefined && {
        imageFileId: imageFileId === "" ? null : imageFileId,
      }),
      ...(expirationDate !== undefined && {
        expirationDate:
          expirationDate === "" || expirationDate === null
            ? null
            : new Date(expirationDate),
      }),
      updatedBy: session.id,
      updatedAt: new Date(),
    };

    const quantityChanged =
      quantity !== undefined &&
      existingProduct.quantity !== quantity;

    let stockReconcile:
      | {
          unitsRemovedFromWarehouses: number;
          shrinkSteps?: Array<{
            id: string;
            deduct: number;
            warehouseId?: string;
            productId: string;
          }>;
        }
      | undefined;

    if (quantityChanged) return NextResponse.json({ error: "Stock quantities require an approved warehouse inventory adjustment" }, { status: 409 });
    await prisma.product.update({ where: { id }, data: productUpdateData });

    const product = await prisma.product.findUniqueOrThrow({ where: { id } });

    const fieldsUpdated: string[] = [];
    if (name && name !== existingProduct.name) fieldsUpdated.push("Name");
    if (sku && sku !== existingProduct.sku) fieldsUpdated.push("SKU");
    if (price !== undefined && Number(existingProduct.price) !== price) fieldsUpdated.push("Price");
    if (quantity !== undefined && existingProduct.quantity !== quantity) fieldsUpdated.push("Quantity");
    if (status && status !== existingProduct.status) fieldsUpdated.push("Status");
    if (categoryId && categoryId !== existingProduct.categoryId) fieldsUpdated.push("Category");
    if (supplierId && supplierId !== existingProduct.supplierId) fieldsUpdated.push("Supplier");
    if (imageUrl !== undefined) fieldsUpdated.push("Image");
    if (expirationDate !== undefined) fieldsUpdated.push("Expiration Date");

    createAuditLog({
      userId: session.id,
      action: "update",
      entityType: "product",
      entityId: product.id,
      details: {
        productName: product.name,
        ...(fieldsUpdated.length > 0 && { fieldsUpdated }),
      },
    }).catch(() => {});

    // Fetch category and supplier data for the response
    const category = product.categoryId ? await prisma.category.findUnique({
      where: { id: product.categoryId },
    }) : null;
    const supplier = await prisma.supplier.findUnique({
      where: { id: product.supplierId },
    });

    // Regenerate QR code if SKU or name changed (async, don't block response)
    if (sku || name) {
      // Get the old fileId before updating product
      const oldFileId = product.qrCodeFileId;

      generateAndUploadQRCode(
        JSON.stringify({
          productId: product.id,
          sku: product.sku,
          name: product.name,
        }),
        `product-${product.sku}`,
        200,
        "/stock-inventory/qr-codes/",
      )
        .then(async (qrCodeData) => {
          // Update product with new QR code URL and fileId
          await prisma.product.update({
            where: { id: product.id },
            data: {
              qrCodeUrl: qrCodeData.url,
              qrCodeFileId: qrCodeData.fileId,
            },
          });

          // Delete old QR code from ImageKit if it exists
          if (oldFileId) {
            try {
              await deleteQRCodeFromImageKit(oldFileId);
              logger.debug(
                `Deleted old QR code file from ImageKit: ${oldFileId}`,
              );
            } catch (deleteError) {
              if (!isImageKitNotFoundError(deleteError)) {
                logger.warn(
                  `Failed to delete old QR code from ImageKit: ${oldFileId}`,
                  deleteError,
                );
              }
            }
          }
          // REQ-0134: second wipe so detail/list cannot re-serve pre-QR Redis snapshot
          await invalidateOnProductChange();
        })
        .catch((error) => {
          // Log error but don't fail the request
          logger.error(
            "Failed to regenerate QR code for updated product:",
            error,
          );
        });
    }

    // Check stock level and send email alerts if needed (async, don't block response)
    // Only check if quantity changed and product is low stock or out of stock
    const previousQuantity = Number(existingProduct.quantity);
    const currentQuantity = Number(product.quantity);
    if (previousQuantity !== currentQuantity) {
      // Fetch user email for notifications
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { email: true, name: true },
      });

      checkAndSendStockAlerts(
        {
          name: product.name,
          quantity: currentQuantity,
          sku: product.sku,
          category: category?.name,
        },
        previousQuantity, // Pass previous quantity to avoid duplicate alerts
        user?.email || undefined,
        user?.name || undefined,
        userId, // Pass userId to check email preferences
      ).catch((error) => {
        // Log error but don't fail the request
        logger.error(
          "Failed to check and send stock alerts for updated product:",
          error,
        );
      });
    }

    // Global invalidation: products affect categories, suppliers, dashboard
    await invalidateOnProductChange();
    // Transform product to match expected format
    const transformedProduct = {
      id: product.id,
      name: product.name,
      sku: product.sku,
      price: Number(product.price),
      quantity: Number(product.quantity),
      status: product.status,
      categoryId: product.categoryId,
      supplierId: product.supplierId,
      category: category?.name || "Unknown",
      supplier: supplier?.name || "Unknown",
      userId: product.userId,
      createdBy: product.createdBy,
      updatedBy: product.updatedBy || null,
      createdAt: product.createdAt.toISOString(),
      updatedAt: product.updatedAt?.toISOString() || null,
      qrCodeUrl: product.qrCodeUrl || null,
      imageUrl: product.imageUrl || null,
      imageFileId: product.imageFileId || null,
      expirationDate: product.expirationDate?.toISOString() || null,
      ...(stockReconcile
        ? {
            stockReconcile: {
              unitsRemovedFromWarehouses:
                stockReconcile.unitsRemovedFromWarehouses,
              shrinkSteps: stockReconcile.shrinkSteps ?? [],
            },
          }
        : {}),
    };

    return NextResponse.json(transformedProduct);
  } catch (error) {
    logger.error("Error updating product:", error);
    return NextResponse.json(
      { error: "Failed to update product" },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/products
 * Hard-delete when no order history; soft-delete (archive) when only completed orders exist.
 */
export async function DELETE(request: NextRequest) {
 const session = await getSessionFromRequest(request);
 if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
 if (!hasPermission(session, "PRODUCT_DELETE")) return NextResponse.json({ error: "Forbidden product operation" }, { status: 403 });
 const id = new URL(request.url).searchParams.get("id");
 if (!id || !/^[a-f0-9]{24}$/i.test(id)) return NextResponse.json({ error: "Valid product ID is required" }, { status: 400 });
 try {
  const result = await archiveEmptyProduct(prisma, session.id, id);
  await invalidateOnProductChange();
  return NextResponse.json(result);
 } catch(error: any) {
  return NextResponse.json({ error: error instanceof ManualMovementError ? error.message : "Product archival failed safely" }, { status: error instanceof ManualMovementError ? error.status : 409 });
 }
}

export async function OPTIONS(request: NextRequest) {
  return handleCorsPreflight(request);
}
