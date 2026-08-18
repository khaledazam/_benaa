import { prisma } from "@/prisma/client";
import { cancelReservation } from "@/lib/reservations/reservationService";

export interface SalesOrderItemInput {
  productId: string;
  unitId?: string;
  orderedQuantity: number;
  unitPrice: number;
  discount?: number;
  tax?: number;
  notes?: string;
}

export interface CreateSalesOrderInput {
  customerId: string;
  warehouseId: string;
  requestedDeliveryDate?: string | Date;
  notes?: string;
  discount?: number;
  tax?: number;
  items: SalesOrderItemInput[];
}

export interface UpdateSalesOrderInput {
  requestedDeliveryDate?: string | Date;
  notes?: string;
  discount?: number;
  tax?: number;
  items?: SalesOrderItemInput[];
}

export interface GetSalesOrdersQuery {
  search?: string;
  customerId?: string;
  warehouseId?: string;
  status?: string;
  startDate?: string;
  endDate?: string;
  page?: number;
  limit?: number;
  sortBy?: "salesOrderNumber" | "createdAt" | "total" | "status";
  sortOrder?: "asc" | "desc";
}

/**
 * Generates human-readable Sales Order number: SO-2026-XXXXXX
 */
export async function generateSalesOrderNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `SO-${year}-`;

  const lastOrder = await prisma.salesOrder.findFirst({
    where: { salesOrderNumber: { startsWith: prefix } },
    orderBy: { salesOrderNumber: "desc" },
    select: { salesOrderNumber: true },
  });

  let nextSequence = 1;
  const lastNum = lastOrder?.salesOrderNumber;
  if (lastNum) {
    const parts = lastNum.split("-");
    const lastSeqStr = parts[parts.length - 1] || "0";
    const lastSeq = parseInt(lastSeqStr, 10);
    if (!isNaN(lastSeq)) {
      nextSequence = lastSeq + 1;
    }
  }

  return `${prefix}${nextSequence.toString().padStart(6, "0")}`;
}

/**
 * Helper to round financial values safely to 2 decimals
 */
function roundMoney(amount: number): number {
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

/**
 * Creates a new DRAFT Sales Order
 */
export async function createSalesOrderDraft(data: CreateSalesOrderInput, userId: string) {
  if (!data.customerId) throw new Error("Customer is required");
  if (!data.warehouseId) throw new Error("Warehouse is required");
  if (!data.items || data.items.length === 0) throw new Error("Sales order must contain at least one item");

  // 1. Validate Customer & active status
  const customer = await prisma.customer.findUnique({ where: { id: data.customerId } });
  if (!customer) throw new Error("Customer not found");
  if (!customer.active) throw new Error(`Customer '${customer.name}' is INACTIVE and cannot receive new Sales Orders`);

  // 2. Validate Warehouse
  const warehouse = await prisma.warehouse.findUnique({ where: { id: data.warehouseId } });
  if (!warehouse) throw new Error("Warehouse not found");

  // 3. Fetch Products & Units for Snapshots & Pricing
  const productIds = data.items.map((i) => i.productId);
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
  });

  const productMap = new Map<string, any>(products.map((p: any) => [p.id, p]));

  const unitIds = data.items.map((i) => i.unitId).filter(Boolean) as string[];
  const units = unitIds.length > 0 ? await prisma.unit.findMany({ where: { id: { in: unitIds } } }) : [];
  const unitMap = new Map<string, any>(units.map((u: any) => [u.id, u]));

  // 4. Build line items with snapshots and line totals
  let calculatedSubtotal = 0;

  const processedItems = data.items.map((item) => {
    const product = productMap.get(item.productId);
    if (!product) throw new Error(`Product ID '${item.productId}' not found`);

    if (item.orderedQuantity <= 0) {
      throw new Error(`Ordered quantity for product '${product.name}' must be greater than 0`);
    }

    const unit = item.unitId ? unitMap.get(item.unitId) : null;
    const unitSymbol = unit?.symbol || product.size || null;

    const qty = item.orderedQuantity;
    const unitPrice = item.unitPrice !== undefined ? item.unitPrice : product.price;
    const discount = item.discount || 0;
    const tax = item.tax || 0;

    const lineTotal = roundMoney(qty * unitPrice - discount + tax);
    calculatedSubtotal += lineTotal;

    return {
      productId: item.productId,
      productName: product.name,
      productSku: product.sku || null,
      unitId: item.unitId || product.unitId || null,
      unitSymbol,
      orderedQuantity: qty,
      unitPrice,
      discount,
      tax,
      lineTotal,
      notes: item.notes?.trim() || null,
    };
  });

  const orderDiscount = data.discount || 0;
  const orderTax = data.tax || 0;
  const subtotal = roundMoney(calculatedSubtotal);
  const total = roundMoney(subtotal - orderDiscount + orderTax);

  const salesOrderNumber = await generateSalesOrderNumber();

  // 5. Save SalesOrder in DRAFT status
  const salesOrder = await prisma.salesOrder.create({
    data: {
      salesOrderNumber,
      customerId: customer.id,
      customerCodeSnapshot: customer.customerCode,
      customerNameSnapshot: customer.name,
      customerPhoneSnapshot: customer.phone,
      warehouseId: warehouse.id,
      status: "DRAFT",
      orderDate: new Date(),
      requestedDeliveryDate: data.requestedDeliveryDate ? new Date(data.requestedDeliveryDate) : null,
      subtotal,
      discount: orderDiscount,
      tax: orderTax,
      total,
      notes: data.notes?.trim() || null,
      createdBy: userId,
      items: {
        create: processedItems,
      },
    },
    include: {
      customer: true,
      warehouse: true,
      items: true,
    },
  });

  // 6. Audit Log
  await prisma.auditLog.create({
    data: {
      userId,
      action: "sales_order_created",
      entityType: "SalesOrder",
      entityId: salesOrder.id,
      details: { salesOrderNumber: salesOrder.salesOrderNumber, customerName: customer.name, total: salesOrder.total },
    },
  });

  return salesOrder;
}

