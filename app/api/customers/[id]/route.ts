import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth-server";
import { mapSessionToAppUser } from "@/lib/auth/map-session-user";
import { hasPermission, BuildStockPermissions } from "@/lib/auth/permissions";
import { getCustomerById, updateCustomer, deactivateCustomer } from "@/lib/customers/customerService";

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const user = session ? mapSessionToAppUser(session) : null;
    const role = user?.role || "VIEWER";

    if (!hasPermission(user, BuildStockPermissions.CUSTOMER_VIEW)) {
      return NextResponse.json({ error: "Unauthorized access" }, { status: 403 });
    }

    const { id } = await context.params;
    const customer = await getCustomerById(id);
    return NextResponse.json(customer);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Customer not found" }, { status: 404 });
  }
}

export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const user = session ? mapSessionToAppUser(session) : null;
    const role = user?.role || "VIEWER";

    if (!hasPermission(user, BuildStockPermissions.CUSTOMER_UPDATE)) {
      return NextResponse.json({ error: "Insufficient permissions to update customers" }, { status: 403 });
    }

    const { id } = await context.params;
    const body = await req.json();
    const updated = await updateCustomer(id, body, user?.id || "system");
    return NextResponse.json(updated);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to update customer" }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const user = session ? mapSessionToAppUser(session) : null;
    const role = user?.role || "VIEWER";

    if (!hasPermission(user, BuildStockPermissions.CUSTOMER_DEACTIVATE)) {
      return NextResponse.json({ error: "Insufficient permissions to deactivate customers" }, { status: 403 });
    }

    const { id } = await context.params;
    const updated = await deactivateCustomer(id, user?.id || "system");
    return NextResponse.json(updated);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to deactivate customer" }, { status: 400 });
  }
}
