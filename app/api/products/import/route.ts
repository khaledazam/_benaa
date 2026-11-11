import { hasPermission } from "@/lib/auth/permissions";
/**
 * Product Import API Route Handler
 * Handles product data import from CSV/Excel files
 */

import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { logger } from "@/lib/logger";
import { prisma } from "@/prisma/client";
import { withRateLimit, defaultRateLimits } from "@/lib/api/rate-limit";
import { parseFile } from "@/lib/import";
import {
  validateRows,
  transformFunctions,
  type ColumnMapping,
} from "@/lib/import";
import { createProductSchema } from "@/lib/validations";
import { z } from "zod";
import {
  createImportHistory,
  updateImportHistory,
} from "@/prisma/import-history";
import { checkAndSendStockAlerts } from "@/lib/email/notifications";
import { scheduleInvalidateImportCaches } from "@/lib/cache";
import { MAX_PRODUCT_IMPORT_FILE_BYTES } from "@/lib/import/limits";

/**
 * POST /api/products/import
 * Import products from CSV/Excel file
 */
export async function POST(request: NextRequest) {
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
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!hasPermission(session, "PRODUCT_CREATE")) {
      return NextResponse.json(
        { error: "Forbidden: suppliers cannot import products" },
        { status: 403 },
      );
    }

    const userId = session.id;

    // Parse multipart form data
    let formData: FormData;
    try { formData = await request.formData(); }
    catch { return NextResponse.json({ error: "Invalid or truncated multipart upload" }, { status: 400 }); }
    const file = formData.get("file") as File | null;

    if (!file || typeof file === 'string') {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    // Validate file size (max 10MB)
    const maxSize = MAX_PRODUCT_IMPORT_FILE_BYTES;
    if (file.size > maxSize) {
      return NextResponse.json(
        { error: "File size exceeds 10MB limit" },
        { status: 413 },
      );
    }

    // Parse file first to get total rows
    const parsedRows = await parseFile(file);
    const dataRows = parsedRows.filter((row) => !row.isHeader);
    if (!dataRows.length) return NextResponse.json({ error: "Import contains no product rows" }, { status: 400 });

    // Create import history record
    const importHistory = await createImportHistory({
      userId,
      importType: "products",
      fileName: file.name,
      fileSize: file.size,
      totalRows: dataRows.length,
      successRows: 0,
      failedRows: 0,
      status: "processing",
    });

    try {
      // Column mapping for product import
      // Maps import file columns to product schema fields
      const columnMapping: ColumnMapping[] = [
        {
          importColumn: "Product Name",
          schemaField: "name",
          transform: (value) => String(value).trim(),
        },
        {
          importColumn: "SKU",
          schemaField: "sku",
          transform: (value) => String(value).trim().toUpperCase(),
        },
        {
          importColumn: "Price",
          schemaField: "price",
          transform: transformFunctions.toNumber,
        },
        {
          importColumn: "Quantity",
          schemaField: "quantity",
          transform: transformFunctions.toNumber,
        },
        {
          importColumn: "Status",
          schemaField: "status",
          transform: (value) => {
            const status = String(value).trim();
            if (["Available", "Stock Low", "Stock Out"].includes(status)) {
              return status;
            }
            // Default to Available if invalid
            return "Available";
          },
        },
        {
          importColumn: "Category",
          schemaField: "categoryId",
          transform: async (value) => {
            // Look up category by name
            const categoryName = String(value).trim();
            if (!categoryName) {
              throw new Error("Category is required");
            }
            const category = await prisma.category.findFirst({
              where: {
                name: { equals: categoryName, mode: "insensitive" },
                userId,
              },
            });
            if (!category) {
              throw new Error(`Category "${categoryName}" not found`);
            }
            return category.id;
          },
        },
        {
          importColumn: "Supplier",
          schemaField: "supplierId",
          transform: async (value) => {
            // Look up supplier by name
            const supplierName = String(value).trim();
            if (!supplierName) {
              throw new Error("Supplier is required");
            }
            const supplier = await prisma.supplier.findFirst({
              where: {
                name: { equals: supplierName, mode: "insensitive" },
                userId,
              },
            });
            if (!supplier) {
              throw new Error(`Supplier "${supplierName}" not found`);
            }
            return supplier.id;
          },
        },
      ];

      // Note: Column mapping with async transforms requires special handling
      // For now, we'll validate synchronously and handle category/supplier lookup separately
      const simplifiedMapping: ColumnMapping[] = [
        {
          importColumn: "Product Name",
          schemaField: "name",
          transform: (value) => String(value).trim(),
        },
        {
          importColumn: "SKU",
          schemaField: "sku",
          transform: (value) => String(value).trim().toUpperCase(),
        },
        {
          importColumn: "Price",
          schemaField: "price",
          transform: transformFunctions.toNumber,
        },
        {
          importColumn: "Quantity",
          schemaField: "quantity",
          transform: transformFunctions.toNumber,
        },
        {
          importColumn: "Status",
          schemaField: "status",
          transform: (value) => {
            const status = String(value).trim();
            if (["Available", "Stock Low", "Stock Out"].includes(status)) {
              return status;
            }
            return "Available";
          },
        },
        {
          importColumn: "Category",
          schemaField: "categoryName",
          transform: (value) => String(value).trim(),
        },
        {
          importColumn: "Supplier",
          schemaField: "supplierName",
          transform: (value) => String(value).trim(),
        },
      ];

      // Validate rows (without category/supplier lookup)
      const validationResult = validateRows(
        dataRows,
        createProductSchema.omit({ categoryId: true, supplierId: true, userId: true }).extend({
          categoryName: z.string().min(1),
          supplierName: z.string().min(1),
        }),
        simplifiedMapping,
      );

      // Process valid rows
      let successCount = 0;
      let failCount = dataRows.length - validationResult.validRows.length;
      const errors: Array<{
        rowNumber: number;
        field?: string;
        message: string;
      }> = validationResult.errors.map(({ rowNumber, field, message }) => ({ rowNumber, field, message }));

      // Get all categories and suppliers for lookup
      const categories = await prisma.category.findMany({
        where: { userId },
      });
      const suppliers = await prisma.supplier.findMany({
        where: { userId },
      });

      const categoryMap = new Map(
        categories.map((cat) => [cat.name.toLowerCase(), cat.id]),
      );
      const supplierMap = new Map(
        suppliers.map((sup) => [sup.name.toLowerCase(), sup.id]),
      );

      // Process each valid row
      for (const row of validationResult.validRows) {
        try {
          const rowData = row as Record<string, unknown>;
          const categoryName = String(rowData.categoryName || "")
            .trim()
            .toLowerCase();
          const supplierName = String(rowData.supplierName || "")
            .trim()
            .toLowerCase();

          const categoryId = categoryMap.get(categoryName);
          const supplierId = supplierMap.get(supplierName);

          if (!categoryId) {
            failCount++;
            errors.push({
              rowNumber: 0, // Will be set from original row
              field: "categoryName",
              message: `Category "${rowData.categoryName}" not found`,
            });
            continue;
          }

          if (!supplierId) {
            failCount++;
            errors.push({
              rowNumber: 0,
              field: "supplierName",
              message: `Supplier "${rowData.supplierName}" not found`,
            });
            continue;
          }

          // Check if SKU already exists
          const existingProduct = await prisma.product.findUnique({
            where: { sku: String(rowData.sku) },
          });

          if (existingProduct) {
            failCount++;
            errors.push({
              rowNumber: 0,
              field: "sku",
              message: `SKU "${rowData.sku}" already exists`,
            });
            continue;
          }

          if (Number(rowData.quantity) !== 0) throw new Error("Import catalog metadata with zero stock; use the inventory engine for opening balances");
          // Create product
          await prisma.product.create({
            data: {
              name: String(rowData.name),
              sku: String(rowData.sku),
              price: Number(rowData.price),
              quantity: Number(rowData.quantity),
              status: String(rowData.status),
              categoryId,
              supplierId,
              userId,
              createdBy: userId,
            },
          });

          successCount++;
        } catch (error) {
          failCount++;
          errors.push({
            rowNumber: 0,
            message: error instanceof Error ? error.message : "Unknown error",
          });
        }
      }

      // Update import history
      await updateImportHistory(importHistory.id, {
        successRows: successCount,
        failedRows: failCount,
        errors: errors.length > 0 ? errors : undefined,
        status: successCount === 0 ? "failed" : "completed",
      });
    await scheduleInvalidateImportCaches();
      // Check and send stock alerts for newly imported products
      // This is done asynchronously to not block the response
      // Note: We check alerts for all products, not just imported ones
      // The stock alert system will check all products and send alerts as needed
      const allProducts = await prisma.product.findMany({
        where: { userId },
      });
      for (const product of allProducts) {
        checkAndSendStockAlerts(
          {
            name: product.name,
            quantity: Number(product.quantity),
            sku: product.sku,
          },
          undefined,
          undefined,
          userId,
        ).catch((error) => {
          logger.error("Failed to check stock alerts after import:", error);
        });
      }

      return NextResponse.json({
        success: failCount === 0,
        partial: successCount > 0 && failCount > 0,
        importId: importHistory.id,
        totalRows: dataRows.length,
        successRows: successCount,
        failedRows: failCount,
        errors: errors.length > 0 ? errors.slice(0, 10) : undefined, // Return first 10 errors
      });
    } catch (error) {
      // Update import history with error
      await updateImportHistory(importHistory.id, {
        status: "failed",
        errors: [
          {
            rowNumber: 0,
            message: error instanceof Error ? error.message : "Unknown error",
          },
        ],
      });
    await scheduleInvalidateImportCaches();
      logger.error("Product import failed:", error);
      return NextResponse.json(
        {
          error: "Import failed",
          message: error instanceof Error ? error.message : "Unknown error",
        },
        { status: 500 },
      );
    }
  } catch (error) {
    logger.error("Error importing products:", error);
    return NextResponse.json(
      {
        error: "Failed to import products",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