/**
 * Updates a DRAFT Sales Order
 */
export async function updateSalesOrderDraft(id: string, data: UpdateSalesOrderInput, userId: string) {
  const existing = await prisma.salesOrder.findUnique({
    where: { id },
    include: { items: true },
  });

  if (!existing) throw new Error("Sales Order not found");
  if (existing.status !== "DRAFT") {
    throw new Error(`Cannot modify Sales Order in '${existing.status}' status. Only DRAFT orders can be edited.`);
  }

  let subtotal = existing.subtotal;
  let total = existing.total;
  let updateItemsOp = undefined;

  if (data.items && data.items.length > 0) {
    const productIds = data.items.map((i) => i.productId);
    const products = await prisma.product.findMany({ where: { id: { in: productIds } } });
    const productMap = new Map<string, any>(products.map((p: any) => [p.id, p]));

    const unitIds = data.items.map((i) => i.unitId).filter(Boolean) as string[];
    const units = unitIds.length > 0 ? await prisma.unit.findMany({ where: { id: { in: unitIds } } }) : [];
    const unitMap = new Map<string, any>(units.map((u: any) => [u.id, u]));

    let calculatedSubtotal = 0;

    const processedItems = data.items.map((item) => {
      const product = productMap.get(item.productId);
      if (!product) throw new Error(`Product ID '${item.productId}' not found`);

      if (item.orderedQuantity <= 0) {
        throw new Error(`Ordered quantity for product '${product.name}' must be greater than 0`);
      }

      const unit = item.unitId ? unitMap.get(item.unitId) : null;
      const unitSymbol = unit?.symbol || product.size || null;

      const qty = item.orderedQuantity;
      const unitPrice = item.unitPrice !== undefined ? item.unitPrice : product.price;
      const discount = item.discount || 0;
      const tax = item.tax || 0;

      const lineTotal = roundMoney(qty * unitPrice - discount + tax);
      calculatedSubtotal += lineTotal;

      return {
        productId: item.productId,
        productName: product.name,
        productSku: product.sku || null,
        unitId: item.unitId || product.unitId || null,
        unitSymbol,
        orderedQuantity: qty,
        unitPrice,
        discount,
        tax,
        lineTotal,
        notes: item.notes?.trim() || null,
      };
    });

    subtotal = roundMoney(calculatedSubtotal);
    const orderDiscount = data.discount !== undefined ? data.discount : existing.discount || 0;
    const orderTax = data.tax !== undefined ? data.tax : existing.tax || 0;
    total = roundMoney(subtotal - orderDiscount + orderTax);

    updateItemsOp = {
      deleteMany: {},
      create: processedItems,
    };
  } else if (data.discount !== undefined || data.tax !== undefined) {
    const orderDiscount = data.discount !== undefined ? data.discount : existing.discount || 0;
    const orderTax = data.tax !== undefined ? data.tax : existing.tax || 0;
    total = roundMoney(existing.subtotal - orderDiscount + orderTax);
  }

  const updated = await prisma.salesOrder.update({
    where: { id },
    data: {
      ...(data.requestedDeliveryDate !== undefined && {
        requestedDeliveryDate: data.requestedDeliveryDate ? new Date(data.requestedDeliveryDate) : null,
      }),
      ...(data.notes !== undefined && { notes: data.notes?.trim() || null }),
      ...(data.discount !== undefined && { discount: data.discount }),
      ...(data.tax !== undefined && { tax: data.tax }),
      subtotal,
      total,
      updatedAt: new Date(),
      ...(updateItemsOp && { items: updateItemsOp }),
    },
    include: {
      customer: true,
      warehouse: true,
      items: true,
    },
  });

  await prisma.auditLog.create({
    data: {
      userId,
      action: "sales_order_updated",
      entityType: "SalesOrder",
      entityId: updated.id,
      details: { salesOrderNumber: updated.salesOrderNumber },
    },
  });

  return updated;
}

