import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth-server";
import { mapSessionToAppUser } from "@/lib/auth/map-session-user";
import { hasPermission, BuildStockPermissions } from "@/lib/auth/permissions";
import { createDispatchSchema, getDispatchesQuerySchema } from "@/lib/validations/dispatch-validations";
import { createDispatch, getDispatches } from "@/lib/dispatch/dispatchService";

export async function GET(req: NextRequest) {
  try {
    const session = await getSession();
    const user = session ? mapSessionToAppUser(session) : null;
    const role = user?.role || "VIEWER";

    if (!hasPermission(role, BuildStockPermissions.DISPATCH_VIEW)) {
      return NextResponse.json({ error: "Forbidden: Insufficient permissions to view Dispatches" }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const query = getDispatchesQuerySchema.parse({
      search: searchParams.get("search") || undefined,
      status: searchParams.get("status") || undefined,
      warehouseId: searchParams.get("warehouseId") || undefined,
      salesOrderId: searchParams.get("salesOrderId") || undefined,
      pickListId: searchParams.get("pickListId") || undefined,
      page: searchParams.get("page") || undefined,
      limit: searchParams.get("limit") || undefined,
      sortBy: searchParams.get("sortBy") || undefined,
      sortOrder: searchParams.get("sortOrder") || undefined,
    });

    const result = await getDispatches(query);
    return NextResponse.json(result);
  } catch (error: any) {
    console.error("GET /api/dispatches error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to fetch dispatches" },
      { status: error.status || 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    const user = session ? mapSessionToAppUser(session) : null;
    const role = user?.role || "VIEWER";

    if (!user || !hasPermission(role, BuildStockPermissions.DISPATCH_CREATE)) {
      return NextResponse.json({ error: "Forbidden: Insufficient permissions to create Dispatch" }, { status: 403 });
    }

    const body = await req.json();
    const data = createDispatchSchema.parse(body);

    const dispatch = await createDispatch(data.pickListId, user.id, data.notes);
    return NextResponse.json(dispatch, { status: 201 });
  } catch (error: any) {
    console.error("POST /api/dispatches error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to create dispatch" },
      { status: error.status || 400 }
    );
  }
}
