import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/prisma/client";
import { getSessionFromRequest } from "@/utils/auth";
import { hasPermission } from "@/lib/auth/permissions";
import { isInventoryAdmin } from "@/lib/auth/inventory-route-access";

/** ERP contact balances do not reinterpret legacy login-user IDs. Managers
 * receive only invoices for sales in their current assigned warehouses. */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const actor = await getSessionFromRequest(request);
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasPermission(actor, "SALES_ORDER_APPROVE")) return NextResponse.json({ error: "Forbidden financial report" }, { status: 403 });
  const { id } = await context.params;
  if (!/^[a-f0-9]{24}$/i.test(id)) return NextResponse.json({ error: "Invalid customer ID" }, { status: 400 });
  const warehouses = [...new Set([actor.primaryWarehouseId, ...(actor.warehouseIds || [])].filter(Boolean))] as string[];
  const sales = await prisma.salesOrder.findMany({ where: { customerId: id, ...(isInventoryAdmin(actor) ? {} : { warehouseId: { in: warehouses } }) }, select: { id: true } });
  const orders = await prisma.order.findMany({ where: { customerId: id, erpSalesOrderId: { in: sales.map(s => s.id) }, status: { not: "cancelled" } }, include: { invoice: true } });
  const invoices = orders.map(o => o.invoice).filter(i => i && i.status !== "cancelled");
  if (invoices.some(i => [i!.total, i!.amountPaid, i!.amountDue].some(v => !Number.isFinite(v) || v < 0))) return NextResponse.json({ error: "Financial records require reconciliation" }, { status: 409 });
  const sum = (field: "total" | "amountPaid" | "amountDue") => Math.round(invoices.reduce((n, i) => n + Math.round(i![field] * 100), 0)) / 100;
  return NextResponse.json({ customerId: id, scope: "CURRENT_AUTHORIZED_WAREHOUSES", invoiceCount: invoices.length,
    totalInvoiced: sum("total"), amountPaid: sum("amountPaid"), amountDue: sum("amountDue"), invoices }, { headers: { "Cache-Control": "no-store" } });
}