/**
 * Submits DRAFT Sales Order for Approval (DRAFT -> PENDING_APPROVAL)
 */
export async function submitSalesOrder(id: string, userId: string) {
  const existing = await prisma.salesOrder.findUnique({ where: { id } });
  if (!existing) throw new Error("Sales Order not found");
  if (existing.status !== "DRAFT") {
    throw new Error(`Cannot submit Sales Order in '${existing.status}' status. Must be DRAFT.`);
  }

  const updated = await prisma.salesOrder.update({
    where: { id, status: "DRAFT" },
    data: {
      status: "PENDING_APPROVAL",
      updatedAt: new Date(),
    },
    include: { customer: true, warehouse: true, items: true },
  });

  await prisma.auditLog.create({
    data: {
      userId,
      action: "sales_order_submitted",
      entityType: "SalesOrder",
      entityId: updated.id,
      details: { salesOrderNumber: updated.salesOrderNumber },
    },
  });

  return updated;
}

/**
 * Approves Pending Sales Order (PENDING_APPROVAL -> APPROVED)
 */
export async function approveSalesOrder(id: string, userId: string) {
  const existing = await prisma.salesOrder.findUnique({ where: { id } });
  if (!existing) throw new Error("Sales Order not found");
  if (existing.status !== "PENDING_APPROVAL") {
    throw new Error(`Cannot approve Sales Order in '${existing.status}' status. Must be PENDING_APPROVAL.`);
  }

  const updated = await prisma.salesOrder.update({
    where: { id, status: "PENDING_APPROVAL" },
    data: {
      status: "APPROVED",
      approvedBy: userId,
      approvedAt: new Date(),
      updatedAt: new Date(),
    },
    include: { customer: true, warehouse: true, items: true },
  });

  await prisma.auditLog.create({
    data: {
      userId,
      action: "sales_order_approved",
      entityType: "SalesOrder",
      entityId: updated.id,
      details: { salesOrderNumber: updated.salesOrderNumber },
    },
  });

  return updated;
}

/**
 * Starts Processing an Approved Sales Order (APPROVED -> PROCESSING)
 */
export async function startProcessingSalesOrder(id: string, userId: string) {
  const existing = await prisma.salesOrder.findUnique({ where: { id } });
  if (!existing) throw new Error("Sales Order not found");
  if (existing.status !== "APPROVED") {
    throw new Error(`Cannot start processing Sales Order in '${existing.status}' status. Must be APPROVED.`);
  }

  const updated = await prisma.salesOrder.update({
    where: { id, status: "APPROVED" },
    data: {
      status: "PROCESSING",
      updatedAt: new Date(),
    },
    include: { customer: true, warehouse: true, items: true },
  });

  await prisma.auditLog.create({
    data: {
      userId,
      action: "sales_order_processing_started",
      entityType: "SalesOrder",
      entityId: updated.id,
      details: { salesOrderNumber: updated.salesOrderNumber },
    },
  });

  return updated;
}

/**
 * Completes a Processing Sales Order (PROCESSING -> COMPLETED)
 */
export async function completeSalesOrder(id: string, userId: string) {
  const existing = await prisma.salesOrder.findUnique({ where: { id } });
  if (!existing) throw new Error("Sales Order not found");
  if (existing.status !== "PROCESSING") {
    throw new Error(`Cannot complete Sales Order in '${existing.status}' status. Must be PROCESSING.`);
  }

  const updated = await prisma.salesOrder.update({
    where: { id, status: "PROCESSING" },
    data: {
      status: "COMPLETED",
      updatedAt: new Date(),
    },
    include: { customer: true, warehouse: true, items: true },
  });

  await prisma.auditLog.create({
    data: {
      userId,
      action: "sales_order_completed",
      entityType: "SalesOrder",
      entityId: updated.id,
      details: { salesOrderNumber: updated.salesOrderNumber },
    },
  });

  return updated;
}

/**
 * Cancels a Sales Order (DRAFT / PENDING_APPROVAL / APPROVED -> CANCELLED)
 * Automatically releases any associated active stock reservations.
 */
