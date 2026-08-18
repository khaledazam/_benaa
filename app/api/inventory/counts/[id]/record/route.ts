import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth-server";
import { mapSessionToAppUser } from "@/lib/auth/map-session-user";
import { hasPermission, BuildStockPermissions } from "@/lib/auth/permissions";
import { recordCountItems } from "@/lib/inventory/countingService";
import { recordCountItemsSchema } from "@/lib/validations/count-validations";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    const user = session ? mapSessionToAppUser(session) : null;
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const role = user.role || "VIEWER";

    if (!hasPermission(role, BuildStockPermissions.INVENTORY_COUNT_START)) {
      return NextResponse.json({ error: "Forbidden — INVENTORY_COUNT_START permission required" }, { status: 403 });
    }

    const { id } = await params;
    const body = await req.json();
    const parsed = recordCountItemsSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation error", details: parsed.error.format() }, { status: 400 });
    }

    const updated = await recordCountItems(id, parsed.data, user.id);
    return NextResponse.json(updated);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to record count items" }, { status: 400 });
  }
}
