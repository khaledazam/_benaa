import { z } from "zod";
import { getSessionFromRequest, isAccountAccessAllowed } from "@/utils/auth";
import { hasPermission, effectivePermissions, BuildStockRoles } from "@/lib/auth/permissions";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/prisma/client";
import { manageEmployee } from "@/lib/auth/employeeManagement";
import { createCorsHeaders, handleCorsPreflight } from "@/lib/api/cors";
import { scheduleInvalidateUserCaches } from "@/lib/cache/post-mutation";

const employeeFields = z.object({
  id: z.string().regex(/^[a-f0-9]{24}$/i).optional(),
  name: z.string().trim().min(1).max(200).optional(),
  email: z.string().email().optional(),
  username: z.string().min(3).max(50).optional(),
  password: z.string().min(8).max(72).optional(),
  newPassword: z.string().min(8).max(72).optional(),
  role: z.enum(["SUPER_ADMIN", "WAREHOUSE_MANAGER", "STOREKEEPER", "PURCHASING_OFFICER", "INVENTORY_OFFICER", "VIEWER"]).optional(),
  status: z.boolean().optional(),
  primaryWarehouseId: z.string().regex(/^[a-f0-9]{24}$/i).nullable().optional(),
  additionalWarehouseIds: z.array(z.string().regex(/^[a-f0-9]{24}$/i)).max(200).optional(),
  permissions: z.array(z.string()).max(200).optional(),
  subscriptionStartDate: z.string().refine((v) => !isNaN(Date.parse(v))).nullable().optional(),
  subscriptionEndDate: z.string().refine((v) => !isNaN(Date.parse(v))).nullable().optional(),
}).strict();

export async function OPTIONS(request: NextRequest) { return handleCorsPreflight(request); }

/**
 * GET /api/admin/employees
 * List all employee accounts in BENAA with warehouse and subscription details
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getSessionFromRequest(request);
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!hasPermission(session, "USER_MANAGE")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const users = await prisma.user.findMany({
      orderBy: { createdAt: "desc" },
    });

    const warehouses = await prisma.warehouse.findMany({
      select: { id: true, name: true, code: true },
    });
    const warehouseMap = new Map(warehouses.map((w) => [w.id, w]));

    const now = new Date();

    const formatted = users.map((u) => {
      const isSubActive = isAccountAccessAllowed(u);

      const primaryWh = u.primaryWarehouseId
        ? warehouseMap.get(u.primaryWarehouseId)
        : null;

      const authorizedWhs = (u.warehouseIds || [])
        .map((wid) => warehouseMap.get(wid))
        .filter(Boolean);

      return {
        id: u.id,
        name: u.name,
        email: u.email,
        username: u.username || u.email.split("@")[0],
        role: u.role || "STOREKEEPER",
        status: u.status,
        isSubscriptionActive: isSubActive,
        subscriptionStartDate: u.subscriptionStartDate
          ? u.subscriptionStartDate.toISOString().split("T")[0]
          : null,
        subscriptionEndDate: u.subscriptionEndDate
          ? u.subscriptionEndDate.toISOString().split("T")[0]
          : null,
        primaryWarehouseId: u.primaryWarehouseId || null,
        primaryWarehouseName: primaryWh ? primaryWh.name : "ط؛ظٹط± ظ…ط­ط¯ط¯",
        primaryWarehouseCode: primaryWh ? primaryWh.code : null,
        warehouseIds: u.warehouseIds || [],
        authorizedWarehouses: authorizedWhs,
        permissions: u.permissions || [],
        permissionsRestricted: u.permissionsRestricted,
        effectivePermissions: effectivePermissions(u),
        createdAt: u.createdAt.toISOString().split("T")[0],
      };
    });

    return NextResponse.json(
      {
        success: true,
        company: "BENAA Construction & Decoration",
        totalEmployees: formatted.length,
        employees: formatted,
        rolePermissions: Object.fromEntries(Object.values(BuildStockRoles).map(role => [role, effectivePermissions({ role })])),
      },
      { headers: createCorsHeaders(request) }
    );
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: "Failed to fetch employees" },
      { status: 500, headers: createCorsHeaders(request) }
    );
  }
}

/**
 * POST /api/admin/employees
 * Super Admin creates a new employee account with warehouse assignment & subscription
 */
export async function POST(request: NextRequest) {
  const response = await createEmployee(request);
  if (response.ok) await scheduleInvalidateUserCaches();
  return response;
}

async function createEmployee(request: NextRequest) {
 return employeeCommand(request, false);
}
export async function PUT(request: NextRequest) {
 const response = await employeeCommand(request, true);
 if (response.ok) await scheduleInvalidateUserCaches();
 return response;
}
async function employeeCommand(request: NextRequest, update: boolean) {
 try {
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasPermission(session, 'USER_MANAGE')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const parsed = employeeFields.safeParse(await request.json());
  if (!parsed.success || (update && !parsed.data.id) || (update && parsed.data.password) || (!update && parsed.data.newPassword))
    return NextResponse.json({ error: 'Invalid employee data' }, { status: 400 });
  const employee = await manageEmployee(prisma, session.id, parsed.data, update);
  return NextResponse.json({ success: true, employee }, { status: update ? 200 : 201, headers: createCorsHeaders(request) });
 } catch (error: any) {
  return NextResponse.json({ error: error.status ? error.message : 'Employee operation failed' }, { status: error.status || (error.code === 'P2002' ? 409 : 500), headers: createCorsHeaders(request) });
 }
}
