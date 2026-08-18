import { prisma } from "@/prisma/client";

export interface CreateCustomerInput {
  name: string;
  phone?: string;
  alternatePhone?: string;
  email?: string;
  address?: string;
  city?: string;
  country?: string;
  taxNumber?: string;
  notes?: string;
}

export interface UpdateCustomerInput {
  name?: string;
  phone?: string;
  alternatePhone?: string;
  email?: string;
  address?: string;
  city?: string;
  country?: string;
  taxNumber?: string;
  notes?: string;
  active?: boolean;
}

export interface GetCustomersQuery {
  search?: string;
  active?: boolean | string;
  page?: number;
  limit?: number;
  sortBy?: "name" | "customerCode" | "createdAt";
  sortOrder?: "asc" | "desc";
}

/**
 * Generates human-readable customer code: CUS-2026-XXXXXX
 */
export async function generateCustomerCode(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `CUS-${year}-`;
  
  const lastCustomer = await prisma.customer.findFirst({
    where: { customerCode: { startsWith: prefix } },
    orderBy: { customerCode: "desc" },
    select: { customerCode: true },
  });

  let nextSequence = 1;
  const lastCode = lastCustomer?.customerCode;
  if (lastCode) {
    const parts = lastCode.split("-");
    const lastSeqStr = parts[parts.length - 1] || "0";
    const lastSeq = parseInt(lastSeqStr, 10);
    if (!isNaN(lastSeq)) {
      nextSequence = lastSeq + 1;
    }
  }

  return `${prefix}${nextSequence.toString().padStart(6, "0")}`;
}

/**
 * Creates a new Customer record
 */
export async function createCustomer(data: CreateCustomerInput, userId: string) {
  if (!data.name || data.name.trim().length === 0) {
    throw new Error("Customer name is required");
  }

  const customerCode = await generateCustomerCode();

  const customer = await prisma.customer.create({
    data: {
      customerCode,
      name: data.name.trim(),
      phone: data.phone?.trim() || null,
      alternatePhone: data.alternatePhone?.trim() || null,
      email: data.email?.trim() || null,
      address: data.address?.trim() || null,
      city: data.city?.trim() || null,
      country: data.country?.trim() || null,
      taxNumber: data.taxNumber?.trim() || null,
      notes: data.notes?.trim() || null,
      active: true,
      createdBy: userId,
    },
  });

  // Create Audit Log
  await prisma.auditLog.create({
    data: {
      userId,
      action: "customer_created",
      entityType: "Customer",
      entityId: customer.id,
      details: { customerCode: customer.customerCode, name: customer.name },
    },
  });

  return customer;
}

/**
 * Updates an existing Customer
 */
export async function updateCustomer(id: string, data: UpdateCustomerInput, userId: string) {
  const existing = await prisma.customer.findUnique({ where: { id } });
  if (!existing) {
    throw new Error("Customer not found");
  }

  const updated = await prisma.customer.update({
    where: { id },
    data: {
      ...(data.name !== undefined && { name: data.name.trim() }),
      ...(data.phone !== undefined && { phone: data.phone?.trim() || null }),
      ...(data.alternatePhone !== undefined && { alternatePhone: data.alternatePhone?.trim() || null }),
      ...(data.email !== undefined && { email: data.email?.trim() || null }),
      ...(data.address !== undefined && { address: data.address?.trim() || null }),
      ...(data.city !== undefined && { city: data.city?.trim() || null }),
      ...(data.country !== undefined && { country: data.country?.trim() || null }),
      ...(data.taxNumber !== undefined && { taxNumber: data.taxNumber?.trim() || null }),
      ...(data.notes !== undefined && { notes: data.notes?.trim() || null }),
      ...(data.active !== undefined && { active: data.active }),
      updatedAt: new Date(),
      updatedBy: userId,
    },
  });

  await prisma.auditLog.create({
    data: {
      userId,
      action: "customer_updated",
      entityType: "Customer",
      entityId: updated.id,
      details: { changes: Object.keys(data) },
    },
  });

  return updated;
}

/**
 * Logical Deactivation of a Customer
 */
export async function deactivateCustomer(id: string, userId: string) {
  const existing = await prisma.customer.findUnique({ where: { id } });
  if (!existing) {
    throw new Error("Customer not found");
  }

  const updated = await prisma.customer.update({
    where: { id },
    data: {
      active: false,
      updatedAt: new Date(),
      updatedBy: userId,
    },
  });

  await prisma.auditLog.create({
    data: {
      userId,
      action: "customer_deactivated",
      entityType: "Customer",
      entityId: updated.id,
      details: { customerCode: existing.customerCode },
    },
  });

  return updated;
}

/**
 * Retrieves Customer by ID
 */
export async function getCustomerById(id: string) {
  const customer = await prisma.customer.findUnique({
    where: { id },
    include: {
      salesOrders: {
        take: 5,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          salesOrderNumber: true,
          status: true,
          total: true,
          createdAt: true,
        },
      },
    },
  });

  if (!customer) {
    throw new Error("Customer not found");
  }

  return customer;
}

/**
 * Paginated Customer Search and Listing
 */
export async function getCustomers(query: GetCustomersQuery = {}) {
  const page = Math.max(1, query.page || 1);
  const limit = Math.min(100, Math.max(1, query.limit || 20));
  const skip = (page - 1) * limit;

  const where: any = {};

  if (query.active !== undefined && query.active !== "") {
    where.active = String(query.active) === "true";
  }

  if (query.search && query.search.trim().length > 0) {
    const s = query.search.trim();
    where.OR = [
      { name: { contains: s, mode: "insensitive" } },
      { customerCode: { contains: s, mode: "insensitive" } },
      { phone: { contains: s, mode: "insensitive" } },
      { email: { contains: s, mode: "insensitive" } },
    ];
  }

  const sortBy = query.sortBy || "createdAt";
  const sortOrder = query.sortOrder || "desc";

  const [items, total] = await Promise.all([
    prisma.customer.findMany({
      where,
      skip,
      take: limit,
      orderBy: { [sortBy]: sortOrder },
      include: {
        _count: {
          select: { salesOrders: true },
        },
      },
    }),
    prisma.customer.count({ where }),
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
 * Returns Customer Purchasing & Order Statistics
 */
export async function getCustomerSalesStats(id: string) {
  const customer = await prisma.customer.findUnique({ where: { id } });
  if (!customer) {
    throw new Error("Customer not found");
  }

  const orders = await prisma.salesOrder.findMany({
    where: { customerId: id },
    select: {
      id: true,
      salesOrderNumber: true,
      status: true,
      total: true,
      orderDate: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });

  const totalOrders = orders.length;
  const openOrders = orders.filter((o: any) => ["DRAFT", "PENDING_APPROVAL", "APPROVED", "PROCESSING"].includes(o.status)).length;
  const completedOrders = orders.filter((o: any) => o.status === "COMPLETED").length;
  const cancelledOrders = orders.filter((o: any) => o.status === "CANCELLED").length;
  const totalOrderValue = orders.reduce((sum: number, o: any) => sum + (o.status !== "CANCELLED" ? o.total : 0), 0);
  const lastOrderDate = orders[0]?.createdAt || null;

  return {
    customer,
    stats: {
      totalOrders,
      openOrders,
      completedOrders,
      cancelledOrders,
      totalOrderValue: Math.round(totalOrderValue * 100) / 100,
      lastOrderDate,
    },
    recentOrders: orders.slice(0, 10),
  };
}