export async function cancelSalesOrder(id: string, reason: string | undefined, userId: string) {
  const existing = await prisma.salesOrder.findUnique({ where: { id } });
  if (!existing) throw new Error("Sales Order not found");
  
  if (["COMPLETED", "CANCELLED"].includes(existing.status)) {
    throw new Error(`Cannot cancel Sales Order in terminal status '${existing.status}'.`);
  }

  // Release any active stock reservations for this Sales Order
  const activeReservation = await prisma.stockReservation.findFirst({
    where: {
      salesOrderId: id,
      status: { in: ["ACTIVE", "PARTIALLY_FULFILLED"] },
    },
  });

  if (activeReservation) {
    await cancelReservation(activeReservation.id, reason || "Sales Order cancelled", userId);
  }

  const updated = await prisma.salesOrder.update({
    where: { id },
    data: {
      status: "CANCELLED",
      cancelledBy: userId,
      cancelledAt: new Date(),
      cancellationReason: reason?.trim() || "Order cancelled by user",
      updatedAt: new Date(),
    },
    include: { customer: true, warehouse: true, items: true },
  });

  await prisma.auditLog.create({
    data: {
      userId,
      action: "sales_order_cancelled",
      entityType: "SalesOrder",
      entityId: updated.id,
      details: { salesOrderNumber: updated.salesOrderNumber, reason },
    },
  });

  return updated;
}

/**
 * Retrieves Sales Order by ID
 */
export async function getSalesOrderById(id: string) {
  const order = await prisma.salesOrder.findUnique({
    where: { id },
    include: {
      customer: true,
      warehouse: true,
      items: {
        include: {
          product: {
            select: {
              id: true,
              name: true,
              sku: true,
              size: true,
              material: true,
            },
          },
        },
      },
    },
  });

  if (!order) throw new Error("Sales Order not found");
  return order;
}

/**
 * Paginated Sales Order Search and Listing
 */
export async function getSalesOrders(query: GetSalesOrdersQuery = {}) {
  const page = Math.max(1, query.page || 1);
  const limit = Math.min(100, Math.max(1, query.limit || 20));
  const skip = (page - 1) * limit;

  const where: any = {};

  if (query.customerId) where.customerId = query.customerId;
  if (query.warehouseId) where.warehouseId = query.warehouseId;
  if (query.status) where.status = query.status;

  if (query.startDate || query.endDate) {
    where.createdAt = {};
    if (query.startDate) where.createdAt.gte = new Date(query.startDate);
    if (query.endDate) where.createdAt.lte = new Date(query.endDate);
  }

  if (query.search && query.search.trim().length > 0) {
    const s = query.search.trim();
    where.OR = [
      { salesOrderNumber: { contains: s, mode: "insensitive" } },
      { customerNameSnapshot: { contains: s, mode: "insensitive" } },
      { customerCodeSnapshot: { contains: s, mode: "insensitive" } },
      { customerPhoneSnapshot: { contains: s, mode: "insensitive" } },
    ];
  }

  const sortBy = query.sortBy || "createdAt";
  const sortOrder = query.sortOrder || "desc";

  const [items, total] = await Promise.all([
    prisma.salesOrder.findMany({
      where,
      skip,
      take: limit,
      orderBy: { [sortBy]: sortOrder },
      include: {
        customer: true,
        warehouse: true,
        _count: { select: { items: true } },
      },
    }),
    prisma.salesOrder.count({ where }),
  ]);

  return {
    items,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
  };
}

/**
 * Sales Order Status Overview Stats
 */
export async function getSalesOrderStats() {
  const counts = await prisma.salesOrder.groupBy({
    by: ["status"],
    _count: { _all: true },
    _sum: { total: true },
  });

  const stats = {
    draft: 0,
    pendingApproval: 0,
    approved: 0,
    processing: 0,
    completed: 0,
    cancelled: 0,
    totalOrders: 0,
    totalValue: 0,
  };

  for (const c of counts) {
    const cnt = c._count._all;
    const val = c._sum.total || 0;
    stats.totalOrders += cnt;

    if (c.status !== "CANCELLED") {
      stats.totalValue += val;
    }

    if (c.status === "DRAFT") stats.draft = cnt;
    if (c.status === "PENDING_APPROVAL") stats.pendingApproval = cnt;
    if (c.status === "APPROVED") stats.approved = cnt;
    if (c.status === "PROCESSING") stats.processing = cnt;
    if (c.status === "COMPLETED") stats.completed = cnt;
    if (c.status === "CANCELLED") stats.cancelled = cnt;
  }

  stats.totalValue = Math.round(stats.totalValue * 100) / 100;
  return stats;
}
