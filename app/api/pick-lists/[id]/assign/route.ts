import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth-server";
import { mapSessionToAppUser } from "@/lib/auth/map-session-user";
import { hasPermission, BuildStockPermissions } from "@/lib/auth/permissions";
import { assignPickList } from "@/lib/picking/pickingService";
import { assignPickListSchema } from "@/lib/validations/picking-validations";

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    const user = session ? mapSessionToAppUser(session) : null;
    const role = user?.role || "VIEWER";

    if (!hasPermission(role, BuildStockPermissions.PICK_LIST_ASSIGN)) {
      return NextResponse.json({ error: "Forbidden: Insufficient permissions to assign Pick List" }, { status: 403 });
    }

    const { id } = await context.params;
    const body = await req.json();
    const parsed = assignPickListSchema.parse(body);

    const updated = await assignPickList(id, parsed.assignedTo, user?.id || "system");

    return NextResponse.json(updated);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to assign Pick List" }, { status: 400 });
  }
}
